-- Additive oral-answer practice. Objective questions and scored attempts remain unchanged.

do $$
begin
  create type public.practice_type as enum ('objective', 'oral');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.oral_attempt_status as enum ('active', 'completed', 'abandoned');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.oral_response_status as enum ('pending', 'active', 'answered', 'skipped', 'timed_out');
exception
  when duplicate_object then null;
end $$;

alter table public.subjects
  add column if not exists practice_type public.practice_type not null default 'objective';

alter table public.practice_sets
  add column if not exists practice_type public.practice_type not null default 'objective';

create table public.oral_questions (
  id uuid primary key default gen_random_uuid(),
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  practice_set_id uuid not null references public.practice_sets(id) on delete restrict,
  difficulty public.difficulty_level not null default 'medium',
  question_text text not null check (length(btrim(question_text)) > 0),
  model_answer text not null default '',
  key_points text[] not null default '{}'::text[],
  reference_note text not null default '',
  source_note text not null default '',
  status public.question_status not null default 'draft',
  batch_position integer not null check (batch_position > 0),
  supersedes_question_id uuid references public.oral_questions(id) on delete restrict,
  revision_number integer not null default 1 check (revision_number > 0),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_oral_questions_need_review_material check (
    status <> 'published'
    or (
      length(btrim(model_answer)) > 0
      and cardinality(key_points) > 0
    )
  )
);

create unique index oral_questions_one_published_position
  on public.oral_questions (practice_set_id, batch_position)
  where status = 'published';

create index oral_questions_set_status_position
  on public.oral_questions (practice_set_id, status, batch_position);

create table public.oral_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  practice_set_id uuid not null references public.practice_sets(id) on delete restrict,
  status public.oral_attempt_status not null default 'active',
  seconds_per_question integer not null check (seconds_per_question in (180, 300)),
  current_position integer not null default 1 check (current_position > 0),
  total_questions integer not null check (total_questions > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oral_attempt_completion_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create unique index oral_attempts_one_active_per_user
  on public.oral_attempts (user_id)
  where status = 'active';

create index oral_attempts_user_subject_set
  on public.oral_attempts (user_id, subject_id, practice_set_id, started_at desc);

create table public.oral_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.oral_attempts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.oral_questions(id) on delete restrict,
  display_order integer not null check (display_order > 0),
  question_text_snapshot text not null,
  model_answer_snapshot text not null,
  key_points_snapshot text[] not null default '{}'::text[],
  reference_note_snapshot text not null default '',
  response_text text not null default '' check (length(response_text) <= 20000),
  status public.oral_response_status not null default 'pending',
  started_at timestamptz,
  deadline_at timestamptz,
  locked_at timestamptz,
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  self_rating text check (self_rating in ('strong', 'partly_covered', 'needs_practice')),
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_id),
  unique (attempt_id, display_order),
  constraint oral_response_timing_consistent check (
    (status = 'pending' and started_at is null and deadline_at is null and locked_at is null)
    or (status = 'active' and started_at is not null and deadline_at is not null and locked_at is null)
    or (status in ('answered', 'skipped', 'timed_out') and started_at is not null and deadline_at is not null and locked_at is not null)
  )
);

create unique index oral_responses_one_active_per_attempt
  on public.oral_responses (attempt_id)
  where status = 'active';

create index oral_responses_attempt_order
  on public.oral_responses (attempt_id, display_order);

create trigger oral_questions_touch_updated_at
before update on public.oral_questions
for each row execute function public.touch_updated_at();

create trigger oral_attempts_touch_updated_at
before update on public.oral_attempts
for each row execute function public.touch_updated_at();

create trigger oral_responses_touch_updated_at
before update on public.oral_responses
for each row execute function public.touch_updated_at();

create or replace function public.validate_oral_question_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.practice_sets;
  v_subject_type public.practice_type;
begin
  select * into v_set
  from public.practice_sets
  where id = new.practice_set_id;

  if v_set.id is null then
    raise exception 'Choose a valid oral practice set';
  end if;

  select practice_type into v_subject_type
  from public.subjects
  where id = new.subject_id;

  if v_set.practice_type <> 'oral'
     or v_subject_type <> 'oral'
     or v_set.exam_pack_id <> new.exam_pack_id
     or v_set.subject_id <> new.subject_id then
    raise exception 'The oral question must belong to an oral set in the same module and exam pack';
  end if;

  if exists (
    select 1
    from unnest(new.key_points) as point
    where length(btrim(point)) = 0
  ) then
    raise exception 'Key points cannot contain blank items';
  end if;

  return new;
end;
$$;

create trigger oral_questions_validate_context
before insert or update on public.oral_questions
for each row execute function public.validate_oral_question_context();

alter table public.oral_questions enable row level security;
alter table public.oral_attempts enable row level security;
alter table public.oral_responses enable row level security;

create policy "oral_questions_admin_only"
on public.oral_questions for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "oral_attempts_admin_only"
on public.oral_attempts for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "oral_responses_admin_only"
on public.oral_responses for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on table public.oral_questions, public.oral_attempts, public.oral_responses from anon;
grant select, insert, update, delete on table public.oral_questions, public.oral_attempts, public.oral_responses to authenticated;

create or replace function public.oral_assert_candidate()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if public.is_admin() then
    raise exception 'Candidate access is required';
  end if;

  return v_user_id;
end;
$$;

revoke all on function public.oral_assert_candidate() from public, anon, authenticated;

create or replace function public.build_oral_attempt_payload(requested_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.oral_attempts;
  v_subject public.subjects;
  v_set public.practice_sets;
  v_response public.oral_responses;
begin
  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  select * into v_subject from public.subjects where id = v_attempt.subject_id;
  select * into v_set from public.practice_sets where id = v_attempt.practice_set_id;

  if v_attempt.status = 'active' then
    select * into v_response
    from public.oral_responses
    where attempt_id = v_attempt.id
      and display_order = v_attempt.current_position
      and status = 'active';

    if v_response.id is null then
      raise exception 'The current oral question is unavailable';
    end if;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'subject_id', v_attempt.subject_id,
    'subject_name', v_subject.name,
    'subject_slug', v_subject.slug,
    'practice_set_id', v_attempt.practice_set_id,
    'set_number', v_set.set_number,
    'seconds_per_question', v_attempt.seconds_per_question,
    'current_position', v_attempt.current_position,
    'total_questions', v_attempt.total_questions,
    'started_at', v_attempt.started_at,
    'completed_at', v_attempt.completed_at,
    'server_now', clock_timestamp(),
    'current_question', case
      when v_attempt.status = 'active' then jsonb_build_object(
        'id', v_response.question_id,
        'response_id', v_response.id,
        'question_text', v_response.question_text_snapshot,
        'response_text', v_response.response_text,
        'started_at', v_response.started_at,
        'deadline_at', v_response.deadline_at,
        'saved_at', v_response.saved_at
      )
      else null
    end
  );
end;
$$;

revoke all on function public.build_oral_attempt_payload(uuid) from public, anon, authenticated;

create or replace function public.advance_oral_attempt(
  requested_attempt_id uuid,
  requested_question_id uuid,
  requested_response_text text default '',
  requested_reason text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt public.oral_attempts;
  v_response public.oral_responses;
  v_now timestamptz := clock_timestamp();
  v_text text := coalesce(requested_response_text, '');
  v_final_status public.oral_response_status;
begin
  if requested_reason not in ('manual', 'timeout') then
    raise exception 'Invalid oral practice advance reason';
  end if;

  if length(v_text) > 20000 then
    raise exception 'Your answer is too long';
  end if;

  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id
  for update;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  if v_attempt.status <> 'active' then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  select * into v_response
  from public.oral_responses
  where attempt_id = v_attempt.id
    and display_order = v_attempt.current_position
    and status = 'active'
  for update;

  if v_response.id is null then
    raise exception 'The current oral question is unavailable';
  end if;

  -- A repeated Next or timeout request returns the already-advanced state.
  if v_response.question_id <> requested_question_id then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  v_final_status := case
    when v_now >= v_response.deadline_at then 'timed_out'::public.oral_response_status
    when length(btrim(v_text)) = 0 then 'skipped'::public.oral_response_status
    else 'answered'::public.oral_response_status
  end;

  update public.oral_responses
  set response_text = v_text,
      status = v_final_status,
      locked_at = v_now,
      saved_at = v_now,
      time_spent_seconds = least(
        v_attempt.seconds_per_question,
        greatest(0, floor(extract(epoch from (v_now - v_response.started_at)))::integer)
      )
  where id = v_response.id;

  if v_attempt.current_position >= v_attempt.total_questions then
    update public.oral_attempts
    set status = 'completed',
        completed_at = v_now
    where id = v_attempt.id;
  else
    update public.oral_attempts
    set current_position = current_position + 1
    where id = v_attempt.id;

    update public.oral_responses
    set status = 'active',
        started_at = v_now,
        deadline_at = v_now + make_interval(secs => v_attempt.seconds_per_question)
    where attempt_id = v_attempt.id
      and display_order = v_attempt.current_position + 1
      and status = 'pending';

    if not found then
      raise exception 'The next oral question is unavailable';
    end if;
  end if;

  return public.build_oral_attempt_payload(v_attempt.id);
end;
$$;

create or replace function public.get_oral_attempt_state(requested_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt public.oral_attempts;
  v_response public.oral_responses;
begin
  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id
  for update;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  if v_attempt.status = 'active' then
    select * into v_response
    from public.oral_responses
    where attempt_id = v_attempt.id
      and display_order = v_attempt.current_position
      and status = 'active'
    for update;

    if v_response.id is null then
      raise exception 'The current oral question is unavailable';
    end if;

    if clock_timestamp() >= v_response.deadline_at then
      return public.advance_oral_attempt(
        v_attempt.id,
        v_response.question_id,
        v_response.response_text,
        'timeout'
      );
    end if;
  end if;

  return public.build_oral_attempt_payload(v_attempt.id);
end;
$$;

create or replace function public.get_active_oral_attempt(
  requested_subject_slug text,
  requested_set_number integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt_id uuid;
begin
  select oa.id into v_attempt_id
  from public.oral_attempts as oa
  join public.subjects as s on s.id = oa.subject_id
  join public.practice_sets as ps on ps.id = oa.practice_set_id
  where oa.user_id = v_user_id
    and oa.status = 'active'
    and s.slug = requested_subject_slug
    and ps.set_number = greatest(coalesce(requested_set_number, 1), 1)
  order by oa.started_at desc
  limit 1;

  if v_attempt_id is null then
    return null;
  end if;

  return public.get_oral_attempt_state(v_attempt_id);
end;
$$;

create or replace function public.start_or_resume_oral_attempt(
  requested_subject_slug text,
  requested_set_number integer default 1,
  requested_seconds_per_question integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_pack public.exam_packs;
  v_subject public.subjects;
  v_set public.practice_sets;
  v_active_attempt public.oral_attempts;
  v_attempt_id uuid;
  v_question_count integer;
  v_is_paid boolean;
  v_selected_free_subject_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if requested_seconds_per_question not in (180, 300) then
    raise exception 'Choose either 3 or 5 minutes per question';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':oral-practice', 0));

  select * into v_pack
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if v_pack.id is null then
    raise exception 'No active exam pack is configured';
  end if;

  select * into v_subject
  from public.subjects
  where slug = requested_subject_slug
    and is_active = true
    and practice_type = 'oral'
  limit 1;

  if v_subject.id is null then
    raise exception 'This oral practice module is unavailable';
  end if;

  select * into v_set
  from public.practice_sets
  where exam_pack_id = v_pack.id
    and subject_id = v_subject.id
    and set_number = greatest(coalesce(requested_set_number, 1), 1)
    and practice_type = 'oral'
    and status = 'published'
  limit 1;

  if v_set.id is null then
    raise exception 'This oral practice set is unavailable';
  end if;

  select * into v_active_attempt
  from public.oral_attempts
  where user_id = v_user_id
    and status = 'active'
  order by started_at desc
  limit 1
  for update;

  if v_active_attempt.id is not null then
    if v_active_attempt.practice_set_id <> v_set.id then
      raise exception 'Finish your active oral practice before starting another set';
    end if;

    return public.get_oral_attempt_state(v_active_attempt.id);
  end if;

  select count(*)::integer into v_question_count
  from public.oral_questions
  where practice_set_id = v_set.id
    and status = 'published';

  if v_question_count = 0 or v_question_count <> v_set.expected_question_count then
    raise exception 'This oral practice set is not ready yet';
  end if;

  v_is_paid := public.has_active_module_entitlement(v_pack.id, v_subject.id);

  if not v_is_paid then
    select subject_id into v_selected_free_subject_id
    from public.user_module_progress
    where user_id = v_user_id
      and exam_pack_id = v_pack.id
      and selected_for_free_access = true
    limit 1;

    if v_selected_free_subject_id is not null and v_selected_free_subject_id <> v_subject.id then
      raise exception 'Your free practice is already assigned to another module';
    end if;

    if v_set.set_number <> 1 then
      raise exception 'Unlock this module to use more oral practice sets';
    end if;

    if exists (
      select 1
      from public.oral_attempts
      where user_id = v_user_id
        and exam_pack_id = v_pack.id
        and subject_id = v_subject.id
        and practice_set_id = v_set.id
        and status = 'completed'
    ) then
      raise exception 'Your free oral practice is complete. Unlock this module to practise again';
    end if;

    insert into public.user_module_progress (
      user_id,
      exam_pack_id,
      subject_id,
      current_batch_number,
      highest_unlocked_batch_number,
      selected_for_free_access
    ) values (
      v_user_id,
      v_pack.id,
      v_subject.id,
      1,
      1,
      true
    )
    on conflict (user_id, exam_pack_id, subject_id)
    do update set selected_for_free_access = true, updated_at = now();
  end if;

  insert into public.oral_attempts (
    user_id,
    exam_pack_id,
    subject_id,
    practice_set_id,
    seconds_per_question,
    current_position,
    total_questions
  ) values (
    v_user_id,
    v_pack.id,
    v_subject.id,
    v_set.id,
    requested_seconds_per_question,
    1,
    v_question_count
  )
  returning id into v_attempt_id;

  insert into public.oral_responses (
    attempt_id,
    user_id,
    question_id,
    display_order,
    question_text_snapshot,
    model_answer_snapshot,
    key_points_snapshot,
    reference_note_snapshot,
    status,
    started_at,
    deadline_at
  )
  select
    v_attempt_id,
    v_user_id,
    q.id,
    row_number() over (order by q.batch_position, q.id)::integer,
    q.question_text,
    q.model_answer,
    q.key_points,
    q.reference_note,
    case when row_number() over (order by q.batch_position, q.id) = 1
      then 'active'::public.oral_response_status
      else 'pending'::public.oral_response_status
    end,
    case when row_number() over (order by q.batch_position, q.id) = 1 then v_now else null end,
    case when row_number() over (order by q.batch_position, q.id) = 1
      then v_now + make_interval(secs => requested_seconds_per_question)
      else null
    end
  from public.oral_questions as q
  where q.practice_set_id = v_set.id
    and q.status = 'published'
  order by q.batch_position, q.id;

  return public.build_oral_attempt_payload(v_attempt_id);
end;
$$;

create or replace function public.save_oral_response_draft(
  requested_attempt_id uuid,
  requested_question_id uuid,
  requested_response_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt public.oral_attempts;
  v_response public.oral_responses;
  v_text text := coalesce(requested_response_text, '');
  v_now timestamptz := clock_timestamp();
begin
  if length(v_text) > 20000 then
    raise exception 'Your answer is too long';
  end if;

  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id
  for update;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  if v_attempt.status <> 'active' then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  select * into v_response
  from public.oral_responses
  where attempt_id = v_attempt.id
    and display_order = v_attempt.current_position
    and status = 'active'
  for update;

  if v_response.question_id <> requested_question_id then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  if v_now >= v_response.deadline_at then
    return public.advance_oral_attempt(
      v_attempt.id,
      v_response.question_id,
      v_response.response_text,
      'timeout'
    );
  end if;

  update public.oral_responses
  set response_text = v_text,
      saved_at = v_now
  where id = v_response.id;

  return public.build_oral_attempt_payload(v_attempt.id);
end;
$$;

create or replace function public.get_oral_attempt_review(requested_attempt_id uuid)
returns table (
  attempt_id uuid,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  set_number integer,
  seconds_per_question integer,
  total_questions integer,
  completed_at timestamptz,
  response_id uuid,
  question_id uuid,
  display_order integer,
  question_text text,
  response_text text,
  response_status public.oral_response_status,
  time_spent_seconds integer,
  model_answer text,
  key_points text[],
  reference_note text,
  self_rating text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt public.oral_attempts;
begin
  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  if v_attempt.status <> 'completed' then
    raise exception 'Finish the oral practice before reviewing model answers';
  end if;

  return query
  select
    oa.id,
    oa.subject_id,
    s.name,
    s.slug,
    ps.set_number,
    oa.seconds_per_question,
    oa.total_questions,
    oa.completed_at,
    r.id,
    r.question_id,
    r.display_order,
    r.question_text_snapshot,
    r.response_text,
    r.status,
    r.time_spent_seconds,
    r.model_answer_snapshot,
    r.key_points_snapshot,
    r.reference_note_snapshot,
    r.self_rating
  from public.oral_attempts as oa
  join public.subjects as s on s.id = oa.subject_id
  join public.practice_sets as ps on ps.id = oa.practice_set_id
  join public.oral_responses as r on r.attempt_id = oa.id
  where oa.id = v_attempt.id
  order by r.display_order;
end;
$$;

create or replace function public.save_oral_self_rating(
  requested_response_id uuid,
  requested_rating text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
begin
  if requested_rating not in ('strong', 'partly_covered', 'needs_practice') then
    raise exception 'Choose a valid reflection rating';
  end if;

  update public.oral_responses as r
  set self_rating = requested_rating
  from public.oral_attempts as oa
  where r.id = requested_response_id
    and oa.id = r.attempt_id
    and oa.user_id = v_user_id
    and oa.status = 'completed';

  if not found then
    raise exception 'Completed oral response was not found';
  end if;

  return requested_rating;
end;
$$;

create or replace function public.get_oral_practice_set_access(
  requested_subject_slug text default null
)
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  practice_type public.practice_type,
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
  is_recommended boolean,
  latest_completed_attempt_id uuid
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
  oral_subjects as (
    select s.*
    from public.subjects as s
    where s.is_active = true
      and s.practice_type = 'oral'
      and (requested_subject_slug is null or s.slug = requested_subject_slug)
  ),
  selected_free as (
    select ump.subject_id
    from public.user_module_progress as ump
    join active_pack as ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  ),
  set_scope as (
    select
      os.id as subject_id,
      os.name as subject_name,
      os.slug as subject_slug,
      os.sort_order,
      ps.id as practice_set_id,
      coalesce(ps.set_number, 1) as set_number,
      coalesce(ps.expected_question_count, os.batch_size, 0) as expected_question_count,
      ps.status as set_status,
      ap.id as pack_id
    from oral_subjects as os
    cross join active_pack as ap
    left join public.practice_sets as ps
      on ps.exam_pack_id = ap.id
     and ps.subject_id = os.id
     and ps.practice_type = 'oral'
     and ps.status = 'published'
  ),
  set_facts as (
    select
      ss.*,
      public.has_active_module_entitlement(ss.pack_id, ss.subject_id) as paid_access,
      exists (select 1 from selected_free sf where sf.subject_id = ss.subject_id) as free_access,
      count(oq.id) filter (where oq.status = 'published')::integer as published_count
    from set_scope as ss
    left join public.oral_questions as oq on oq.practice_set_id = ss.practice_set_id
    group by ss.subject_id, ss.subject_name, ss.subject_slug, ss.sort_order,
      ss.practice_set_id, ss.set_number, ss.expected_question_count, ss.set_status, ss.pack_id
  ),
  attempt_facts as (
    select
      sf.subject_id,
      sf.practice_set_id,
      count(oa.id)::integer as attempt_count,
      count(oa.id) filter (where oa.status = 'completed')::integer as completed_count,
      (array_agg(oa.id order by oa.completed_at desc nulls last)
        filter (where oa.status = 'completed'))[1] as latest_completed_attempt_id
    from set_facts as sf
    left join public.oral_attempts as oa
      on oa.user_id = auth.uid()
     and oa.exam_pack_id = sf.pack_id
     and oa.subject_id = sf.subject_id
     and oa.practice_set_id = sf.practice_set_id
    group by sf.subject_id, sf.practice_set_id
  ),
  resolved as (
    select
      sf.*,
      coalesce(af.attempt_count, 0) as attempt_count,
      coalesce(af.completed_count, 0) as completed_count,
      af.latest_completed_attempt_id,
      min(sf.set_number) filter (
        where sf.published_count > 0 and coalesce(af.completed_count, 0) = 0
      ) over (partition by sf.subject_id) as first_incomplete_set,
      min(sf.set_number) filter (where sf.published_count > 0)
        over (partition by sf.subject_id) as first_published_set
    from set_facts as sf
    left join attempt_facts as af
      on af.subject_id = sf.subject_id
     and af.practice_set_id is not distinct from sf.practice_set_id
  )
  select
    r.subject_id,
    r.subject_name,
    r.subject_slug,
    'oral'::public.practice_type,
    r.set_number,
    r.paid_access,
    r.free_access,
    (select os.slug from public.subjects os join selected_free sf on sf.subject_id = os.id limit 1),
    r.published_count,
    r.expected_question_count,
    case
      when r.published_count = 0 then false
      when r.paid_access then true
      when r.free_access and r.set_number = 1 and r.completed_count = 0 then true
      when not exists (select 1 from selected_free) and r.set_number = 1 then true
      else false
    end,
    case
      when r.published_count = 0 then 'unavailable_not_published'
      when r.completed_count > 0 then 'completed_passed'
      when r.paid_access then 'available'
      when r.free_access and r.set_number = 1 then 'available'
      when not exists (select 1 from selected_free) and r.set_number = 1 then 'available'
      else 'locked_requires_payment'
    end,
    case
      when r.published_count = 0 then 'not_published'
      when r.completed_count > 0 and not r.paid_access then 'free_practice_completed'
      when not r.paid_access and not r.free_access and not exists (select 1 from selected_free) and r.set_number = 1 then 'free_batch_available'
      when not r.paid_access and not (r.free_access and r.set_number = 1) then 'requires_payment'
      else 'available'
    end,
    r.attempt_count,
    0,
    null::integer,
    null::integer,
    r.completed_count > 0,
    coalesce(r.first_incomplete_set, r.first_published_set, 1),
    r.first_incomplete_set,
    r.completed_count > 0 and not r.paid_access,
    false,
    case
      when r.published_count = 0 then 'This oral practice set is not available yet.'
      when r.completed_count > 0 and not r.paid_access then 'Your free oral practice is complete. Unlock the module to practise again.'
      when r.paid_access then 'Oral practice is available.'
      when r.free_access and r.set_number = 1 then 'Your free oral practice is available.'
      when not exists (select 1 from selected_free) and r.set_number = 1 then 'Choose this module for your free oral practice.'
      else 'Unlock this module to continue.'
    end,
    r.set_number = coalesce(r.first_incomplete_set, r.first_published_set, 1),
    r.latest_completed_attempt_id
  from resolved as r
  order by r.sort_order, r.set_number;
$$;

-- Purchasable-module counts include either objective or oral published sets.
create or replace function public.get_module_access_catalog()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  offering_id uuid,
  price_kobo integer,
  currency text,
  can_purchase boolean,
  has_module_access boolean,
  access_expires_at timestamptz,
  is_free_module boolean,
  published_batch_count integer
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
  legacy_access as (
    select max(e.expires_at) as expires_at
    from public.entitlements as e
    join active_pack as ap on ap.id = e.exam_pack_id
    where e.user_id = auth.uid()
      and e.status = 'active'
      and e.expires_at > now()
  ),
  module_access as (
    select me.subject_id, max(me.expires_at) as expires_at
    from public.module_entitlements as me
    join active_pack as ap on ap.id = me.exam_pack_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.expires_at > now()
    group by me.subject_id
  ),
  free_module as (
    select ump.subject_id
    from public.user_module_progress as ump
    join active_pack as ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  ),
  published_sets as (
    select q.subject_id, q.batch_number as set_number
    from public.questions as q
    join active_pack as ap on ap.id = q.exam_pack_id
    where q.status = 'published'
    union
    select ps.subject_id, ps.set_number
    from public.practice_sets as ps
    join active_pack as ap on ap.id = ps.exam_pack_id
    where ps.practice_type = 'oral'
      and ps.status = 'published'
      and exists (
        select 1 from public.oral_questions oq
        where oq.practice_set_id = ps.id and oq.status = 'published'
      )
  ),
  published as (
    select subject_id, count(*)::integer as batch_count
    from published_sets
    group by subject_id
  )
  select
    s.id,
    s.name,
    s.slug,
    mo.id,
    mo.price_kobo,
    mo.currency,
    coalesce(mo.is_active, false) and coalesce(p.batch_count, 0) > 0,
    (la.expires_at is not null or ma.expires_at is not null),
    greatest(la.expires_at, ma.expires_at),
    exists (select 1 from free_module as fm where fm.subject_id = s.id),
    coalesce(p.batch_count, 0)
  from public.subjects as s
  cross join active_pack as ap
  left join public.module_offerings as mo
    on mo.exam_pack_id = ap.id
   and mo.subject_id = s.id
   and mo.is_active = true
  left join published as p on p.subject_id = s.id
  left join module_access as ma on ma.subject_id = s.id
  cross join legacy_access as la
  where s.is_active = true
  order by s.sort_order, s.name;
$$;

revoke all on function public.advance_oral_attempt(uuid, uuid, text, text) from public, anon;
revoke all on function public.get_oral_attempt_state(uuid) from public, anon;
revoke all on function public.get_active_oral_attempt(text, integer) from public, anon;
revoke all on function public.start_or_resume_oral_attempt(text, integer, integer) from public, anon;
revoke all on function public.save_oral_response_draft(uuid, uuid, text) from public, anon;
revoke all on function public.get_oral_attempt_review(uuid) from public, anon;
revoke all on function public.save_oral_self_rating(uuid, text) from public, anon;
revoke all on function public.get_oral_practice_set_access(text) from public, anon;

grant execute on function public.advance_oral_attempt(uuid, uuid, text, text) to authenticated;
grant execute on function public.get_oral_attempt_state(uuid) to authenticated;
grant execute on function public.get_active_oral_attempt(text, integer) to authenticated;
grant execute on function public.start_or_resume_oral_attempt(text, integer, integer) to authenticated;
grant execute on function public.save_oral_response_draft(uuid, uuid, text) to authenticated;
grant execute on function public.get_oral_attempt_review(uuid) to authenticated;
grant execute on function public.save_oral_self_rating(uuid, text) to authenticated;
grant execute on function public.get_oral_practice_set_access(text) to authenticated;
grant execute on function public.get_module_access_catalog() to authenticated;
