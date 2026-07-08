-- Grade-band signup gating.
--
-- Adds a permanent, candidate-chosen grade_band to profiles (set once at
-- signup) and makes get_practice_questions/submit_attempt derive the
-- candidate's grade band from their own profile server-side, instead of
-- trusting a client-supplied filter. General Paper questions (grade_band is
-- null) remain visible to every candidate regardless of band.
--
-- NOTE before applying: this project's base schema (20260620190000) was
-- already applied directly to this database outside of migration tracking,
-- so `supabase migration list` shows it as missing remotely even though its
-- tables/functions already exist. Run this first, once, before `db push`:
--   supabase migration repair --status applied 20260620190000
-- Otherwise db push will try to re-run the base migration and fail on
-- "already exists" errors for its types/tables.

alter table public.profiles
  add column if not exists grade_band text;

comment on column public.profiles.grade_band is
  'Chosen once at signup; scopes which grade-tagged questions this candidate can practice (see get_practice_questions/submit_attempt).';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, grade_band)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'grade_band'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Signature changed (dropped requested_grade_band) — old overload must be
-- removed explicitly or both would coexist and RPC calls would become
-- ambiguous.
drop function if exists public.get_practice_questions(uuid, text, integer);

create or replace function public.get_practice_questions(
  requested_subject_id uuid default null,
  requested_limit integer default 20
)
returns table (
  id uuid,
  subject_id uuid,
  subject_name text,
  grade_band text,
  difficulty public.difficulty_level,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  correct_option text,
  explanation text,
  source_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pack_record public.exam_packs;
  caller_grade_band text;
  used_count integer;
  allowed_count integer;
  paid_access boolean;
begin
  select * into pack_record
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if pack_record.id is null then
    return;
  end if;

  select grade_band into caller_grade_band
  from public.profiles
  where id = auth.uid();

  paid_access := public.has_active_entitlement(pack_record.id);

  select count(distinct aa.question_id) into used_count
  from public.attempt_answers aa
  join public.questions q on q.id = aa.question_id
  where aa.user_id = auth.uid()
    and q.exam_pack_id = pack_record.id;

  if paid_access then
    allowed_count := greatest(1, least(requested_limit, 50));
  else
    allowed_count := greatest(0, least(requested_limit, pack_record.trial_question_limit - coalesce(used_count, 0)));
  end if;

  return query
  select
    q.id,
    q.subject_id,
    s.name,
    q.grade_band,
    q.difficulty,
    q.question_text,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d,
    -- Answer key withheld until the attempt is submitted (see submit_attempt).
    null::text as correct_option,
    null::text as explanation,
    q.source_note
  from public.questions q
  join public.subjects s on s.id = q.subject_id
  where q.exam_pack_id = pack_record.id
    and q.status = 'published'
    and (requested_subject_id is null or q.subject_id = requested_subject_id)
    -- General Paper items (grade_band NULL) always appear; grade-tagged items
    -- are scoped to the candidate's own grade band, set once at signup.
    and (q.grade_band is null or q.grade_band = caller_grade_band)
  order by random()
  limit allowed_count;
end;
$$;

-- Signature changed (dropped submitted_grade_band) — same reasoning as above.
drop function if exists public.submit_attempt(public.attempt_mode, uuid, text, jsonb);

create or replace function public.submit_attempt(
  submitted_mode public.attempt_mode,
  submitted_subject_id uuid,
  submitted_answers jsonb
)
returns table (
  attempt_id uuid,
  score integer,
  total_questions integer,
  review jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pack_record public.exam_packs;
  caller_grade_band text;
  new_attempt_id uuid;
  answer_record jsonb;
  answer_question_id uuid;
  answer_option text;
  answer_time_spent integer;
  question_row public.questions;
  computed_score integer := 0;
  computed_total integer := 0;
  paid_access boolean;
  used_count integer;
  new_question_count integer;
  review_items jsonb := '[]'::jsonb;
begin
  select * into pack_record
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if pack_record.id is null then
    raise exception 'No active exam pack found';
  end if;

  select grade_band into caller_grade_band
  from public.profiles
  where id = auth.uid();

  paid_access := public.has_active_entitlement(pack_record.id);

  if not paid_access then
    select count(distinct aa.question_id) into used_count
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where aa.user_id = auth.uid()
      and q.exam_pack_id = pack_record.id;

    select count(distinct (answer_item->>'question_id')::uuid) into new_question_count
    from jsonb_array_elements(submitted_answers) answer_item
    where not exists (
      select 1
      from public.attempt_answers aa
      where aa.user_id = auth.uid()
        and aa.question_id = (answer_item->>'question_id')::uuid
    );

    if coalesce(used_count, 0) + coalesce(new_question_count, 0) > pack_record.trial_question_limit then
      raise exception 'Free trial limit reached';
    end if;
  end if;

  insert into public.attempts (user_id, exam_pack_id, mode, subject_id, grade_band)
  values (auth.uid(), pack_record.id, submitted_mode, submitted_subject_id, caller_grade_band)
  returning id into new_attempt_id;

  for answer_record in select * from jsonb_array_elements(submitted_answers)
  loop
    answer_question_id := (answer_record->>'question_id')::uuid;
    answer_option := answer_record->>'selected_option';
    answer_time_spent := coalesce((answer_record->>'time_spent_seconds')::integer, 0);

    select * into question_row
    from public.questions
    where id = answer_question_id
      and exam_pack_id = pack_record.id
      and status = 'published'
      and (grade_band is null or grade_band = caller_grade_band);

    if question_row.id is null then
      continue;
    end if;

    computed_total := computed_total + 1;

    if answer_option = question_row.correct_option then
      computed_score := computed_score + 1;
    end if;

    insert into public.attempt_answers (
      attempt_id,
      user_id,
      question_id,
      selected_option,
      is_correct,
      time_spent_seconds
    )
    values (
      new_attempt_id,
      auth.uid(),
      answer_question_id,
      answer_option,
      answer_option = question_row.correct_option,
      answer_time_spent
    );

    -- Reveal the answer key only for questions that were actually answered.
    review_items := review_items || jsonb_build_object(
      'question_id', question_row.id,
      'selected_option', answer_option,
      'correct_option', question_row.correct_option,
      'is_correct', answer_option = question_row.correct_option,
      'explanation', question_row.explanation
    );
  end loop;

  update public.attempts
  set completed_at = now(),
      score = computed_score,
      total_questions = computed_total
  where id = new_attempt_id;

  return query select new_attempt_id, computed_score, computed_total, review_items;
end;
$$;
