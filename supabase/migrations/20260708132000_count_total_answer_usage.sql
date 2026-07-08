-- Count total answered questions toward the free trial, not only unique question IDs.

create or replace function public.get_candidate_summary()
returns table (
  pack_id uuid,
  pack_name text,
  price_kobo integer,
  currency text,
  trial_question_limit integer,
  trial_questions_used bigint,
  has_paid_access boolean,
  access_expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with pack as (
    select * from public.exam_packs
    where is_active = true
    order by active_from desc, created_at desc
    limit 1
  ),
  usage as (
    select count(*) as used
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    join pack on pack.id = q.exam_pack_id
    where aa.user_id = auth.uid()
  ),
  active_entitlement as (
    select expires_at
    from public.entitlements
    join pack on pack.id = entitlements.exam_pack_id
    where user_id = auth.uid()
      and status = 'active'
      and expires_at > now()
    order by expires_at desc
    limit 1
  )
  select
    pack.id,
    pack.name,
    pack.price_kobo,
    pack.currency,
    pack.trial_question_limit,
    coalesce(usage.used, 0),
    exists (select 1 from active_entitlement),
    (select expires_at from active_entitlement)
  from pack
  left join usage on true;
$$;

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

  select p.service_level into caller_service_level
  from public.profiles p
  where p.id = auth.uid();

  if caller_service_level is null then
    raise exception 'Complete your profile setup before starting practice';
  end if;

  paid_access := public.has_active_entitlement(pack_record.id);

  select count(*) into used_count
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
      case when q.service_level is null or btrim(q.service_level) = '' then 0 else 1 end as pool_rank,
      random() as random_rank
    from public.questions q
    join public.subjects s on s.id = q.subject_id
    where q.exam_pack_id = pack_record.id
      and q.status = 'published'
      and s.is_active = true
      and q.subject_id = requested_subject_id
      and (
        q.service_level is null
        or btrim(q.service_level) = ''
        or q.service_level = caller_service_level
      )
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
  order by rq.pool_rank, rq.seen_rank, rq.random_rank
  limit allowed_count;
end;
$$;

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

  select p.service_level into caller_service_level
  from public.profiles p
  where p.id = auth.uid();

  if caller_service_level is null then
    raise exception 'Complete your profile setup before submitting practice';
  end if;

  paid_access := public.has_active_entitlement(pack_record.id);

  if not paid_access then
    select count(*) into used_count
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where aa.user_id = auth.uid()
      and q.exam_pack_id = pack_record.id;

    select count(*) into new_question_count
    from jsonb_array_elements(submitted_answers) answer_item;

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
      and (
        q.service_level is null
        or btrim(q.service_level) = ''
        or q.service_level = caller_service_level
      );

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
