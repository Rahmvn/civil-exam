-- Fix ambiguous PL/pgSQL references in batch progression RPCs.
-- Phase 1 is already deployed, so this forward migration replaces the
-- affected functions without changing product behavior.

create or replace function public.resolve_practice_batch_context_payload(
  requested_subject_id uuid default null,
  requested_subject_slug text default null,
  allow_free_lock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_active_pack public.exam_packs;
  v_target_subject public.subjects;
  v_module_progress public.user_module_progress;
  v_free_module_progress public.user_module_progress;
  v_onboarding_service_level text;
  v_exam_pack_id uuid;
  v_subject_id uuid;
  v_subject_slug text;
  v_subject_name text;
  v_batch_number integer := 1;
  v_batch_size integer := 0;
  v_pass_mark_percent integer := 70;
  v_is_free_attempt boolean := true;
  v_retry_number integer := 0;
  v_has_paid_access boolean := false;
  v_free_module_subject_id uuid;
  v_free_module_subject_slug text;
  v_prior_attempt_count integer := 0;
  v_already_passed_batch boolean := false;
begin
  select ep.*
  into v_active_pack
  from public.exam_packs as ep
  where ep.is_active = true
  order by ep.active_from desc, ep.created_at desc
  limit 1;

  if v_active_pack.id is null then
    raise exception 'No active exam pack is configured';
  end if;

  select p.service_level
  into v_onboarding_service_level
  from public.profiles as p
  where p.id = v_user_id;

  if v_onboarding_service_level is null then
    raise exception 'Complete your profile setup before starting practice';
  end if;

  if requested_subject_id is null and coalesce(btrim(requested_subject_slug), '') = '' then
    raise exception 'Choose a module before starting practice';
  end if;

  select s.*
  into v_target_subject
  from public.subjects as s
  where s.is_active = true
    and (
      (requested_subject_id is not null and s.id = requested_subject_id)
      or (coalesce(btrim(requested_subject_slug), '') <> '' and s.slug = requested_subject_slug)
    )
  order by s.sort_order
  limit 1;

  if v_target_subject.id is null then
    raise exception 'Choose a module before starting practice';
  end if;

  if not exists (
    select 1
    from public.questions as q
    where q.exam_pack_id = v_active_pack.id
      and q.subject_id = v_target_subject.id
      and q.status = 'published'
  ) then
    raise exception 'Questions for this module are not available yet.';
  end if;

  v_has_paid_access := public.has_active_entitlement(v_active_pack.id);

  select ump.*
  into v_free_module_progress
  from public.user_module_progress as ump
  where ump.user_id = v_user_id
    and ump.exam_pack_id = v_active_pack.id
    and ump.selected_for_free_access = true
  limit 1;

  if not v_has_paid_access then
    if v_free_module_progress.subject_id is null then
      if not allow_free_lock then
        raise exception 'Confirm your free batch start from the dashboard.';
      end if;

      insert into public.user_module_progress (
        user_id,
        exam_pack_id,
        subject_id,
        current_batch_number,
        highest_unlocked_batch_number,
        selected_for_free_access
      )
      values (
        v_user_id,
        v_active_pack.id,
        v_target_subject.id,
        1,
        1,
        true
      )
      on conflict (user_id, exam_pack_id, subject_id)
      do update
      set selected_for_free_access = true,
          updated_at = now();

      select ump.*
      into v_free_module_progress
      from public.user_module_progress as ump
      where ump.user_id = v_user_id
        and ump.exam_pack_id = v_active_pack.id
        and ump.subject_id = v_target_subject.id
      limit 1;
    elsif v_free_module_progress.subject_id <> v_target_subject.id then
      raise exception 'Your free batch is locked to another module. Unlock full access to continue.';
    end if;
  end if;

  insert into public.user_module_progress (
    user_id,
    exam_pack_id,
    subject_id,
    current_batch_number,
    highest_unlocked_batch_number,
    selected_for_free_access
  )
  values (
    v_user_id,
    v_active_pack.id,
    v_target_subject.id,
    1,
    1,
    coalesce(v_free_module_progress.subject_id = v_target_subject.id, false)
  )
  on conflict (user_id, exam_pack_id, subject_id)
  do nothing;

  select ump.*
  into v_module_progress
  from public.user_module_progress as ump
  where ump.user_id = v_user_id
    and ump.exam_pack_id = v_active_pack.id
    and ump.subject_id = v_target_subject.id
  limit 1;

  v_batch_number := case
    when v_has_paid_access then greatest(coalesce(v_module_progress.current_batch_number, 1), 1)
    else 1
  end;

  if not exists (
    select 1
    from public.questions as q
    where q.exam_pack_id = v_active_pack.id
      and q.subject_id = v_target_subject.id
      and q.status = 'published'
      and q.batch_number = v_batch_number
  ) then
    raise exception 'Questions for this module are not available yet.';
  end if;

  select count(*)
  into v_prior_attempt_count
  from public.attempts as a
  where a.user_id = v_user_id
    and a.exam_pack_id = v_active_pack.id
    and a.subject_id = v_target_subject.id
    and a.batch_number = v_batch_number
    and a.completed_at is not null;

  select exists (
    select 1
    from public.attempts as a
    where a.user_id = v_user_id
      and a.exam_pack_id = v_active_pack.id
      and a.subject_id = v_target_subject.id
      and a.batch_number = v_batch_number
      and a.completed_at is not null
      and a.passed = true
  )
  into v_already_passed_batch;

  if not v_has_paid_access then
    if v_already_passed_batch then
      raise exception 'Unlock full access to continue to the next batch.';
    end if;

    if coalesce(v_module_progress.free_retry_consumed, false) or v_prior_attempt_count >= 2 then
      raise exception 'Unlock full access to continue.';
    end if;
  end if;

  v_exam_pack_id := v_active_pack.id;
  v_subject_id := v_target_subject.id;
  v_subject_slug := v_target_subject.slug;
  v_subject_name := v_target_subject.name;
  v_batch_size := coalesce(v_target_subject.batch_size, 0);
  v_pass_mark_percent := coalesce(v_target_subject.pass_mark_percent, 70);
  v_is_free_attempt := not v_has_paid_access;
  v_retry_number := greatest(v_prior_attempt_count, 0);
  v_free_module_subject_id := v_free_module_progress.subject_id;

  if v_free_module_progress.subject_id is not null then
    select s.slug
    into v_free_module_subject_slug
    from public.subjects as s
    where s.id = v_free_module_progress.subject_id;
  end if;

  return jsonb_build_object(
    'exam_pack_id', v_exam_pack_id,
    'subject_id', v_subject_id,
    'subject_slug', v_subject_slug,
    'subject_name', v_subject_name,
    'batch_number', v_batch_number,
    'batch_size', v_batch_size,
    'pass_mark_percent', v_pass_mark_percent,
    'is_free_attempt', v_is_free_attempt,
    'retry_number', v_retry_number,
    'has_paid_access', v_has_paid_access,
    'free_module_subject_id', v_free_module_subject_id,
    'free_module_subject_slug', v_free_module_subject_slug
  );
end;
$$;

create or replace function public.resolve_practice_batch_context(
  requested_subject_id uuid default null,
  requested_subject_slug text default null,
  allow_free_lock boolean default false
)
returns table (
  exam_pack_id uuid,
  subject_id uuid,
  subject_slug text,
  subject_name text,
  batch_number integer,
  batch_size integer,
  pass_mark_percent integer,
  is_free_attempt boolean,
  retry_number integer,
  has_paid_access boolean,
  free_module_subject_id uuid,
  free_module_subject_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from jsonb_to_record(
    public.resolve_practice_batch_context_payload(
      requested_subject_id => resolve_practice_batch_context.requested_subject_id,
      requested_subject_slug => resolve_practice_batch_context.requested_subject_slug,
      allow_free_lock => resolve_practice_batch_context.allow_free_lock
    )
  ) as ctx(
    exam_pack_id uuid,
    subject_id uuid,
    subject_slug text,
    subject_name text,
    batch_number integer,
    batch_size integer,
    pass_mark_percent integer,
    is_free_attempt boolean,
    retry_number integer,
    has_paid_access boolean,
    free_module_subject_id uuid,
    free_module_subject_slug text
  );
$$;

create or replace function public.start_practice_batch(
  requested_subject_slug text
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
  reference_note text,
  batch_number integer,
  batch_size integer,
  pass_mark_percent integer,
  is_free_attempt boolean,
  retry_number integer,
  display_order integer
)
language sql
volatile
security definer
set search_path = public
as $$
  with batch_ctx as (
    select *
    from public.resolve_practice_batch_context(
      requested_subject_id => null,
      requested_subject_slug => start_practice_batch.requested_subject_slug,
      allow_free_lock => true
    )
  ),
  ordered_questions as (
    select
      q.id,
      q.subject_id,
      batch_ctx.subject_name,
      batch_ctx.subject_slug,
      q.service_level,
      q.difficulty,
      q.question_text,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.reference_note,
      batch_ctx.batch_number,
      batch_ctx.batch_size,
      batch_ctx.pass_mark_percent,
      batch_ctx.is_free_attempt,
      batch_ctx.retry_number,
      row_number() over (
        order by coalesce(q.batch_position, 1000000), random()
      )::integer as display_order
    from batch_ctx
    join public.questions as q
      on q.exam_pack_id = batch_ctx.exam_pack_id
     and q.subject_id = batch_ctx.subject_id
     and q.status = 'published'
     and q.batch_number = batch_ctx.batch_number
  )
  select
    oq.id,
    oq.subject_id,
    oq.subject_name,
    oq.subject_slug,
    oq.service_level,
    oq.difficulty,
    oq.question_text,
    oq.option_a,
    oq.option_b,
    oq.option_c,
    oq.option_d,
    null::text as correct_option,
    null::text as explanation,
    oq.reference_note,
    oq.batch_number,
    oq.batch_size,
    oq.pass_mark_percent,
    oq.is_free_attempt,
    oq.retry_number,
    oq.display_order
  from ordered_questions as oq
  order by oq.display_order;
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
  reference_note text,
  batch_number integer,
  batch_size integer,
  pass_mark_percent integer,
  is_free_attempt boolean,
  retry_number integer,
  display_order integer
)
language sql
volatile
security definer
set search_path = public
as $$
  with batch_ctx as (
    select *
    from public.resolve_practice_batch_context(
      requested_subject_id => get_practice_questions.requested_subject_id,
      requested_subject_slug => null,
      allow_free_lock => false
    )
  ),
  ordered_questions as (
    select
      q.id,
      q.subject_id,
      batch_ctx.subject_name,
      batch_ctx.subject_slug,
      q.service_level,
      q.difficulty,
      q.question_text,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.reference_note,
      batch_ctx.batch_number,
      batch_ctx.batch_size,
      batch_ctx.pass_mark_percent,
      batch_ctx.is_free_attempt,
      batch_ctx.retry_number,
      row_number() over (
        order by coalesce(q.batch_position, 1000000), random()
      )::integer as display_order
    from batch_ctx
    join public.questions as q
      on q.exam_pack_id = batch_ctx.exam_pack_id
     and q.subject_id = batch_ctx.subject_id
     and q.status = 'published'
     and q.batch_number = batch_ctx.batch_number
  )
  select
    oq.id,
    oq.subject_id,
    oq.subject_name,
    oq.subject_slug,
    oq.service_level,
    oq.difficulty,
    oq.question_text,
    oq.option_a,
    oq.option_b,
    oq.option_c,
    oq.option_d,
    null::text as correct_option,
    null::text as explanation,
    oq.reference_note,
    oq.batch_number,
    oq.batch_size,
    oq.pass_mark_percent,
    oq.is_free_attempt,
    oq.retry_number,
    oq.display_order
  from ordered_questions as oq
  order by oq.display_order
  limit coalesce(get_practice_questions.requested_limit, 1000);
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
  review jsonb,
  batch_number integer,
  score_percent integer,
  passed boolean,
  retry_number integer,
  next_action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_attempt_id uuid;
  v_answer_row record;
  v_question_row public.questions;
  v_module_progress_id uuid;
  v_score integer := 0;
  v_total_questions integer := 0;
  v_score_percent integer := 0;
  v_passed boolean := false;
  v_next_action text := 'back_to_dashboard';
  v_review jsonb := '[]'::jsonb;
  v_user_id uuid := auth.uid();
begin
  select *
  into v_ctx
  from public.resolve_practice_batch_context(
    requested_subject_id => submit_attempt.submitted_subject_id,
    requested_subject_slug => null,
    allow_free_lock => false
  );

  if v_ctx.subject_id is null then
    raise exception 'Choose a module before starting practice';
  end if;

  if submitted_answers is null
     or jsonb_typeof(submitted_answers) <> 'array'
     or jsonb_array_length(submitted_answers) = 0 then
    raise exception 'Answer at least one question before submitting.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(submitted_answers) as submitted_answer
    where not exists (
      select 1
      from public.questions as q
      where q.id = (submitted_answer->>'question_id')::uuid
        and q.exam_pack_id = v_ctx.exam_pack_id
        and q.subject_id = v_ctx.subject_id
        and q.status = 'published'
        and q.batch_number = v_ctx.batch_number
    )
  ) then
    raise exception 'This batch is no longer available. Start again from the dashboard.';
  end if;

  insert into public.attempts (
    user_id,
    exam_pack_id,
    mode,
    subject_id,
    service_level,
    batch_number,
    retry_number,
    is_free_attempt
  )
  values (
    v_user_id,
    v_ctx.exam_pack_id,
    submitted_mode,
    v_ctx.subject_id,
    null,
    v_ctx.batch_number,
    v_ctx.retry_number,
    v_ctx.is_free_attempt
  )
  returning id into v_attempt_id;

  for v_answer_row in
    select
      payload.submitted_answer,
      payload.ordinality::integer as ordinal_position
    from jsonb_array_elements(submitted_answers) with ordinality as payload(submitted_answer, ordinality)
  loop
    select q.*
    into v_question_row
    from public.questions as q
    where q.id = (v_answer_row.submitted_answer->>'question_id')::uuid
      and q.exam_pack_id = v_ctx.exam_pack_id
      and q.subject_id = v_ctx.subject_id
      and q.status = 'published'
      and q.batch_number = v_ctx.batch_number;

    if v_question_row.id is null then
      continue;
    end if;

    v_total_questions := v_total_questions + 1;

    if upper(coalesce(v_answer_row.submitted_answer->>'selected_option', '')) = v_question_row.correct_option then
      v_score := v_score + 1;
    end if;

    insert into public.attempt_answers (
      attempt_id,
      user_id,
      question_id,
      selected_option,
      is_correct,
      time_spent_seconds,
      display_order
    )
    values (
      v_attempt_id,
      v_user_id,
      v_question_row.id,
      upper(coalesce(v_answer_row.submitted_answer->>'selected_option', '')),
      upper(coalesce(v_answer_row.submitted_answer->>'selected_option', '')) = v_question_row.correct_option,
      greatest(coalesce((v_answer_row.submitted_answer->>'time_spent_seconds')::integer, 0), 0),
      coalesce((v_answer_row.submitted_answer->>'display_order')::integer, v_answer_row.ordinal_position)
    );

    v_review := v_review || jsonb_build_object(
      'question_id', v_question_row.id,
      'selected_option', upper(coalesce(v_answer_row.submitted_answer->>'selected_option', '')),
      'correct_option', v_question_row.correct_option,
      'is_correct', upper(coalesce(v_answer_row.submitted_answer->>'selected_option', '')) = v_question_row.correct_option,
      'explanation', v_question_row.explanation,
      'reference_note', v_question_row.reference_note,
      'display_order', coalesce((v_answer_row.submitted_answer->>'display_order')::integer, v_answer_row.ordinal_position)
    );
  end loop;

  if v_total_questions > 0 then
    v_score_percent := round((v_score::numeric * 100) / v_total_questions)::integer;
  end if;

  v_passed := v_total_questions > 0 and v_score_percent >= coalesce(v_ctx.pass_mark_percent, 70);

  update public.attempts as a
  set completed_at = now(),
      score = v_score,
      total_questions = v_total_questions,
      score_percent = v_score_percent,
      passed = v_passed
  where a.id = v_attempt_id;

  select ump.id
  into v_module_progress_id
  from public.user_module_progress as ump
  where ump.user_id = v_user_id
    and ump.exam_pack_id = v_ctx.exam_pack_id
    and ump.subject_id = v_ctx.subject_id
  limit 1;

  if v_ctx.is_free_attempt then
    update public.user_module_progress as ump
    set
      free_first_attempt_completed = true,
      free_retry_consumed = case
        when v_ctx.retry_number >= 1 then true
        else ump.free_retry_consumed
      end,
      last_attempt_id = v_attempt_id,
      last_attempted_at = now(),
      current_batch_number = 1,
      highest_unlocked_batch_number = greatest(coalesce(ump.highest_unlocked_batch_number, 1), 1)
    where ump.id = v_module_progress_id;

    v_next_action := case
      when v_passed then 'unlock_full_access'
      when v_ctx.retry_number >= 1 then 'unlock_full_access'
      else 'retry_batch'
    end;
  else
    update public.user_module_progress as ump
    set
      last_attempt_id = v_attempt_id,
      last_attempted_at = now(),
      current_batch_number = case
        when v_passed then v_ctx.batch_number + 1
        else v_ctx.batch_number
      end,
      highest_unlocked_batch_number = case
        when v_passed then greatest(coalesce(ump.highest_unlocked_batch_number, 1), v_ctx.batch_number + 1)
        else greatest(coalesce(ump.highest_unlocked_batch_number, 1), v_ctx.batch_number)
      end
    where ump.id = v_module_progress_id;

    v_next_action := case
      when v_passed then 'proceed_next_batch'
      else 'retry_batch'
    end;
  end if;

  return query
  select
    v_attempt_id,
    v_score,
    v_total_questions,
    v_review,
    v_ctx.batch_number,
    v_score_percent,
    v_passed,
    v_ctx.retry_number,
    v_next_action;
end;
$$;

create or replace function public.get_candidate_summary()
returns table (
  pack_id uuid,
  pack_name text,
  price_kobo integer,
  currency text,
  trial_question_limit integer,
  trial_questions_used bigint,
  has_paid_access boolean,
  access_expires_at timestamptz,
  free_module_subject_id uuid,
  free_module_subject_slug text,
  free_first_attempt_completed boolean,
  free_retry_consumed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with active_pack as (
    select ep.*
    from public.exam_packs as ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  answer_usage as (
    select count(*) as used
    from public.attempt_answers as aa
    join public.questions as q on q.id = aa.question_id
    join active_pack as ap on ap.id = q.exam_pack_id
    where aa.user_id = auth.uid()
  ),
  active_entitlement as (
    select e.expires_at
    from public.entitlements as e
    join active_pack as ap on ap.id = e.exam_pack_id
    where e.user_id = auth.uid()
      and e.status = 'active'
      and e.expires_at > now()
    order by e.expires_at desc
    limit 1
  ),
  free_module as (
    select
      ump.subject_id,
      s.slug as subject_slug,
      ump.free_first_attempt_completed,
      ump.free_retry_consumed
    from public.user_module_progress as ump
    join public.subjects as s on s.id = ump.subject_id
    join active_pack as ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  )
  select
    ap.id as pack_id,
    ap.name as pack_name,
    ap.price_kobo,
    ap.currency,
    ap.trial_question_limit,
    coalesce(au.used, 0) as trial_questions_used,
    exists (select 1 from active_entitlement) as has_paid_access,
    (select ae.expires_at from active_entitlement as ae) as access_expires_at,
    (select fm.subject_id from free_module as fm) as free_module_subject_id,
    (select fm.subject_slug from free_module as fm) as free_module_subject_slug,
    coalesce((select fm.free_first_attempt_completed from free_module as fm), false) as free_first_attempt_completed,
    coalesce((select fm.free_retry_consumed from free_module as fm), false) as free_retry_consumed
  from active_pack as ap
  left join answer_usage as au on true;
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
  has_questions boolean,
  current_batch_number integer,
  highest_unlocked_batch_number integer,
  batch_size integer,
  pass_mark_percent integer,
  last_batch_score_percent integer,
  last_batch_passed boolean,
  selected_for_free_access boolean,
  free_retry_consumed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with active_pack as (
    select ep.id
    from public.exam_packs as ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  )
  select
    s.id as subject_id,
    s.name as subject_name,
    s.slug as subject_slug,
    count(a.id) filter (where a.completed_at is not null) as completed_attempts,
    count(a.id) filter (
      where a.completed_at is not null
        and a.passed = true
    ) as mastered_attempts,
    (
      select a2.score_percent
      from public.attempts as a2
      join active_pack as ap2 on ap2.id = a2.exam_pack_id
      where a2.user_id = auth.uid()
        and a2.subject_id = s.id
        and a2.completed_at is not null
      order by a2.completed_at desc
      limit 1
    ) as last_score_percent,
    coalesce((
      select count(*)
      from public.attempt_answers as aa
      join public.questions as q on q.id = aa.question_id
      join active_pack as ap3 on ap3.id = q.exam_pack_id
      where aa.user_id = auth.uid()
        and q.subject_id = s.id
        and aa.is_correct = false
    ), 0) as weak_question_count,
    exists (
      select 1
      from public.questions as q
      join active_pack as ap4 on ap4.id = q.exam_pack_id
      where q.subject_id = s.id
        and q.status = 'published'
    ) as has_questions,
    coalesce(ump.current_batch_number, 1) as current_batch_number,
    coalesce(ump.highest_unlocked_batch_number, 1) as highest_unlocked_batch_number,
    coalesce(s.batch_size, 0) as batch_size,
    coalesce(s.pass_mark_percent, 70) as pass_mark_percent,
    (
      select a3.score_percent
      from public.attempts as a3
      join active_pack as ap5 on ap5.id = a3.exam_pack_id
      where a3.user_id = auth.uid()
        and a3.subject_id = s.id
        and a3.completed_at is not null
      order by a3.completed_at desc
      limit 1
    ) as last_batch_score_percent,
    (
      select a4.passed
      from public.attempts as a4
      join active_pack as ap6 on ap6.id = a4.exam_pack_id
      where a4.user_id = auth.uid()
        and a4.subject_id = s.id
        and a4.completed_at is not null
      order by a4.completed_at desc
      limit 1
    ) as last_batch_passed,
    coalesce(ump.selected_for_free_access, false) as selected_for_free_access,
    coalesce(ump.free_retry_consumed, false) as free_retry_consumed
  from public.subjects as s
  left join active_pack as ap on true
  left join public.attempts as a
    on a.subject_id = s.id
   and a.user_id = auth.uid()
   and a.exam_pack_id = ap.id
  left join public.user_module_progress as ump
    on ump.user_id = auth.uid()
   and ump.subject_id = s.id
   and ump.exam_pack_id = ap.id
  where s.is_active = true
  group by
    s.id,
    s.name,
    s.slug,
    s.sort_order,
    s.batch_size,
    s.pass_mark_percent,
    ump.current_batch_number,
    ump.highest_unlocked_batch_number,
    ump.selected_for_free_access,
    ump.free_retry_consumed
  order by s.sort_order;
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
  reference_note text,
  batch_number integer,
  score_percent integer,
  passed boolean,
  retry_number integer,
  display_order integer,
  next_action text
)
language sql
stable
security definer
set search_path = public
as $$
  with target_attempt as (
    select
      a.id,
      a.completed_at,
      a.score,
      a.total_questions,
      a.subject_id,
      a.batch_number,
      a.score_percent,
      a.passed,
      a.retry_number,
      a.is_free_attempt
    from public.attempts as a
    where a.user_id = auth.uid()
      and a.completed_at is not null
      and (get_attempt_review.requested_attempt_id is null or a.id = get_attempt_review.requested_attempt_id)
    order by a.completed_at desc
    limit 1
  )
  select
    ta.id as attempt_id,
    ta.completed_at,
    ta.score,
    ta.total_questions,
    ta.subject_id,
    s.name as subject_name,
    q.id as question_id,
    q.question_text,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d,
    aa.selected_option,
    q.correct_option,
    aa.is_correct,
    q.explanation,
    q.reference_note,
    ta.batch_number,
    ta.score_percent,
    ta.passed,
    ta.retry_number,
    aa.display_order,
    case
      when ta.is_free_attempt and ta.passed then 'unlock_full_access'
      when ta.is_free_attempt and not ta.passed and ta.retry_number >= 1 then 'unlock_full_access'
      when ta.is_free_attempt and not ta.passed then 'retry_batch'
      when ta.passed then 'proceed_next_batch'
      else 'retry_batch'
    end as next_action
  from target_attempt as ta
  join public.attempt_answers as aa on aa.attempt_id = ta.id
  join public.questions as q on q.id = aa.question_id
  join public.subjects as s on s.id = q.subject_id
  order by coalesce(aa.display_order, 999999), aa.answered_at;
$$;
