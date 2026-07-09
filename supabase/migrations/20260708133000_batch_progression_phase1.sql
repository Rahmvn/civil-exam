-- Phase 1 batch progression foundation.
-- Local-only until explicitly approved for remote push.

alter table public.questions
  add column if not exists batch_number integer not null default 1,
  add column if not exists batch_position integer;

alter table public.subjects
  add column if not exists batch_size integer,
  add column if not exists pass_mark_percent integer not null default 70;

do $$
declare
  legacy_subject_id uuid;
  canonical_subject_id uuid;
begin
  select id
  into legacy_subject_id
  from public.subjects
  where slug = 'current-affairs-general-knowledge'
  limit 1;

  select id
  into canonical_subject_id
  from public.subjects
  where slug = 'current-affairs'
  limit 1;

  if legacy_subject_id is not null and canonical_subject_id is not null and legacy_subject_id <> canonical_subject_id then
    update public.questions
    set subject_id = canonical_subject_id
    where subject_id = legacy_subject_id;

    update public.attempts
    set subject_id = canonical_subject_id
    where subject_id = legacy_subject_id;

    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'user_module_progress'
    ) then
      execute $dedupe$
        delete from public.user_module_progress legacy
        where legacy.subject_id = $2
          and exists (
            select 1
            from public.user_module_progress canonical
            where canonical.user_id = legacy.user_id
              and canonical.exam_pack_id = legacy.exam_pack_id
              and canonical.subject_id = $1
          )
      $dedupe$
      using canonical_subject_id, legacy_subject_id;

      execute $merge$
        update public.user_module_progress
        set subject_id = $1
        where subject_id = $2
      $merge$
      using canonical_subject_id, legacy_subject_id;
    end if;

    delete from public.subjects
    where id = legacy_subject_id;
  elsif legacy_subject_id is not null then
    update public.subjects
    set slug = 'current-affairs'
    where id = legacy_subject_id;
  end if;
end $$;

update public.subjects
set
  name = 'Public Financial Management (Financial Regulations)',
  description = 'Financial regulations, stewardship, public funds, and accountability.',
  sort_order = 10,
  is_active = true
where slug = 'public-financial-management';

insert into public.subjects (name, slug, description, sort_order, is_active)
select
  'Public Financial Management (Financial Regulations)',
  'public-financial-management',
  'Financial regulations, stewardship, public funds, and accountability.',
  10,
  true
where not exists (
  select 1 from public.subjects where slug = 'public-financial-management'
);

update public.subjects
set
  name = 'Public Service Rules',
  description = 'Conduct, discipline, promotion, ethics, and service-wide rules.',
  sort_order = 20,
  is_active = true
where slug = 'public-service-rules';

insert into public.subjects (name, slug, description, sort_order, is_active)
select
  'Public Service Rules',
  'public-service-rules',
  'Conduct, discipline, promotion, ethics, and service-wide rules.',
  20,
  true
where not exists (
  select 1 from public.subjects where slug = 'public-service-rules'
);

update public.subjects
set
  name = 'Current Affairs / General Knowledge',
  description = 'Nigeria-focused civic awareness, public institutions, and current affairs.',
  sort_order = 30,
  is_active = true
where slug = 'current-affairs';

insert into public.subjects (name, slug, description, sort_order, is_active)
select
  'Current Affairs / General Knowledge',
  'current-affairs',
  'Nigeria-focused civic awareness, public institutions, and current affairs.',
  30,
  true
where not exists (
  select 1 from public.subjects where slug = 'current-affairs'
);

update public.subjects
set batch_size = 30,
    pass_mark_percent = 70
where slug = 'public-financial-management';

update public.subjects
set batch_size = 20,
    pass_mark_percent = 70
where slug in ('public-service-rules', 'current-affairs');

alter table public.attempts
  add column if not exists batch_number integer,
  add column if not exists score_percent integer,
  add column if not exists passed boolean,
  add column if not exists retry_number integer not null default 0,
  add column if not exists is_free_attempt boolean not null default false;

alter table public.attempt_answers
  add column if not exists display_order integer;

create table if not exists public.user_module_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  current_batch_number integer not null default 1,
  highest_unlocked_batch_number integer not null default 1,
  selected_for_free_access boolean not null default false,
  free_first_attempt_completed boolean not null default false,
  free_retry_consumed boolean not null default false,
  last_attempt_id uuid references public.attempts(id),
  last_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_module_progress_user_pack_subject_key
  on public.user_module_progress (user_id, exam_pack_id, subject_id);

create unique index if not exists user_module_progress_one_free_module_key
  on public.user_module_progress (user_id, exam_pack_id)
  where selected_for_free_access = true;

drop trigger if exists user_module_progress_touch_updated_at on public.user_module_progress;
create trigger user_module_progress_touch_updated_at
before update on public.user_module_progress
for each row execute function public.touch_updated_at();

update public.questions
set batch_number = 1
where batch_number is null;

alter table public.user_module_progress enable row level security;

drop policy if exists "user_module_progress_select_own_or_admin" on public.user_module_progress;
create policy "user_module_progress_select_own_or_admin"
on public.user_module_progress for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_module_progress_insert_own" on public.user_module_progress;
create policy "user_module_progress_insert_own"
on public.user_module_progress for insert
to authenticated
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_module_progress_update_own_or_admin" on public.user_module_progress;
create policy "user_module_progress_update_own_or_admin"
on public.user_module_progress for update
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

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
language plpgsql
security definer
set search_path = public
as $$
declare
  active_pack public.exam_packs;
  target_subject public.subjects;
  module_progress public.user_module_progress;
  free_module_progress public.user_module_progress;
  onboarding_service_level text;
  resolved_batch_number integer := 1;
  prior_attempt_count integer := 0;
  already_passed_batch boolean := false;
begin
  select ep.*
  into active_pack
  from public.exam_packs ep
  where ep.is_active = true
  order by ep.active_from desc, ep.created_at desc
  limit 1;

  if active_pack.id is null then
    raise exception 'No active exam pack is configured';
  end if;

  select p.service_level
  into onboarding_service_level
  from public.profiles p
  where p.id = auth.uid();

  if onboarding_service_level is null then
    raise exception 'Complete your profile setup before starting practice';
  end if;

  if requested_subject_id is null and coalesce(btrim(requested_subject_slug), '') = '' then
    raise exception 'Choose a module before starting practice';
  end if;

  select s.*
  into target_subject
  from public.subjects s
  where s.is_active = true
    and (
      (requested_subject_id is not null and s.id = requested_subject_id)
      or (coalesce(btrim(requested_subject_slug), '') <> '' and s.slug = requested_subject_slug)
    )
  order by s.sort_order
  limit 1;

  if target_subject.id is null then
    raise exception 'Choose a module before starting practice';
  end if;

  if not exists (
    select 1
    from public.questions q
    where q.exam_pack_id = active_pack.id
      and q.subject_id = target_subject.id
      and q.status = 'published'
  ) then
    raise exception 'Questions for this module are not available yet.';
  end if;

  has_paid_access := public.has_active_entitlement(active_pack.id);

  select ump.*
  into free_module_progress
  from public.user_module_progress ump
  where ump.user_id = auth.uid()
    and ump.exam_pack_id = active_pack.id
    and ump.selected_for_free_access = true
  limit 1;

  if not has_paid_access then
    if free_module_progress.subject_id is null then
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
        auth.uid(),
        active_pack.id,
        target_subject.id,
        1,
        1,
        true
      )
      on conflict (user_id, exam_pack_id, subject_id)
      do update
      set selected_for_free_access = true,
          updated_at = now();

      select ump.*
      into free_module_progress
      from public.user_module_progress ump
      where ump.user_id = auth.uid()
        and ump.exam_pack_id = active_pack.id
        and ump.subject_id = target_subject.id
      limit 1;
    elsif free_module_progress.subject_id <> target_subject.id then
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
    auth.uid(),
    active_pack.id,
    target_subject.id,
    1,
    1,
    coalesce(free_module_progress.subject_id = target_subject.id, false)
  )
  on conflict (user_id, exam_pack_id, subject_id)
  do nothing;

  select ump.*
  into module_progress
  from public.user_module_progress ump
  where ump.user_id = auth.uid()
    and ump.exam_pack_id = active_pack.id
    and ump.subject_id = target_subject.id
  limit 1;

  resolved_batch_number := case
    when has_paid_access then greatest(coalesce(module_progress.current_batch_number, 1), 1)
    else 1
  end;

  if not exists (
    select 1
    from public.questions q
    where q.exam_pack_id = active_pack.id
      and q.subject_id = target_subject.id
      and q.status = 'published'
      and q.batch_number = resolved_batch_number
  ) then
    raise exception 'Questions for this module are not available yet.';
  end if;

  select count(*)
  into prior_attempt_count
  from public.attempts a
  where a.user_id = auth.uid()
    and a.exam_pack_id = active_pack.id
    and a.subject_id = target_subject.id
    and a.batch_number = resolved_batch_number
    and a.completed_at is not null;

  select exists (
    select 1
    from public.attempts a
    where a.user_id = auth.uid()
      and a.exam_pack_id = active_pack.id
      and a.subject_id = target_subject.id
      and a.batch_number = resolved_batch_number
      and a.completed_at is not null
      and a.passed = true
  )
  into already_passed_batch;

  if not has_paid_access then
    if already_passed_batch then
      raise exception 'Unlock full access to continue to the next batch.';
    end if;

    if coalesce(module_progress.free_retry_consumed, false) or prior_attempt_count >= 2 then
      raise exception 'Unlock full access to continue.';
    end if;
  end if;

  exam_pack_id := active_pack.id;
  subject_id := target_subject.id;
  subject_slug := target_subject.slug;
  subject_name := target_subject.name;
  batch_number := resolved_batch_number;
  batch_size := coalesce(target_subject.batch_size, 0);
  pass_mark_percent := coalesce(target_subject.pass_mark_percent, 70);
  is_free_attempt := not has_paid_access;
  retry_number := greatest(prior_attempt_count, 0);
  free_module_subject_id := free_module_progress.subject_id;
  free_module_subject_slug := (
    select s.slug
    from public.subjects s
    where s.id = free_module_progress.subject_id
  );

  return next;
end;
$$;

drop function if exists public.get_candidate_summary();

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
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  answer_usage as (
    select count(*) as used
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    join active_pack ap on ap.id = q.exam_pack_id
    where aa.user_id = auth.uid()
  ),
  active_entitlement as (
    select e.expires_at
    from public.entitlements e
    join active_pack ap on ap.id = e.exam_pack_id
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
    from public.user_module_progress ump
    join public.subjects s on s.id = ump.subject_id
    join active_pack ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  )
  select
    ap.id,
    ap.name,
    ap.price_kobo,
    ap.currency,
    ap.trial_question_limit,
    coalesce(au.used, 0),
    exists (select 1 from active_entitlement),
    (select ae.expires_at from active_entitlement ae),
    (select fm.subject_id from free_module fm),
    (select fm.subject_slug from free_module fm),
    coalesce((select fm.free_first_attempt_completed from free_module fm), false),
    coalesce((select fm.free_retry_consumed from free_module fm), false)
  from active_pack ap
  left join answer_usage au on true;
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
  with ctx as (
    select *
    from public.resolve_practice_batch_context(
      requested_subject_id => null,
      requested_subject_slug => requested_subject_slug,
      allow_free_lock => true
    )
  ),
  ordered_questions as (
    select
      q.id,
      q.subject_id,
      ctx.subject_name,
      ctx.subject_slug,
      q.service_level,
      q.difficulty,
      q.question_text,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.reference_note,
      ctx.batch_number,
      ctx.batch_size,
      ctx.pass_mark_percent,
      ctx.is_free_attempt,
      ctx.retry_number,
      row_number() over (
        order by coalesce(q.batch_position, 1000000), random()
      )::integer as display_order
    from ctx
    join public.questions q
      on q.exam_pack_id = ctx.exam_pack_id
     and q.subject_id = ctx.subject_id
     and q.status = 'published'
     and q.batch_number = ctx.batch_number
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
  from ordered_questions oq
  order by oq.display_order;
$$;

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
  with ctx as (
    select *
    from public.resolve_practice_batch_context(
      requested_subject_id => requested_subject_id,
      requested_subject_slug => null,
      allow_free_lock => false
    )
  ),
  ordered_questions as (
    select
      q.id,
      q.subject_id,
      ctx.subject_name,
      ctx.subject_slug,
      q.service_level,
      q.difficulty,
      q.question_text,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.reference_note,
      ctx.batch_number,
      ctx.batch_size,
      ctx.pass_mark_percent,
      ctx.is_free_attempt,
      ctx.retry_number,
      row_number() over (
        order by coalesce(q.batch_position, 1000000), random()
      )::integer as display_order
    from ctx
    join public.questions q
      on q.exam_pack_id = ctx.exam_pack_id
     and q.subject_id = ctx.subject_id
     and q.status = 'published'
     and q.batch_number = ctx.batch_number
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
  from ordered_questions oq
  order by oq.display_order;
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
  ctx record;
  attempt_uuid uuid;
  answer_row record;
  question_row public.questions;
  module_progress_id uuid;
  computed_score integer := 0;
  computed_total integer := 0;
  computed_score_percent integer := 0;
  computed_passed boolean := false;
  next_action_value text := 'back_to_dashboard';
  review_items jsonb := '[]'::jsonb;
begin
  select *
  into ctx
  from public.resolve_practice_batch_context(
    requested_subject_id => submitted_subject_id,
    requested_subject_slug => null,
    allow_free_lock => false
  );

  if ctx.subject_id is null then
    raise exception 'Choose a module before starting practice';
  end if;

  if submitted_answers is null
     or jsonb_typeof(submitted_answers) <> 'array'
     or jsonb_array_length(submitted_answers) = 0 then
    raise exception 'Answer at least one question before submitting.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(submitted_answers) submitted_answer
    where not exists (
      select 1
      from public.questions q
      where q.id = (submitted_answer->>'question_id')::uuid
        and q.exam_pack_id = ctx.exam_pack_id
        and q.subject_id = ctx.subject_id
        and q.status = 'published'
        and q.batch_number = ctx.batch_number
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
    auth.uid(),
    ctx.exam_pack_id,
    submitted_mode,
    ctx.subject_id,
    null,
    ctx.batch_number,
    ctx.retry_number,
    ctx.is_free_attempt
  )
  returning id into attempt_uuid;

  for answer_row in
    select
      submitted_answer,
      ordinality::integer as ordinal_position
    from jsonb_array_elements(submitted_answers) with ordinality as payload(submitted_answer, ordinality)
  loop
    select q.*
    into question_row
    from public.questions q
    where q.id = (answer_row.submitted_answer->>'question_id')::uuid
      and q.exam_pack_id = ctx.exam_pack_id
      and q.subject_id = ctx.subject_id
      and q.status = 'published'
      and q.batch_number = ctx.batch_number;

    if question_row.id is null then
      continue;
    end if;

    computed_total := computed_total + 1;

    if upper(coalesce(answer_row.submitted_answer->>'selected_option', '')) = question_row.correct_option then
      computed_score := computed_score + 1;
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
      attempt_uuid,
      auth.uid(),
      question_row.id,
      upper(coalesce(answer_row.submitted_answer->>'selected_option', '')),
      upper(coalesce(answer_row.submitted_answer->>'selected_option', '')) = question_row.correct_option,
      greatest(coalesce((answer_row.submitted_answer->>'time_spent_seconds')::integer, 0), 0),
      coalesce((answer_row.submitted_answer->>'display_order')::integer, answer_row.ordinal_position)
    );

    review_items := review_items || jsonb_build_object(
      'question_id', question_row.id,
      'selected_option', upper(coalesce(answer_row.submitted_answer->>'selected_option', '')),
      'correct_option', question_row.correct_option,
      'is_correct', upper(coalesce(answer_row.submitted_answer->>'selected_option', '')) = question_row.correct_option,
      'explanation', question_row.explanation,
      'reference_note', question_row.reference_note,
      'display_order', coalesce((answer_row.submitted_answer->>'display_order')::integer, answer_row.ordinal_position)
    );
  end loop;

  if computed_total > 0 then
    computed_score_percent := round((computed_score::numeric * 100) / computed_total)::integer;
  end if;

  computed_passed := computed_total > 0 and computed_score_percent >= coalesce(ctx.pass_mark_percent, 70);

  update public.attempts
  set completed_at = now(),
      score = computed_score,
      total_questions = computed_total,
      score_percent = computed_score_percent,
      passed = computed_passed
  where id = attempt_uuid;

  select ump.id
  into module_progress_id
  from public.user_module_progress ump
  where ump.user_id = auth.uid()
    and ump.exam_pack_id = ctx.exam_pack_id
    and ump.subject_id = ctx.subject_id
  limit 1;

  if ctx.is_free_attempt then
    update public.user_module_progress
    set
      free_first_attempt_completed = true,
      free_retry_consumed = case
        when ctx.retry_number >= 1 then true
        else free_retry_consumed
      end,
      last_attempt_id = attempt_uuid,
      last_attempted_at = now(),
      current_batch_number = 1,
      highest_unlocked_batch_number = greatest(coalesce(highest_unlocked_batch_number, 1), 1)
    where id = module_progress_id;

    next_action_value := case
      when computed_passed then 'unlock_full_access'
      when ctx.retry_number >= 1 then 'unlock_full_access'
      else 'retry_batch'
    end;
  else
    update public.user_module_progress
    set
      last_attempt_id = attempt_uuid,
      last_attempted_at = now(),
      current_batch_number = case
        when computed_passed then ctx.batch_number + 1
        else ctx.batch_number
      end,
      highest_unlocked_batch_number = case
        when computed_passed then greatest(coalesce(highest_unlocked_batch_number, 1), ctx.batch_number + 1)
        else greatest(coalesce(highest_unlocked_batch_number, 1), ctx.batch_number)
      end
    where id = module_progress_id;

    next_action_value := case
      when computed_passed then 'proceed_next_batch'
      else 'retry_batch'
    end;
  end if;

  attempt_id := attempt_uuid;
  score := computed_score;
  total_questions := computed_total;
  review := review_items;
  batch_number := ctx.batch_number;
  score_percent := computed_score_percent;
  passed := computed_passed;
  retry_number := ctx.retry_number;
  next_action := next_action_value;

  return next;
end;
$$;

drop function if exists public.get_module_progress();

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
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  )
  select
    s.id,
    s.name,
    s.slug,
    count(a.id) filter (where a.completed_at is not null) as completed_attempts,
    count(a.id) filter (
      where a.completed_at is not null
        and a.passed = true
    ) as mastered_attempts,
    (
      select a2.score_percent
      from public.attempts a2
      join active_pack ap2 on ap2.id = a2.exam_pack_id
      where a2.user_id = auth.uid()
        and a2.subject_id = s.id
        and a2.completed_at is not null
      order by a2.completed_at desc
      limit 1
    ) as last_score_percent,
    coalesce((
      select count(*)
      from public.attempt_answers aa
      join public.questions q on q.id = aa.question_id
      join active_pack ap3 on ap3.id = q.exam_pack_id
      where aa.user_id = auth.uid()
        and q.subject_id = s.id
        and aa.is_correct = false
    ), 0) as weak_question_count,
    exists (
      select 1
      from public.questions q
      join active_pack ap4 on ap4.id = q.exam_pack_id
      where q.subject_id = s.id
        and q.status = 'published'
    ) as has_questions,
    coalesce(ump.current_batch_number, 1) as current_batch_number,
    coalesce(ump.highest_unlocked_batch_number, 1) as highest_unlocked_batch_number,
    coalesce(s.batch_size, 0) as batch_size,
    coalesce(s.pass_mark_percent, 70) as pass_mark_percent,
    (
      select a3.score_percent
      from public.attempts a3
      join active_pack ap5 on ap5.id = a3.exam_pack_id
      where a3.user_id = auth.uid()
        and a3.subject_id = s.id
        and a3.completed_at is not null
      order by a3.completed_at desc
      limit 1
    ) as last_batch_score_percent,
    (
      select a4.passed
      from public.attempts a4
      join active_pack ap6 on ap6.id = a4.exam_pack_id
      where a4.user_id = auth.uid()
        and a4.subject_id = s.id
        and a4.completed_at is not null
      order by a4.completed_at desc
      limit 1
    ) as last_batch_passed,
    coalesce(ump.selected_for_free_access, false) as selected_for_free_access,
    coalesce(ump.free_retry_consumed, false) as free_retry_consumed
  from public.subjects s
  left join active_pack ap on true
  left join public.attempts a
    on a.subject_id = s.id
   and a.user_id = auth.uid()
   and a.exam_pack_id = ap.id
  left join public.user_module_progress ump
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
  from target_attempt ta
  join public.attempt_answers aa on aa.attempt_id = ta.id
  join public.questions q on q.id = aa.question_id
  join public.subjects s on s.id = q.subject_id
  order by coalesce(aa.display_order, 999999), aa.answered_at;
$$;
