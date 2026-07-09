-- Batch access/progression policy refinement.
-- Backend owns batch access state for free and paid users.

drop function if exists public.get_batch_access_state(text, integer);

create or replace function public.get_batch_access_state(
  requested_subject_slug text,
  requested_batch_number integer default 1
)
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  batch_number integer,
  is_paid boolean,
  is_free_module boolean,
  free_module_slug text,
  published_question_count integer,
  expected_batch_size integer,
  can_start boolean,
  state text,
  reason_code text,
  attempt_count integer,
  free_failed_attempts integer,
  best_score integer,
  last_score integer,
  passed boolean,
  next_recommended_batch integer,
  next_published_batch integer,
  free_first_attempt_completed boolean,
  free_retry_consumed boolean,
  message text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_active_pack public.exam_packs;
  v_subject public.subjects;
  v_batch_number integer := greatest(coalesce(requested_batch_number, 1), 1);
  v_is_paid boolean := false;
  v_free_module_slug text;
  v_is_free_module boolean := false;
  v_free_first_attempt_completed boolean := false;
  v_free_retry_consumed boolean := false;
  v_published_question_count integer := 0;
  v_expected_batch_size integer := 0;
  v_attempt_count integer := 0;
  v_free_failed_attempts integer := 0;
  v_best_score integer;
  v_last_score integer;
  v_passed boolean := false;
  v_current_batch_number integer := 1;
  v_last_attempt_batch integer;
  v_last_attempt_passed boolean;
  v_next_published_batch integer;
  v_next_recommended_batch integer := 1;
  v_state text := 'unavailable_not_published';
  v_reason_code text := 'no_questions';
  v_can_start boolean := false;
  v_message text := 'This batch is not available yet.';
  v_has_any_published boolean := false;
begin
  select ep.*
  into v_active_pack
  from public.exam_packs as ep
  where ep.is_active = true
  order by ep.active_from desc, ep.created_at desc
  limit 1;

  if v_active_pack.id is null then
    return query
    select
      null::uuid,
      null::text,
      coalesce(requested_subject_slug, ''),
      v_batch_number,
      false,
      false,
      null::text,
      0,
      0,
      false,
      'unavailable_not_published',
      'no_questions',
      0,
      0,
      null::integer,
      null::integer,
      false,
      1,
      null::integer,
      false,
      false,
      'This batch is not available yet.';
    return;
  end if;

  select s.*
  into v_subject
  from public.subjects as s
  where s.is_active = true
    and s.slug = requested_subject_slug
  limit 1;

  if v_subject.id is null then
    return query
    select
      null::uuid,
      null::text,
      coalesce(requested_subject_slug, ''),
      v_batch_number,
      false,
      false,
      null::text,
      0,
      0,
      false,
      'unavailable_not_published',
      'no_questions',
      0,
      0,
      null::integer,
      null::integer,
      false,
      1,
      null::integer,
      false,
      false,
      'This batch is not available yet.';
    return;
  end if;

  v_expected_batch_size := coalesce(v_subject.batch_size, 0);

  if v_user_id is null then
    select count(*)::integer
    into v_published_question_count
    from public.questions as q
    where q.exam_pack_id = v_active_pack.id
      and q.subject_id = v_subject.id
      and q.status = 'published'
      and q.batch_number = v_batch_number;

    return query
    select
      v_subject.id,
      v_subject.name,
      v_subject.slug,
      v_batch_number,
      false,
      false,
      null::text,
      v_published_question_count,
      v_expected_batch_size,
      false,
      case when v_published_question_count > 0 then 'locked_requires_payment' else 'unavailable_not_published' end,
      case when v_published_question_count > 0 then 'unauthenticated' else 'not_published' end,
      0,
      0,
      null::integer,
      null::integer,
      false,
      1,
      null::integer,
      false,
      false,
      case when v_published_question_count > 0 then 'Please sign in to continue.' else 'This batch is not available yet.' end;
    return;
  end if;

  v_is_paid := public.has_active_entitlement(v_active_pack.id);

  select
    s.slug,
    ump.free_first_attempt_completed,
    ump.free_retry_consumed
  into
    v_free_module_slug,
    v_free_first_attempt_completed,
    v_free_retry_consumed
  from public.user_module_progress as ump
  join public.subjects as s on s.id = ump.subject_id
  where ump.user_id = v_user_id
    and ump.exam_pack_id = v_active_pack.id
    and ump.selected_for_free_access = true
  limit 1;

  v_is_free_module := v_free_module_slug = v_subject.slug;

  select count(*)::integer
  into v_published_question_count
  from public.questions as q
  where q.exam_pack_id = v_active_pack.id
    and q.subject_id = v_subject.id
    and q.status = 'published'
    and q.batch_number = v_batch_number;

  select exists (
    select 1
    from public.questions as q
    where q.exam_pack_id = v_active_pack.id
      and q.subject_id = v_subject.id
      and q.status = 'published'
  )
  into v_has_any_published;

  select
    count(*) filter (where a.completed_at is not null)::integer,
    count(*) filter (
      where a.completed_at is not null
        and a.is_free_attempt = true
        and a.passed = false
    )::integer,
    max(a.score_percent)::integer,
    coalesce(bool_or(a.passed), false)
  into
    v_attempt_count,
    v_free_failed_attempts,
    v_best_score,
    v_passed
  from public.attempts as a
  where a.user_id = v_user_id
    and a.exam_pack_id = v_active_pack.id
    and a.subject_id = v_subject.id
    and a.batch_number = v_batch_number;

  select a.score_percent
  into v_last_score
  from public.attempts as a
  where a.user_id = v_user_id
    and a.exam_pack_id = v_active_pack.id
    and a.subject_id = v_subject.id
    and a.batch_number = v_batch_number
    and a.completed_at is not null
  order by a.completed_at desc
  limit 1;

  select
    coalesce(ump.current_batch_number, 1)
  into v_current_batch_number
  from public.user_module_progress as ump
  where ump.user_id = v_user_id
    and ump.exam_pack_id = v_active_pack.id
    and ump.subject_id = v_subject.id
  limit 1;

  select
    a.batch_number,
    a.passed
  into
    v_last_attempt_batch,
    v_last_attempt_passed
  from public.attempts as a
  where a.user_id = v_user_id
    and a.exam_pack_id = v_active_pack.id
    and a.subject_id = v_subject.id
    and a.completed_at is not null
  order by a.completed_at desc
  limit 1;

  select min(q.batch_number)
  into v_next_published_batch
  from public.questions as q
  where q.exam_pack_id = v_active_pack.id
    and q.subject_id = v_subject.id
    and q.status = 'published'
    and q.batch_number > v_batch_number;

  if v_is_paid then
    select coalesce(
      case
        when v_last_attempt_batch is not null
          and v_last_attempt_passed = false
          and exists (
            select 1
            from public.questions as q
            where q.exam_pack_id = v_active_pack.id
              and q.subject_id = v_subject.id
              and q.status = 'published'
              and q.batch_number = v_last_attempt_batch
          )
        then v_last_attempt_batch
        else null
      end,
      (
        select min(q.batch_number)
        from public.questions as q
        where q.exam_pack_id = v_active_pack.id
          and q.subject_id = v_subject.id
          and q.status = 'published'
          and q.batch_number >= greatest(coalesce(v_current_batch_number, 1), 1)
      ),
      (
        select min(q.batch_number)
        from public.questions as q
        where q.exam_pack_id = v_active_pack.id
          and q.subject_id = v_subject.id
          and q.status = 'published'
      ),
      1
    )
    into v_next_recommended_batch;
  else
    v_next_recommended_batch := 1;
  end if;

  if v_published_question_count = 0 then
    v_state := 'unavailable_not_published';
    v_reason_code := case when v_has_any_published then 'not_published' else 'no_questions' end;
    v_can_start := false;
    v_message := 'This batch is not available yet.';
  elsif v_is_paid then
    if v_passed then
      v_state := 'completed_passed';
      v_reason_code := 'paid_access';
      v_can_start := true;
      v_message := 'You have already passed this batch. You can review or retry it any time.';
    elsif v_attempt_count > 0 then
      v_state := 'completed_failed';
      v_reason_code := 'paid_access';
      v_can_start := true;
      v_message := 'You scored below 70%. You can retry, or continue if another published batch is available.';
    else
      v_state := 'available';
      v_reason_code := 'paid_access';
      v_can_start := true;
      v_message := 'This batch is available.';
    end if;
  elsif v_batch_number > 1 then
    v_state := 'locked_requires_payment';
    v_reason_code := 'free_next_batch_requires_payment';
    v_can_start := false;
    v_message := 'Unlock full access to continue to another batch.';
  elsif v_free_module_slug is not null and not v_is_free_module then
    v_state := 'locked_requires_payment';
    v_reason_code := 'free_different_module_requires_payment';
    v_can_start := false;
    v_message := 'Unlock full access to continue with another module.';
  elsif v_passed then
    v_state := 'completed_passed';
    v_reason_code := 'free_batch_passed_requires_payment';
    v_can_start := false;
    v_message := 'You passed the free batch. Unlock full access to continue.';
  elsif v_free_retry_consumed or v_free_failed_attempts >= 2 then
    v_state := 'locked_requires_payment';
    v_reason_code := 'free_retry_used_requires_payment';
    v_can_start := false;
    v_message := 'You already used your free retry. Unlock full access to continue.';
  elsif v_free_first_attempt_completed or v_attempt_count > 0 then
    v_state := 'completed_failed';
    v_reason_code := 'free_retry_available';
    v_can_start := true;
    v_message := 'You can retry your free batch once.';
  else
    v_state := 'available';
    v_reason_code := 'free_batch_available';
    v_can_start := true;
    v_message := 'Batch 1 is available.';
  end if;

  return query
  select
    v_subject.id,
    v_subject.name,
    v_subject.slug,
    v_batch_number,
    v_is_paid,
    v_is_free_module,
    v_free_module_slug,
    v_published_question_count,
    v_expected_batch_size,
    v_can_start,
    v_state,
    v_reason_code,
    coalesce(v_attempt_count, 0),
    coalesce(v_free_failed_attempts, 0),
    v_best_score,
    v_last_score,
    coalesce(v_passed, false),
    v_next_recommended_batch,
    v_next_published_batch,
    coalesce(v_free_first_attempt_completed, false),
    coalesce(v_free_retry_consumed, false),
    v_message;
end;
$$;

drop function if exists public.get_module_batch_access(text);

create or replace function public.get_module_batch_access(
  requested_subject_slug text default null
)
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  batch_number integer,
  is_paid boolean,
  is_free_module boolean,
  free_module_slug text,
  published_question_count integer,
  expected_batch_size integer,
  can_start boolean,
  state text,
  reason_code text,
  attempt_count integer,
  free_failed_attempts integer,
  best_score integer,
  last_score integer,
  passed boolean,
  next_recommended_batch integer,
  next_published_batch integer,
  free_first_attempt_completed boolean,
  free_retry_consumed boolean,
  message text,
  is_recommended boolean
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
  ),
  subjects_scope as (
    select s.id, s.slug, s.name, s.sort_order
    from public.subjects as s
    where s.is_active = true
      and (
        requested_subject_slug is null
        or s.slug = requested_subject_slug
      )
  ),
  batch_span as (
    select
      ss.id as subject_id,
      greatest(
        coalesce(
          max(q.batch_number) filter (where q.status in ('draft', 'review', 'published')),
          1
        ),
        1
      )::integer as max_batch_number
    from subjects_scope as ss
    left join active_pack as ap on true
    left join public.questions as q
      on q.exam_pack_id = ap.id
     and q.subject_id = ss.id
    group by ss.id
  ),
  batch_numbers as (
    select
      ss.id as subject_id,
      ss.slug as subject_slug,
      ss.name as subject_name,
      ss.sort_order,
      gs.batch_number
    from subjects_scope as ss
    join batch_span as bs on bs.subject_id = ss.id
    cross join lateral generate_series(1, bs.max_batch_number) as gs(batch_number)
  )
  select
    gas.subject_id,
    gas.subject_name,
    gas.subject_slug,
    gas.batch_number,
    gas.is_paid,
    gas.is_free_module,
    gas.free_module_slug,
    gas.published_question_count,
    gas.expected_batch_size,
    gas.can_start,
    gas.state,
    gas.reason_code,
    gas.attempt_count,
    gas.free_failed_attempts,
    gas.best_score,
    gas.last_score,
    gas.passed,
    gas.next_recommended_batch,
    gas.next_published_batch,
    gas.free_first_attempt_completed,
    gas.free_retry_consumed,
    gas.message,
    gas.batch_number = gas.next_recommended_batch as is_recommended
  from batch_numbers as bn
  cross join lateral public.get_batch_access_state(
    bn.subject_slug,
    bn.batch_number
  ) as gas
  order by bn.sort_order, bn.batch_number;
$$;

drop function if exists public.resolve_practice_batch_context(uuid, text, boolean);
drop function if exists public.resolve_practice_batch_context_payload(uuid, text, boolean);

create or replace function public.resolve_practice_batch_context_payload(
  requested_subject_id uuid default null,
  requested_subject_slug text default null,
  requested_batch_number integer default null,
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
  v_onboarding_service_level text;
  v_has_paid_access boolean := false;
  v_batch_number integer := greatest(coalesce(requested_batch_number, 0), 0);
  v_access record;
  v_free_module_subject_id uuid;
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

  v_has_paid_access := public.has_active_entitlement(v_active_pack.id);

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
    false
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

  if coalesce(requested_batch_number, 0) <= 0 then
    if v_has_paid_access then
      select coalesce(
        (
          select gas.next_recommended_batch
          from public.get_batch_access_state(
            v_target_subject.slug,
            greatest(coalesce(v_module_progress.current_batch_number, 1), 1)
          ) as gas
          limit 1
        ),
        1
      )
      into v_batch_number;
    else
      v_batch_number := 1;
    end if;
  end if;

  select *
  into v_access
  from public.get_batch_access_state(v_target_subject.slug, greatest(v_batch_number, 1))
  limit 1;

  if not coalesce(v_access.can_start, false) then
    raise exception '%', coalesce(v_access.message, 'This batch is not available yet.');
  end if;

  if not v_has_paid_access
     and not allow_free_lock
     and v_access.free_module_slug is null
     and greatest(v_batch_number, 1) = 1 then
    raise exception 'Confirm your free batch start from the dashboard.';
  end if;

  if not v_has_paid_access
     and allow_free_lock
     and v_access.free_module_slug is null
     and greatest(v_batch_number, 1) = 1 then
    update public.user_module_progress as ump
    set selected_for_free_access = true,
        updated_at = now()
    where ump.user_id = v_user_id
      and ump.exam_pack_id = v_active_pack.id
      and ump.subject_id = v_target_subject.id;
  end if;

  select s.id
  into v_free_module_subject_id
  from public.user_module_progress as ump
  join public.subjects as s on s.id = ump.subject_id
  where ump.user_id = v_user_id
    and ump.exam_pack_id = v_active_pack.id
    and ump.selected_for_free_access = true
  limit 1;

  return jsonb_build_object(
    'exam_pack_id', v_active_pack.id,
    'subject_id', v_target_subject.id,
    'subject_slug', v_target_subject.slug,
    'subject_name', v_target_subject.name,
    'batch_number', greatest(v_batch_number, 1),
    'batch_size', coalesce(v_target_subject.batch_size, 0),
    'pass_mark_percent', coalesce(v_target_subject.pass_mark_percent, 70),
    'is_free_attempt', not v_has_paid_access,
    'retry_number', greatest(coalesce(v_access.attempt_count, 0), 0),
    'has_paid_access', v_has_paid_access,
    'free_module_subject_id', v_free_module_subject_id,
    'free_module_subject_slug', (
      select s.slug
      from public.subjects as s
      where s.id = v_free_module_subject_id
    )
  );
end;
$$;

create or replace function public.resolve_practice_batch_context(
  requested_subject_id uuid default null,
  requested_subject_slug text default null,
  requested_batch_number integer default null,
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
      requested_batch_number => resolve_practice_batch_context.requested_batch_number,
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

drop function if exists public.start_practice_batch(text);

create or replace function public.start_practice_batch(
  requested_subject_slug text,
  requested_batch_number integer default null
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
      requested_batch_number => start_practice_batch.requested_batch_number,
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

drop function if exists public.get_practice_questions(uuid, integer);

create or replace function public.get_practice_questions(
  requested_subject_id uuid,
  requested_limit integer default 30,
  requested_batch_number integer default null
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
      requested_batch_number => get_practice_questions.requested_batch_number,
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

drop function if exists public.submit_attempt(public.attempt_mode, uuid, jsonb);

create or replace function public.submit_attempt(
  submitted_mode public.attempt_mode,
  submitted_subject_id uuid,
  submitted_answers jsonb,
  submitted_batch_number integer default null
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
  v_next_action text := 'review_only';
  v_review jsonb := '[]'::jsonb;
  v_user_id uuid := auth.uid();
  v_next_published_batch integer;
begin
  select *
  into v_ctx
  from public.resolve_practice_batch_context(
    requested_subject_id => submit_attempt.submitted_subject_id,
    requested_subject_slug => null,
    requested_batch_number => submit_attempt.submitted_batch_number,
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

  select min(q.batch_number)
  into v_next_published_batch
  from public.questions as q
  where q.exam_pack_id = v_ctx.exam_pack_id
    and q.subject_id = v_ctx.subject_id
    and q.status = 'published'
    and q.batch_number > v_ctx.batch_number;

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
      else 'retry_free_batch'
    end;
  else
    update public.user_module_progress as ump
    set
      last_attempt_id = v_attempt_id,
      last_attempted_at = now(),
      current_batch_number = case
        when v_passed and v_next_published_batch is not null then v_next_published_batch
        else v_ctx.batch_number
      end,
      highest_unlocked_batch_number = case
        when v_passed and v_next_published_batch is not null
          then greatest(coalesce(ump.highest_unlocked_batch_number, 1), v_next_published_batch)
        else greatest(coalesce(ump.highest_unlocked_batch_number, 1), v_ctx.batch_number)
      end
    where ump.id = v_module_progress_id;

    v_next_action := case
      when v_passed and v_next_published_batch is not null then 'next_batch'
      when v_passed then 'module_complete'
      when v_next_published_batch is not null then 'retry_or_next'
      else 'review_only'
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

drop function if exists public.get_attempt_review(uuid);

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
  subject_slug text,
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
  pass_mark_percent integer,
  next_action text,
  next_batch_number integer,
  can_retry boolean
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
  ),
  next_batch as (
    select
      ta.id as attempt_id,
      min(q.batch_number) as next_batch_number
    from target_attempt as ta
    join public.attempts as a on a.id = ta.id
    join public.questions as q
      on q.exam_pack_id = a.exam_pack_id
     and q.subject_id = a.subject_id
     and q.status = 'published'
     and q.batch_number > ta.batch_number
    group by ta.id
  )
  select
    ta.id as attempt_id,
    ta.completed_at,
    ta.score,
    ta.total_questions,
    ta.subject_id,
    s.name as subject_name,
    s.slug as subject_slug,
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
    coalesce(s.pass_mark_percent, 70) as pass_mark_percent,
    case
      when ta.is_free_attempt and ta.passed then 'unlock_full_access'
      when ta.is_free_attempt and not ta.passed and ta.retry_number >= 1 then 'unlock_full_access'
      when ta.is_free_attempt and not ta.passed then 'retry_free_batch'
      when ta.passed and nb.next_batch_number is not null then 'next_batch'
      when ta.passed then 'module_complete'
      when nb.next_batch_number is not null then 'retry_or_next'
      else 'review_only'
    end as next_action,
    nb.next_batch_number,
    case
      when ta.is_free_attempt and ta.passed then false
      when ta.is_free_attempt and not ta.passed and ta.retry_number >= 1 then false
      else true
    end as can_retry
  from target_attempt as ta
  join public.attempt_answers as aa on aa.attempt_id = ta.id
  join public.questions as q on q.id = aa.question_id
  join public.subjects as s on s.id = q.subject_id
  left join next_batch as nb on nb.attempt_id = ta.id
  order by coalesce(aa.display_order, 999999), aa.answered_at;
$$;
