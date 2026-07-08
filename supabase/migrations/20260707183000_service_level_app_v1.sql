-- Civil Service Promotion Exam app v1 restructure.
--
-- Adds locked service-level onboarding fields, activates the three real
-- practice modules, and updates candidate RPCs to derive access from the
-- signed-in user's profile instead of client-supplied level filters.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'grade_band'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'service_level'
  ) then
    execute 'alter table public.profiles rename column grade_band to service_level';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'questions'
      and column_name = 'grade_band'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'questions'
      and column_name = 'service_level'
  ) then
    execute 'alter table public.questions rename column grade_band to service_level';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attempts'
      and column_name = 'grade_band'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attempts'
      and column_name = 'service_level'
  ) then
    execute 'alter table public.attempts rename column grade_band to service_level';
  end if;
end $$;

alter table public.profiles
  add column if not exists phone_number text,
  add column if not exists state_code text,
  add column if not exists service_level text,
  add column if not exists organization_name text,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.questions
  add column if not exists service_level text,
  add column if not exists reference_note text not null default '';

alter table public.attempts
  add column if not exists service_level text;

alter table public.subjects
  add column if not exists slug text;

update public.subjects
set slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
where slug is null;

create unique index if not exists subjects_slug_key on public.subjects (slug);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.protect_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if old.service_level is not null and new.service_level is distinct from old.service_level then
      raise exception 'Your service level is locked. Contact support if it needs correction';
    end if;

    if old.onboarding_completed_at is not null and new.onboarding_completed_at is null then
      raise exception 'Profile setup cannot be reopened';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity
before update on public.profiles
for each row execute function public.protect_profile_identity();

update public.subjects
set is_active = false
where name in (
  'English Language',
  'Mathematics',
  'General Knowledge',
  'Current Affairs',
  'Public Service Rules'
);

insert into public.subjects (name, slug, description, sort_order, is_active)
values
  (
    'Public Financial Management (Financial Regulations)',
    'public-financial-management',
    'Financial regulations, stewardship, public funds, and accountability.',
    10,
    true
  ),
  (
    'Public Service Rules',
    'public-service-rules',
    'Conduct, discipline, promotion, ethics, and service-wide rules.',
    20,
    true
  ),
  (
    'Current Affairs / General Knowledge',
    'current-affairs-general-knowledge',
    'Nigeria-focused civic awareness, public institutions, and current affairs.',
    30,
    true
  )
on conflict (name) do update
set slug = excluded.slug,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

update public.questions
set status = 'draft'
where source_note ilike 'PLACEHOLDER%';

drop function if exists public.get_practice_questions(uuid, integer);

create or replace function public.get_practice_questions(
  requested_subject_id uuid,
  requested_limit integer default 30
)
returns table (
  id uuid,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  service_level text,
  difficulty public.difficulty_level,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  correct_option text,
  explanation text,
  reference_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pack_record public.exam_packs;
  caller_service_level text;
  used_count integer;
  allowed_count integer;
  paid_access boolean;
begin
  if requested_subject_id is null then
    raise exception 'Choose a module before starting practice';
  end if;

  select * into pack_record
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if pack_record.id is null then
    raise exception 'No active exam pack is configured';
  end if;

  select service_level into caller_service_level
  from public.profiles
  where id = auth.uid();

  if caller_service_level is null then
    raise exception 'Complete your profile setup before starting practice';
  end if;

  paid_access := public.has_active_entitlement(pack_record.id);

  select count(distinct aa.question_id) into used_count
  from public.attempt_answers aa
  join public.questions q on q.id = aa.question_id
  where aa.user_id = auth.uid()
    and q.exam_pack_id = pack_record.id;

  if paid_access then
    allowed_count := greatest(1, least(coalesce(requested_limit, 30), 50));
  else
    allowed_count := greatest(
      0,
      least(coalesce(requested_limit, 30), pack_record.trial_question_limit - coalesce(used_count, 0))
    );
  end if;

  return query
  with ranked_questions as (
    select
      q.id,
      q.subject_id,
      s.name as subject_name,
      s.slug as subject_slug,
      q.service_level,
      q.difficulty,
      q.question_text,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.reference_note,
      case when exists (
        select 1
        from public.attempt_answers aa
        where aa.user_id = auth.uid()
          and aa.question_id = q.id
      ) then 1 else 0 end as seen_rank,
      random() as random_rank
    from public.questions q
    join public.subjects s on s.id = q.subject_id
    where q.exam_pack_id = pack_record.id
      and q.status = 'published'
      and s.is_active = true
      and q.subject_id = requested_subject_id
      and (q.service_level is null or q.service_level = caller_service_level)
  )
  select
    rq.id,
    rq.subject_id,
    rq.subject_name,
    rq.subject_slug,
    rq.service_level,
    rq.difficulty,
    rq.question_text,
    rq.option_a,
    rq.option_b,
    rq.option_c,
    rq.option_d,
    null::text as correct_option,
    null::text as explanation,
    rq.reference_note
  from ranked_questions rq
  order by rq.seen_rank, rq.random_rank
  limit allowed_count;
end;
$$;

drop function if exists public.submit_attempt(public.attempt_mode, uuid, jsonb);

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
  caller_service_level text;
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
    raise exception 'No active exam pack is configured';
  end if;

  select service_level into caller_service_level
  from public.profiles
  where id = auth.uid();

  if caller_service_level is null then
    raise exception 'Complete your profile setup before submitting practice';
  end if;

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

  insert into public.attempts (user_id, exam_pack_id, mode, subject_id, service_level)
  values (auth.uid(), pack_record.id, submitted_mode, submitted_subject_id, caller_service_level)
  returning id into new_attempt_id;

  for answer_record in select * from jsonb_array_elements(submitted_answers)
  loop
    answer_question_id := (answer_record->>'question_id')::uuid;
    answer_option := answer_record->>'selected_option';
    answer_time_spent := coalesce((answer_record->>'time_spent_seconds')::integer, 0);

    select q.* into question_row
    from public.questions q
    join public.subjects s on s.id = q.subject_id
    where q.id = answer_question_id
      and q.exam_pack_id = pack_record.id
      and q.status = 'published'
      and s.is_active = true
      and q.subject_id = submitted_subject_id
      and (q.service_level is null or q.service_level = caller_service_level);

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

    review_items := review_items || jsonb_build_object(
      'question_id', question_row.id,
      'selected_option', answer_option,
      'correct_option', question_row.correct_option,
      'is_correct', answer_option = question_row.correct_option,
      'explanation', question_row.explanation,
      'reference_note', question_row.reference_note
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

create or replace function public.get_module_progress()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  completed_attempts bigint,
  mastered_attempts bigint,
  last_score_percent integer,
  weak_question_count bigint,
  has_questions boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select service_level
    from public.profiles
    where id = auth.uid()
  )
  select
    s.id,
    s.name,
    s.slug,
    count(a.id) filter (where a.completed_at is not null) as completed_attempts,
    count(a.id) filter (
      where a.completed_at is not null
        and a.total_questions > 0
        and ((a.score::numeric * 100) / a.total_questions) >= 70
    ) as mastered_attempts,
    coalesce((
      select round((a2.score::numeric * 100) / nullif(a2.total_questions, 0))::integer
      from public.attempts a2
      where a2.user_id = auth.uid()
        and a2.subject_id = s.id
        and a2.completed_at is not null
      order by a2.completed_at desc
      limit 1
    ), 0) as last_score_percent,
    coalesce((
      select count(distinct aa.question_id)
      from public.attempt_answers aa
      join public.questions q on q.id = aa.question_id
      where aa.user_id = auth.uid()
        and q.subject_id = s.id
        and aa.is_correct = false
    ), 0) as weak_question_count,
    exists (
      select 1
      from public.questions q
      join caller on true
      where q.subject_id = s.id
        and q.status = 'published'
        and (q.service_level is null or q.service_level = caller.service_level)
    ) as has_questions
  from public.subjects s
  left join public.attempts a
    on a.subject_id = s.id
   and a.user_id = auth.uid()
  where s.is_active = true
  group by s.id, s.name, s.slug, s.sort_order
  order by s.sort_order;
$$;

create or replace function public.get_review_queue(
  requested_limit integer default 12
)
returns table (
  question_id uuid,
  subject_id uuid,
  subject_name text,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  correct_option text,
  explanation text,
  reference_note text,
  times_missed bigint,
  last_reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    q.id,
    q.subject_id,
    s.name,
    q.question_text,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d,
    q.correct_option,
    q.explanation,
    q.reference_note,
    count(*) as times_missed,
    max(aa.answered_at) as last_reviewed_at
  from public.attempt_answers aa
  join public.questions q on q.id = aa.question_id
  join public.subjects s on s.id = q.subject_id
  where aa.user_id = auth.uid()
    and aa.is_correct = false
    and s.is_active = true
  group by q.id, q.subject_id, s.name, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation, q.reference_note
  order by last_reviewed_at desc
  limit greatest(1, least(coalesce(requested_limit, 12), 30));
$$;

create or replace function public.get_attempt_review(
  requested_attempt_id uuid default null
)
returns table (
  attempt_id uuid,
  completed_at timestamptz,
  score integer,
  total_questions integer,
  subject_id uuid,
  subject_name text,
  question_id uuid,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  selected_option text,
  correct_option text,
  is_correct boolean,
  explanation text,
  reference_note text
)
language sql
stable
security definer
set search_path = public
as $$
  with target_attempt as (
    select a.id, a.completed_at, a.score, a.total_questions, a.subject_id
    from public.attempts a
    where a.user_id = auth.uid()
      and a.completed_at is not null
      and (requested_attempt_id is null or a.id = requested_attempt_id)
    order by a.completed_at desc
    limit 1
  )
  select
    ta.id,
    ta.completed_at,
    ta.score,
    ta.total_questions,
    ta.subject_id,
    s.name,
    q.id,
    q.question_text,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d,
    aa.selected_option,
    q.correct_option,
    aa.is_correct,
    q.explanation,
    q.reference_note
  from target_attempt ta
  join public.attempt_answers aa on aa.attempt_id = ta.id
  join public.questions q on q.id = aa.question_id
  join public.subjects s on s.id = q.subject_id
  order by aa.answered_at;
$$;

create or replace function public.get_subject_performance()
returns table (
  subject_id uuid,
  subject_name text,
  correct_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    count(*) filter (where aa.is_correct) as correct_count,
    count(*) as total_count
  from public.attempt_answers aa
  join public.questions q on q.id = aa.question_id
  join public.subjects s on s.id = q.subject_id
  where aa.user_id = auth.uid()
    and s.is_active = true
  group by s.id, s.name, s.sort_order
  order by s.sort_order;
$$;
