-- Versioned practice-set lifecycle, separate module availability controls, and
-- pinned objective sessions. Existing attempts and entitlements are preserved.

do $$
begin
  create type public.module_candidate_availability as enum (
    'hidden',
    'coming_soon',
    'available',
    'paused'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.subjects
  add column if not exists candidate_availability public.module_candidate_availability;

update public.subjects
set candidate_availability = case lifecycle_status
  when 'active' then 'available'::public.module_candidate_availability
  when 'coming_soon' then 'coming_soon'::public.module_candidate_availability
  else 'hidden'::public.module_candidate_availability
end
where candidate_availability is null;

alter table public.subjects
  alter column candidate_availability set default 'hidden',
  alter column candidate_availability set not null;

alter table public.practice_sets
  add column if not exists logical_set_key uuid,
  add column if not exists version_number integer,
  add column if not exists replaces_practice_set_id uuid references public.practice_sets(id) on delete restrict,
  add column if not exists replaced_by_practice_set_id uuid references public.practice_sets(id) on delete restrict,
  add column if not exists ever_published boolean not null default false,
  add column if not exists first_published_at timestamptz,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists retired_at timestamptz,
  add column if not exists retirement_reason text,
  add column if not exists withdrawn_question_ids uuid[];

update public.practice_sets
set logical_set_key = coalesce(logical_set_key, gen_random_uuid()),
    version_number = coalesce(version_number, 1),
    ever_published = ever_published or status in ('published', 'archived'),
    first_published_at = case
      when status in ('published', 'archived') then coalesce(first_published_at, published_at, created_at)
      else first_published_at
    end,
    retired_at = case
      when status = 'archived' then coalesce(retired_at, archived_at, updated_at)
      else retired_at
    end;

alter table public.practice_sets
  alter column logical_set_key set default gen_random_uuid(),
  alter column logical_set_key set not null,
  alter column version_number set default 1,
  alter column version_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'practice_sets_version_number_positive'
      and conrelid = 'public.practice_sets'::regclass
  ) then
    alter table public.practice_sets
      add constraint practice_sets_version_number_positive check (version_number > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'practice_sets_replacement_not_self'
      and conrelid = 'public.practice_sets'::regclass
  ) then
    alter table public.practice_sets
      add constraint practice_sets_replacement_not_self check (
        replaces_practice_set_id is distinct from id
        and replaced_by_practice_set_id is distinct from id
      );
  end if;
end $$;

alter table public.practice_sets
  drop constraint if exists practice_sets_exam_pack_id_subject_id_set_number_key;

create unique index if not exists practice_sets_one_published_slot_idx
  on public.practice_sets (exam_pack_id, subject_id, set_number, practice_type)
  where status = 'published';

create unique index if not exists practice_sets_logical_version_idx
  on public.practice_sets (logical_set_key, version_number);

create unique index if not exists practice_sets_one_pending_replacement_idx
  on public.practice_sets (logical_set_key)
  where replaces_practice_set_id is not null and status in ('draft', 'review');

create index if not exists practice_sets_replaces_idx
  on public.practice_sets (replaces_practice_set_id)
  where replaces_practice_set_id is not null;

create index if not exists practice_sets_replaced_by_idx
  on public.practice_sets (replaced_by_practice_set_id)
  where replaced_by_practice_set_id is not null;

create or replace function public.assign_question_practice_set()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_set_id uuid;
  initial_set_status public.practice_set_status;
  expected_count integer;
begin
  if new.practice_set_id is not null then
    return new;
  end if;

  select ps.id into resolved_set_id
  from public.practice_sets ps
  where ps.exam_pack_id = new.exam_pack_id
    and ps.subject_id = new.subject_id
    and ps.set_number = new.batch_number
    and ps.practice_type = 'objective'
    and ps.status <> 'archived'
  order by ps.version_number desc, ps.created_at desc
  limit 1;

  if resolved_set_id is null then
    initial_set_status := case new.status
      when 'published' then 'published'::public.practice_set_status
      when 'review' then 'review'::public.practice_set_status
      when 'archived' then 'archived'::public.practice_set_status
      else 'draft'::public.practice_set_status
    end;

    select greatest(coalesce(s.batch_size, 1), 1) into expected_count
    from public.subjects s where s.id = new.subject_id;

    insert into public.practice_sets (
      exam_pack_id, subject_id, set_number, expected_question_count, status,
      practice_type, created_by, updated_by, published_at, archived_at,
      ever_published, first_published_at, retired_at
    ) values (
      new.exam_pack_id, new.subject_id, new.batch_number, expected_count,
      initial_set_status, 'objective', auth.uid(), auth.uid(),
      case when initial_set_status = 'published' then now() else null end,
      case when initial_set_status = 'archived' then now() else null end,
      initial_set_status in ('published', 'archived'),
      case when initial_set_status in ('published', 'archived') then now() else null end,
      case when initial_set_status = 'archived' then now() else null end
    ) returning id into resolved_set_id;
  end if;

  new.practice_set_id := resolved_set_id;
  return new;
end;
$$;

alter table public.attempts
  add column if not exists practice_set_id uuid references public.practice_sets(id) on delete restrict;

update public.attempts as a
set practice_set_id = resolved.practice_set_id
from (
  select aa.attempt_id, min(q.practice_set_id::text)::uuid as practice_set_id
  from public.attempt_answers as aa
  join public.questions as q on q.id = aa.question_id
  group by aa.attempt_id
  having count(distinct q.practice_set_id) = 1
) as resolved
where a.id = resolved.attempt_id
  and a.practice_set_id is null;

update public.attempts as a
set practice_set_id = (
  select ps.id
  from public.practice_sets as ps
  where ps.exam_pack_id = a.exam_pack_id
    and ps.subject_id = a.subject_id
    and ps.set_number = a.batch_number
    and ps.practice_type = 'objective'
  order by ps.version_number, ps.created_at
  limit 1
)
where a.practice_set_id is null
  and exists (
    select 1 from public.practice_sets ps
    where ps.exam_pack_id = a.exam_pack_id
      and ps.subject_id = a.subject_id
      and ps.set_number = a.batch_number
      and ps.practice_type = 'objective'
  );

create index if not exists attempts_practice_set_id_idx
  on public.attempts (practice_set_id)
  where practice_set_id is not null;

-- Set status is now authoritative. Question statuses are changed only by
-- lifecycle RPCs, so the legacy reverse-sync trigger must no longer overwrite
-- withdrawn or retired states.
drop trigger if exists questions_sync_practice_set_status on public.questions;

create or replace function public.protect_published_question_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Published questions cannot be deleted; create a replacement version';
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'published'
     and (
       new.question_text is distinct from old.question_text
       or new.option_a is distinct from old.option_a
       or new.option_b is distinct from old.option_b
       or new.option_c is distinct from old.option_c
       or new.option_d is distinct from old.option_d
       or new.correct_option is distinct from old.correct_option
       or new.explanation is distinct from old.explanation
       or new.reference_note is distinct from old.reference_note
       or new.batch_position is distinct from old.batch_position
       or new.practice_set_id is distinct from old.practice_set_id
     ) then
    raise exception 'Published question content is immutable; create a replacement version';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists questions_protect_published_content on public.questions;
create trigger questions_protect_published_content
before update or delete on public.questions
for each row execute function public.protect_published_question_content();

create or replace function public.protect_published_oral_question_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'Published oral questions cannot be deleted; create a replacement version';
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'published'
     and (
       new.question_text is distinct from old.question_text
       or new.model_answer is distinct from old.model_answer
       or new.key_points is distinct from old.key_points
       or new.reference_note is distinct from old.reference_note
       or new.batch_position is distinct from old.batch_position
       or new.practice_set_id is distinct from old.practice_set_id
     ) then
    raise exception 'Published oral question content is immutable; create a replacement version';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists oral_questions_protect_published_content on public.oral_questions;
create trigger oral_questions_protect_published_content
before update or delete on public.oral_questions
for each row execute function public.protect_published_oral_question_content();

-- Browser clients may inspect admin content through RLS, but every mutation is
-- routed through an authorized RPC.
revoke insert, update, delete on public.questions, public.oral_questions, public.practice_sets from authenticated;

create table if not exists public.objective_practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  practice_set_id uuid not null references public.practice_sets(id) on delete restrict,
  question_ids uuid[] not null,
  batch_number integer not null check (batch_number > 0),
  pass_mark_percent integer not null check (pass_mark_percent between 1 and 100),
  is_free_attempt boolean not null,
  retry_number integer not null default 0 check (retry_number >= 0),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint objective_practice_session_questions_present check (cardinality(question_ids) > 0),
  constraint objective_practice_session_completion_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create unique index if not exists objective_sessions_one_active_slot_idx
  on public.objective_practice_sessions (user_id, practice_set_id)
  where status = 'active';

create index if not exists objective_sessions_set_status_idx
  on public.objective_practice_sessions (practice_set_id, status);

alter table public.objective_practice_sessions enable row level security;
revoke all on table public.objective_practice_sessions from anon, authenticated;

create or replace function public.admin_get_practice_set_capabilities(requested_practice_set_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  v_attempt_count integer := 0;
  v_in_progress_count integer := 0;
  v_completed_count integer := 0;
  v_question_count integer := 0;
  v_is_replacement_source boolean := false;
  v_can_delete boolean := false;
  v_blocking_reasons jsonb := '{}'::jsonb;
  v_warnings text[] := array[]::text[];
begin
  perform public.admin_assert_access();

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id;

  if not found then
    raise exception 'Practice set not found';
  end if;

  if target_set.practice_type = 'oral' then
    select
      count(*)::integer,
      count(*) filter (where status = 'active')::integer,
      count(*) filter (where status = 'completed')::integer
    into v_attempt_count, v_in_progress_count, v_completed_count
    from public.oral_attempts
    where practice_set_id = target_set.id;

    select count(distinct batch_position)::integer into v_question_count
    from public.oral_questions
    where practice_set_id = target_set.id;
  else
    select count(*)::integer, count(*) filter (where completed_at is not null)::integer
    into v_attempt_count, v_completed_count
    from public.attempts
    where practice_set_id = target_set.id;

    select count(*)::integer into v_in_progress_count
    from public.objective_practice_sessions
    where practice_set_id = target_set.id and status = 'active';

    select count(distinct batch_position)::integer into v_question_count
    from public.questions
    where practice_set_id = target_set.id;
  end if;

  select exists (
    select 1 from public.practice_sets
    where replaces_practice_set_id = target_set.id
       or logical_set_key = target_set.logical_set_key
          and version_number > target_set.version_number
  ) into v_is_replacement_source;

  v_can_delete := target_set.status in ('draft', 'review')
    and not target_set.ever_published
    and v_attempt_count = 0
    and v_in_progress_count = 0
    and not v_is_replacement_source;

  if not v_can_delete then
    v_blocking_reasons := jsonb_set(
      v_blocking_reasons,
      '{delete}',
      to_jsonb(array_remove(array[
        case when target_set.status not in ('draft', 'review') then 'Only an unpublished draft or review set can be deleted.' end,
        case when target_set.ever_published then 'This version has already been published and must be retired instead.' end,
        case when v_attempt_count > 0 or v_in_progress_count > 0 then 'This set cannot be deleted because candidates have attempted it.' end,
        case when v_is_replacement_source then 'This set is referenced by a replacement version.' end
      ], null))
    );
  end if;

  if target_set.status in ('published', 'withdrawn', 'archived') then
    v_blocking_reasons := jsonb_set(
      v_blocking_reasons,
      '{edit}',
      to_jsonb(array['Published and historical content is immutable. Create a corrected replacement instead.'])
    );
  end if;

  if v_in_progress_count > 0 then
    v_warnings := array_append(v_warnings, format('%s candidate attempt(s) are currently in progress.', v_in_progress_count));
  end if;
  if target_set.status = 'withdrawn' then
    v_warnings := array_append(v_warnings, 'New attempts are paused; existing attempts and reviews remain available.');
  end if;
  if target_set.status = 'archived' then
    v_warnings := array_append(v_warnings, 'This version is permanently retired and cannot be republished.');
  end if;

  return jsonb_build_object(
    'practice_set_id', target_set.id,
    'status', target_set.status,
    'can_edit', target_set.status in ('draft', 'review'),
    'can_import_append', target_set.status in ('draft', 'review'),
    'can_import_replace', target_set.status in ('draft', 'review'),
    'can_send_to_review', target_set.status = 'draft',
    'can_return_to_draft', target_set.status = 'review',
    'can_publish', target_set.status = 'review' and target_set.replaces_practice_set_id is null,
    'can_publish_replacement', target_set.status = 'review' and target_set.replaces_practice_set_id is not null,
    'can_withdraw', target_set.status = 'published',
    'can_republish', target_set.status = 'withdrawn' and target_set.replaced_by_practice_set_id is null,
    'can_create_replacement', target_set.status in ('published', 'withdrawn')
      and target_set.replaced_by_practice_set_id is null
      and not exists (
        select 1 from public.practice_sets pending
        where pending.logical_set_key = target_set.logical_set_key
          and pending.replaces_practice_set_id is not null
          and pending.status in ('draft', 'review')
      ),
    'can_retire', target_set.status in ('published', 'withdrawn'),
    'can_delete', v_can_delete,
    'can_reopen', target_set.status = 'withdrawn'
      and not target_set.ever_published
      and v_attempt_count = 0
      and v_in_progress_count = 0,
    'attempt_count', case when target_set.practice_type = 'oral'
      then v_attempt_count else v_attempt_count + v_in_progress_count end,
    'in_progress_attempt_count', v_in_progress_count,
    'completed_attempt_count', v_completed_count,
    'question_count', v_question_count,
    'blocking_reasons', v_blocking_reasons,
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

create or replace function public.admin_transition_practice_set_v2(
  requested_practice_set_id uuid,
  requested_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  validation jsonb;
  previous_status public.practice_set_status;
  v_current_question_ids uuid[];
begin
  perform public.admin_assert_access();

  if requested_status not in ('draft', 'review', 'published', 'withdrawn', 'archived') then
    raise exception 'Invalid practice-set status';
  end if;

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then raise exception 'Practice set not found'; end if;
  previous_status := target_set.status;

  if target_set.status = 'archived' then
    raise exception 'A retired practice set cannot be reopened';
  end if;

  if requested_status = 'review' and target_set.status <> 'draft' then
    raise exception 'Only a draft practice set can be sent to review';
  elsif requested_status = 'draft' and target_set.status <> 'review' then
    raise exception 'Only a review practice set can return to draft';
  elsif requested_status = 'published' and target_set.status <> 'review' then
    raise exception 'Only a reviewed practice set can be published';
  elsif requested_status = 'withdrawn' and target_set.status <> 'published' then
    raise exception 'Only a published practice set can be withdrawn';
  elsif requested_status = 'archived' and target_set.status not in ('published', 'withdrawn') then
    raise exception 'Only a published or withdrawn practice set can be retired';
  end if;

  if requested_status in ('review', 'published') then
    validation := public.admin_get_practice_set_validation_v2(target_set.id);
    if not coalesce((validation->>'ready')::boolean, false) then
      raise exception 'Practice set is not ready: %',
        array_to_string(array(select jsonb_array_elements_text(validation->'errors')), ' ');
    end if;
  end if;

  if requested_status = 'withdrawn' then
    if target_set.practice_type = 'oral' then
      select array_agg(id order by batch_position, id) into v_current_question_ids
      from public.oral_questions where practice_set_id = target_set.id and status = 'published';
    else
      select array_agg(id order by batch_position, id) into v_current_question_ids
      from public.questions where practice_set_id = target_set.id and status = 'published';
    end if;
  end if;

  if requested_status = 'published' and target_set.replaces_practice_set_id is not null then
    raise exception 'Publish this version with the replacement action so the old version is retired atomically';
  end if;

  if target_set.practice_type = 'oral' then
    if requested_status = 'draft' then
      update public.oral_questions set status = 'draft', updated_by = auth.uid()
      where practice_set_id = target_set.id and status = 'review';
    elsif requested_status = 'review' then
      update public.oral_questions set status = 'review', updated_by = auth.uid()
      where practice_set_id = target_set.id and status = 'draft';
    elsif requested_status = 'published' then
      update public.oral_questions set status = 'published', updated_by = auth.uid()
      where practice_set_id = target_set.id and status in ('draft', 'review');
    elsif requested_status in ('withdrawn', 'archived') then
      update public.oral_questions set status = 'archived', updated_by = auth.uid()
      where practice_set_id = target_set.id and status = 'published';
    end if;
  else
    if requested_status = 'draft' then
      update public.questions set status = 'draft', updated_by = auth.uid()
      where practice_set_id = target_set.id and status = 'review';
    elsif requested_status = 'review' then
      update public.questions set status = 'review', updated_by = auth.uid()
      where practice_set_id = target_set.id and status = 'draft';
    elsif requested_status = 'published' then
      update public.questions set status = 'published', updated_by = auth.uid()
      where practice_set_id = target_set.id and status in ('draft', 'review');
    elsif requested_status in ('withdrawn', 'archived') then
      update public.questions set status = 'archived', updated_by = auth.uid()
      where practice_set_id = target_set.id and status = 'published';
    end if;
  end if;

  update public.practice_sets
  set status = requested_status::public.practice_set_status,
      ever_published = ever_published or requested_status = 'published',
      first_published_at = case when requested_status = 'published' then coalesce(first_published_at, now()) else first_published_at end,
      published_at = case when requested_status = 'published' then now() else published_at end,
      withdrawn_at = case when requested_status = 'withdrawn' then now() when requested_status = 'published' then null else withdrawn_at end,
      retired_at = case when requested_status = 'archived' then now() else retired_at end,
      archived_at = case when requested_status = 'archived' then now() else archived_at end,
      withdrawn_question_ids = case
        when requested_status = 'withdrawn' then v_current_question_ids
        when requested_status = 'published' then null
        else withdrawn_question_ids
      end,
      updated_by = auth.uid()
  where id = target_set.id;

  if requested_status = 'published' then
    update public.subjects
    set lifecycle_status = 'active', is_active = true,
        candidate_availability = case when candidate_availability = 'paused' then candidate_availability else 'available' end
    where id = target_set.subject_id and lifecycle_status <> 'retired';
  end if;

  perform public.admin_write_audit(
    case requested_status
      when 'withdrawn' then 'WITHDRAW'
      when 'archived' then 'RETIRE'
      else 'TRANSITION'
    end,
    'practice_set',
    target_set.id,
    jsonb_build_object(
      'module_id', target_set.subject_id,
      'practice_type', target_set.practice_type,
      'set_number', target_set.set_number,
      'previous_status', previous_status,
      'new_status', requested_status
    )
  );

  return jsonb_build_object('id', target_set.id, 'status', requested_status);
end;
$$;

create or replace function public.admin_withdraw_practice_set(requested_practice_set_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.admin_transition_practice_set_v2(requested_practice_set_id, 'withdrawn');
$$;

create or replace function public.admin_republish_practice_set(requested_practice_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  validation jsonb;
begin
  perform public.admin_assert_access();

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then raise exception 'Practice set not found'; end if;
  if target_set.status <> 'withdrawn' then raise exception 'Only a withdrawn practice set can be republished'; end if;
  if target_set.replaced_by_practice_set_id is not null then raise exception 'This version has been replaced and cannot be republished'; end if;
  if exists (
    select 1 from public.practice_sets current_set
    where current_set.exam_pack_id = target_set.exam_pack_id
      and current_set.subject_id = target_set.subject_id
      and current_set.set_number = target_set.set_number
      and current_set.practice_type = target_set.practice_type
      and current_set.status = 'published'
      and current_set.id <> target_set.id
  ) then
    raise exception 'Another version is already published in this practice-set slot';
  end if;

  if target_set.practice_type = 'oral' then
    update public.oral_questions set status = 'published', updated_by = auth.uid()
    where practice_set_id = target_set.id and status = 'archived'
      and id = any(coalesce(target_set.withdrawn_question_ids, '{}'::uuid[]));
  else
    update public.questions set status = 'published', updated_by = auth.uid()
    where practice_set_id = target_set.id and status = 'archived'
      and id = any(coalesce(target_set.withdrawn_question_ids, '{}'::uuid[]));
  end if;

  validation := public.admin_get_practice_set_validation_v2(target_set.id);
  if not coalesce((validation->>'ready')::boolean, false) then
    raise exception 'Practice set is not ready: %',
      array_to_string(array(select jsonb_array_elements_text(validation->'errors')), ' ');
  end if;

  update public.practice_sets
  set status = 'published', published_at = now(), withdrawn_at = null,
      withdrawn_question_ids = null, updated_by = auth.uid()
  where id = target_set.id;

  perform public.admin_write_audit('REPUBLISH', 'practice_set', target_set.id,
    jsonb_build_object('module_id', target_set.subject_id, 'set_number', target_set.set_number,
      'previous_status', 'withdrawn', 'new_status', 'published'));

  return jsonb_build_object('id', target_set.id, 'status', 'published');
end;
$$;

create or replace function public.admin_retire_practice_set(
  requested_practice_set_id uuid,
  requested_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  result jsonb;
begin
  perform public.admin_assert_access();
  if length(btrim(coalesce(requested_reason, ''))) < 3 then
    raise exception 'Add a short reason for retiring this version';
  end if;

  select * into target_set from public.practice_sets
  where id = requested_practice_set_id for update;
  if not found then raise exception 'Practice set not found'; end if;

  result := public.admin_transition_practice_set_v2(target_set.id, 'archived');
  update public.practice_sets
  set retirement_reason = left(btrim(requested_reason), 500)
  where id = target_set.id;

  perform public.admin_write_audit('RETIRE_REASON', 'practice_set', target_set.id,
    jsonb_build_object('module_id', target_set.subject_id, 'reason', left(btrim(requested_reason), 500)));
  return result;
end;
$$;

create or replace function public.admin_create_practice_set_replacement(
  requested_source_practice_set_id uuid,
  requested_copy_questions boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_set public.practice_sets%rowtype;
  replacement_set public.practice_sets%rowtype;
  copied_count integer := 0;
begin
  perform public.admin_assert_access();

  select * into source_set
  from public.practice_sets
  where id = requested_source_practice_set_id
  for update;

  if not found then raise exception 'Practice set not found'; end if;
  if source_set.status not in ('published', 'withdrawn') then
    raise exception 'Create a replacement only from a published or withdrawn practice set';
  end if;
  if source_set.replaced_by_practice_set_id is not null then
    raise exception 'This version already has a replacement';
  end if;
  if exists (
    select 1 from public.practice_sets pending
    where pending.logical_set_key = source_set.logical_set_key
      and pending.replaces_practice_set_id is not null
      and pending.status in ('draft', 'review')
  ) then
    raise exception 'A replacement draft already exists for this practice set';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(source_set.logical_set_key::text, 0));

  insert into public.practice_sets (
    exam_pack_id, subject_id, set_number, expected_question_count, status,
    practice_type, logical_set_key, version_number, replaces_practice_set_id,
    created_by, updated_by
  ) values (
    source_set.exam_pack_id, source_set.subject_id, source_set.set_number,
    source_set.expected_question_count, 'draft', source_set.practice_type,
    source_set.logical_set_key, source_set.version_number + 1, source_set.id,
    auth.uid(), auth.uid()
  ) returning * into replacement_set;

  if requested_copy_questions and source_set.practice_type = 'oral' then
    insert into public.oral_questions (
      exam_pack_id, subject_id, practice_set_id, difficulty, question_text,
      model_answer, key_points, reference_note, source_note, status,
      batch_position, revision_number, created_by, updated_by
    )
    select source_set.exam_pack_id, source_set.subject_id, replacement_set.id,
      current_question.difficulty, current_question.question_text,
      current_question.model_answer, current_question.key_points,
      current_question.reference_note, 'Copied from version ' || source_set.version_number,
      'draft', current_question.batch_position, 1, auth.uid(), auth.uid()
    from (
      select distinct on (q.batch_position) q.*
      from public.oral_questions q
      where q.practice_set_id = source_set.id
      order by q.batch_position, q.revision_number desc, q.updated_at desc
    ) as current_question;
    get diagnostics copied_count = row_count;
  elsif requested_copy_questions then
    insert into public.questions (
      exam_pack_id, subject_id, practice_set_id, batch_number, batch_position,
      service_level, difficulty, question_text, option_a, option_b, option_c,
      option_d, correct_option, explanation, reference_note, source_note,
      status, revision_number, created_by, updated_by
    )
    select source_set.exam_pack_id, source_set.subject_id, replacement_set.id,
      source_set.set_number, current_question.batch_position,
      current_question.service_level, current_question.difficulty,
      current_question.question_text, current_question.option_a,
      current_question.option_b, current_question.option_c,
      current_question.option_d, current_question.correct_option,
      current_question.explanation, current_question.reference_note,
      'Copied from version ' || source_set.version_number,
      'draft', 1, auth.uid(), auth.uid()
    from (
      select distinct on (q.batch_position) q.*
      from public.questions q
      where q.practice_set_id = source_set.id
      order by q.batch_position, q.revision_number desc, q.updated_at desc
    ) as current_question;
    get diagnostics copied_count = row_count;
  end if;

  perform public.admin_write_audit('CREATE_REPLACEMENT', 'practice_set', replacement_set.id,
    jsonb_build_object(
      'module_id', source_set.subject_id,
      'old_practice_set_id', source_set.id,
      'replacement_practice_set_id', replacement_set.id,
      'set_number', source_set.set_number,
      'version_number', replacement_set.version_number,
      'copied_question_count', copied_count
    ));

  return jsonb_build_object(
    'id', replacement_set.id,
    'source_practice_set_id', source_set.id,
    'version_number', replacement_set.version_number,
    'copied_question_count', copied_count
  );
end;
$$;

create or replace function public.admin_publish_practice_set_replacement(
  requested_replacement_practice_set_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  replacement_set public.practice_sets%rowtype;
  source_set public.practice_sets%rowtype;
  validation jsonb;
  previous_count integer := 0;
  next_count integer := 0;
begin
  perform public.admin_assert_access();

  select * into replacement_set
  from public.practice_sets
  where id = requested_replacement_practice_set_id
  for update;

  if not found or replacement_set.replaces_practice_set_id is null then
    raise exception 'Replacement practice set not found';
  end if;
  if replacement_set.status <> 'review' then
    raise exception 'Send the replacement to review before publishing it';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(replacement_set.logical_set_key::text, 0));

  select * into source_set
  from public.practice_sets
  where id = replacement_set.replaces_practice_set_id
  for update;

  -- Archived sources are accepted only for a replacement draft created by the
  -- guarded pre-redesign recovery command. The normal admin creator never
  -- creates replacements from retired versions.
  if not found or source_set.status not in ('published', 'withdrawn', 'archived') then
    raise exception 'The source version is no longer available for replacement';
  end if;
  if source_set.exam_pack_id <> replacement_set.exam_pack_id
     or source_set.subject_id <> replacement_set.subject_id
     or source_set.set_number <> replacement_set.set_number
     or source_set.practice_type <> replacement_set.practice_type
     or source_set.logical_set_key <> replacement_set.logical_set_key then
    raise exception 'Replacement versions must belong to the same module, type, and practice-set slot';
  end if;

  validation := public.admin_get_practice_set_validation_v2(replacement_set.id);
  if not coalesce((validation->>'ready')::boolean, false) then
    raise exception 'Practice set is not ready: %',
      array_to_string(array(select jsonb_array_elements_text(validation->'errors')), ' ');
  end if;

  if replacement_set.practice_type = 'oral' then
    select count(*)::integer into previous_count from public.oral_questions where practice_set_id = source_set.id;
    select count(*)::integer into next_count from public.oral_questions where practice_set_id = replacement_set.id and status <> 'archived';
    update public.oral_questions set status = 'archived', updated_by = auth.uid()
      where practice_set_id = source_set.id and status = 'published';
    update public.oral_questions set status = 'published', updated_by = auth.uid()
      where practice_set_id = replacement_set.id and status in ('draft', 'review');
  else
    select count(*)::integer into previous_count from public.questions where practice_set_id = source_set.id;
    select count(*)::integer into next_count from public.questions where practice_set_id = replacement_set.id and status <> 'archived';
    update public.questions set status = 'archived', updated_by = auth.uid()
      where practice_set_id = source_set.id and status = 'published';
    update public.questions set status = 'published', updated_by = auth.uid()
      where practice_set_id = replacement_set.id and status in ('draft', 'review');
  end if;

  update public.practice_sets
  set status = 'archived', retired_at = now(), archived_at = now(),
      retirement_reason = 'Replaced by corrected version',
      replaced_by_practice_set_id = replacement_set.id, updated_by = auth.uid()
  where id = source_set.id;

  update public.practice_sets
  set status = 'published', ever_published = true,
      first_published_at = coalesce(first_published_at, now()), published_at = now(),
      withdrawn_at = null, updated_by = auth.uid()
  where id = replacement_set.id;

  update public.subjects
  set lifecycle_status = 'active', is_active = true,
      candidate_availability = case when candidate_availability = 'paused' then candidate_availability else 'available' end
  where id = replacement_set.subject_id and lifecycle_status <> 'retired';

  perform public.admin_write_audit('PUBLISH_REPLACEMENT', 'practice_set', replacement_set.id,
    jsonb_build_object(
      'module_id', replacement_set.subject_id,
      'old_practice_set_id', source_set.id,
      'replacement_practice_set_id', replacement_set.id,
      'previous_status', source_set.status,
      'new_status', 'published',
      'previous_question_count', previous_count,
      'new_question_count', next_count
    ));

  return jsonb_build_object(
    'id', replacement_set.id,
    'status', 'published',
    'retired_practice_set_id', source_set.id
  );
end;
$$;

create or replace function public.admin_replace_practice_set_questions(
  requested_practice_set_id uuid,
  requested_questions jsonb,
  requested_file_name text default null,
  requested_file_checksum text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  previous_count integer := 0;
  import_result jsonb;
begin
  perform public.admin_assert_access();

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then raise exception 'Practice set not found'; end if;
  if target_set.status not in ('draft', 'review') then
    raise exception 'Replace all is available only for draft or review practice sets';
  end if;

  if target_set.practice_type = 'oral' then
    select count(*)::integer into previous_count
    from public.oral_questions where practice_set_id = target_set.id;

    if exists (
      select 1 from public.oral_responses r
      join public.oral_questions q on q.id = r.question_id
      where q.practice_set_id = target_set.id
    ) then
      raise exception 'This action would break historical candidate reviews';
    end if;

    delete from public.oral_questions where practice_set_id = target_set.id;
    import_result := public.admin_import_oral_questions(
      target_set.id, requested_questions, requested_file_name, requested_file_checksum
    );
  else
    select count(*)::integer into previous_count
    from public.questions where practice_set_id = target_set.id;

    if exists (
      select 1 from public.attempt_answers aa
      join public.questions q on q.id = aa.question_id
      where q.practice_set_id = target_set.id
    ) then
      raise exception 'This action would break historical candidate reviews';
    end if;

    delete from public.questions where practice_set_id = target_set.id;
    import_result := public.admin_import_questions(
      target_set.id, requested_questions, requested_file_name, requested_file_checksum
    );
  end if;

  perform public.admin_write_audit('REPLACE_QUESTIONS', 'practice_set', target_set.id,
    jsonb_strip_nulls(jsonb_build_object(
      'module_id', target_set.subject_id,
      'previous_question_count', previous_count,
      'new_question_count', coalesce((import_result->>'imported_count')::integer, 0),
      'file_name', nullif(left(btrim(coalesce(requested_file_name, '')), 255), ''),
      'file_checksum', nullif(lower(btrim(coalesce(requested_file_checksum, ''))), '')
    )));

  return jsonb_build_object(
    'replaced_count', previous_count,
    'imported_count', coalesce((import_result->>'imported_count')::integer, 0),
    'final_count', coalesce((import_result->>'imported_count')::integer, 0)
  );
end;
$$;

create or replace function public.admin_delete_unpublished_practice_set(requested_practice_set_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  capabilities jsonb;
  deleted_question_count integer := 0;
begin
  perform public.admin_assert_access();
  select * into target_set from public.practice_sets
  where id = requested_practice_set_id for update;
  if not found then raise exception 'Practice set not found'; end if;

  capabilities := public.admin_get_practice_set_capabilities(target_set.id);
  if not coalesce((capabilities->>'can_delete')::boolean, false) then
    raise exception '%', coalesce(
      capabilities->'blocking_reasons'->'delete'->>0,
      'This practice set cannot be permanently deleted'
    );
  end if;

  if target_set.practice_type = 'oral' then
    delete from public.oral_questions where practice_set_id = target_set.id;
  else
    delete from public.questions where practice_set_id = target_set.id;
  end if;
  get diagnostics deleted_question_count = row_count;

  perform public.admin_write_audit('DELETE_UNUSED', 'practice_set', target_set.id,
    jsonb_build_object('module_id', target_set.subject_id, 'set_number', target_set.set_number,
      'previous_status', target_set.status, 'previous_question_count', deleted_question_count));
  delete from public.practice_sets where id = target_set.id;
  return true;
end;
$$;

create or replace function public.admin_delete_empty_practice_set_v2(requested_practice_set_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.admin_delete_unpublished_practice_set(requested_practice_set_id);
$$;

create or replace function public.admin_update_module_availability(
  requested_subject_id uuid,
  requested_availability text,
  requested_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subject public.subjects%rowtype;
  previous_availability public.module_candidate_availability;
  published_set_count integer;
  in_progress_count integer;
begin
  perform public.admin_assert_access();
  if requested_availability not in ('hidden', 'coming_soon', 'available', 'paused') then
    raise exception 'Choose a valid candidate availability';
  end if;

  select * into target_subject from public.subjects
  where id = requested_subject_id for update;
  if not found then raise exception 'Module not found'; end if;
  if target_subject.lifecycle_status = 'retired' then
    raise exception 'A retired module cannot be made available';
  end if;

  select count(*)::integer into published_set_count
  from public.practice_sets
  where subject_id = target_subject.id and status = 'published';
  if requested_availability = 'available' and published_set_count = 0 then
    raise exception 'Publish a practice set before making this module available';
  end if;

  select
    (select count(*) from public.objective_practice_sessions ops where ops.subject_id = target_subject.id and ops.status = 'active')
    + (select count(*) from public.oral_attempts oa where oa.subject_id = target_subject.id and oa.status = 'active')
  into in_progress_count;

  previous_availability := target_subject.candidate_availability;
  update public.subjects
  set candidate_availability = requested_availability::public.module_candidate_availability,
      is_active = requested_availability <> 'hidden'
  where id = target_subject.id;

  perform public.admin_write_audit('UPDATE_AVAILABILITY', 'module', target_subject.id,
    jsonb_strip_nulls(jsonb_build_object(
      'previous_availability', previous_availability,
      'new_availability', requested_availability,
      'reason', nullif(left(btrim(coalesce(requested_reason, '')), 500), ''),
      'published_set_count', published_set_count,
      'in_progress_attempt_count', in_progress_count
    )));

  return jsonb_build_object(
    'subject_id', target_subject.id,
    'candidate_availability', requested_availability,
    'in_progress_attempt_count', in_progress_count
  );
end;
$$;

create or replace function public.admin_update_module_sales_availability(
  requested_subject_id uuid,
  requested_available_for_purchase boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subject public.subjects%rowtype;
  active_pack_id uuid;
  previous_value boolean;
begin
  perform public.admin_assert_access();
  select * into target_subject from public.subjects
  where id = requested_subject_id for update;
  if not found then raise exception 'Module not found'; end if;
  if requested_available_for_purchase and target_subject.lifecycle_status <> 'active' then
    raise exception 'Only an active module can be offered for purchase';
  end if;

  select id into active_pack_id from public.exam_packs
  where is_active = true order by active_from desc, created_at desc limit 1;
  select coalesce(is_active, false) into previous_value from public.module_offerings
  where exam_pack_id = active_pack_id and subject_id = target_subject.id for update;

  update public.module_offerings
  set is_active = requested_available_for_purchase
  where exam_pack_id = active_pack_id and subject_id = target_subject.id;
  if not found then raise exception 'Set the module price before changing sales availability'; end if;

  perform public.admin_write_audit('UPDATE_SALES_AVAILABILITY', 'module', target_subject.id,
    jsonb_build_object('previous_available_for_purchase', coalesce(previous_value, false),
      'available_for_purchase', requested_available_for_purchase));
  return jsonb_build_object('subject_id', target_subject.id,
    'available_for_purchase', requested_available_for_purchase);
end;
$$;

create or replace function public.admin_update_module_lifecycle(
  requested_subject_id uuid,
  requested_lifecycle_status text,
  requested_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subject public.subjects%rowtype;
  active_pack_id uuid;
  published_set_count integer;
  active_entitlement_count integer;
begin
  perform public.admin_assert_access();
  if requested_lifecycle_status not in ('draft', 'active', 'retired') then
    raise exception 'Choose draft, active, or retired for the module lifecycle';
  end if;

  select * into target_subject from public.subjects
  where id = requested_subject_id for update;
  if not found then raise exception 'Module not found'; end if;
  if target_subject.lifecycle_status = 'retired' and requested_lifecycle_status <> 'retired' then
    raise exception 'A retired module cannot be reactivated through the normal admin interface';
  end if;
  if requested_lifecycle_status = 'retired'
     and length(btrim(coalesce(requested_reason, ''))) < 3 then
    raise exception 'Add a short reason for retiring this module';
  end if;

  select id into active_pack_id from public.exam_packs
  where is_active = true order by active_from desc, created_at desc limit 1;
  select count(*)::integer into published_set_count from public.practice_sets
  where exam_pack_id = active_pack_id and subject_id = target_subject.id and status = 'published';
  if requested_lifecycle_status = 'active' and published_set_count = 0 then
    raise exception 'Publish a practice set before activating this module';
  end if;
  if requested_lifecycle_status = 'draft' and published_set_count > 0 then
    raise exception 'Withdraw or retire every published practice set before returning the module to draft';
  end if;

  select
    (select count(*) from public.module_entitlements me where me.exam_pack_id = active_pack_id and me.subject_id = target_subject.id and me.status = 'active' and me.expires_at > now())
    + (select count(*) from public.entitlements e where e.exam_pack_id = active_pack_id and e.status = 'active' and e.expires_at > now())
  into active_entitlement_count;

  update public.subjects
  set lifecycle_status = requested_lifecycle_status::public.module_lifecycle_status,
      candidate_availability = case
        when requested_lifecycle_status = 'retired' then 'hidden'::public.module_candidate_availability
        else candidate_availability
      end,
      is_active = requested_lifecycle_status = 'active'
  where id = target_subject.id;

  if requested_lifecycle_status = 'retired' then
    update public.module_offerings set is_active = false
    where exam_pack_id = active_pack_id and subject_id = target_subject.id;
  end if;

  perform public.admin_write_audit('UPDATE_LIFECYCLE', 'module', target_subject.id,
    jsonb_strip_nulls(jsonb_build_object(
      'previous_status', target_subject.lifecycle_status,
      'new_status', requested_lifecycle_status,
      'reason', nullif(left(btrim(coalesce(requested_reason, '')), 500), ''),
      'active_entitlement_count', active_entitlement_count
    )));

  return jsonb_build_object(
    'subject_id', target_subject.id,
    'lifecycle_status', requested_lifecycle_status,
    'active_entitlement_count', active_entitlement_count
  );
end;
$$;

create or replace function public.get_admin_content_modules_v3()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  practice_type public.practice_type,
  sort_order integer,
  lifecycle_status public.module_lifecycle_status,
  candidate_availability public.module_candidate_availability,
  is_active boolean,
  batch_size integer,
  pass_mark_percent integer,
  offering_id uuid,
  price_kobo integer,
  currency text,
  available_for_purchase boolean,
  practice_set_count bigint,
  published_set_count bigint,
  withdrawn_set_count bigint,
  retired_set_count bigint,
  question_count bigint,
  attempt_count bigint,
  in_progress_attempt_count bigint,
  payment_count bigint,
  active_entitlement_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_access();
  return query
  with active_pack as (
    select ep.id from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc limit 1
  )
  select
    s.id, s.name, s.slug, s.practice_type, s.sort_order, s.lifecycle_status,
    s.candidate_availability, s.is_active, s.batch_size, s.pass_mark_percent,
    mo.id, mo.price_kobo, coalesce(mo.currency, 'NGN'), coalesce(mo.is_active, false),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id and ps.status = 'published'),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id and ps.status = 'withdrawn'),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id and ps.status = 'archived'),
    case when s.practice_type = 'oral'
      then (select count(*) from public.oral_questions q where q.subject_id = s.id and q.exam_pack_id = ap.id)
      else (select count(*) from public.questions q where q.subject_id = s.id and q.exam_pack_id = ap.id)
    end,
    case when s.practice_type = 'oral'
      then (select count(*) from public.oral_attempts a where a.subject_id = s.id and a.exam_pack_id = ap.id)
      else (select count(*) from public.attempts a where a.subject_id = s.id and a.exam_pack_id = ap.id)
    end,
    (select count(*) from public.objective_practice_sessions ops where ops.subject_id = s.id and ops.exam_pack_id = ap.id and ops.status = 'active')
      + (select count(*) from public.oral_attempts oa where oa.subject_id = s.id and oa.exam_pack_id = ap.id and oa.status = 'active'),
    (select count(*) from public.payment_orders po where po.subject_id = s.id and po.exam_pack_id = ap.id),
    (select count(*) from public.module_entitlements me where me.subject_id = s.id and me.exam_pack_id = ap.id and me.status = 'active' and me.expires_at > now())
      + (select count(*) from public.entitlements e where e.exam_pack_id = ap.id and e.status = 'active' and e.expires_at > now())
  from public.subjects s
  cross join active_pack ap
  left join public.module_offerings mo on mo.subject_id = s.id and mo.exam_pack_id = ap.id
  order by s.sort_order, s.name;
end;
$$;

create or replace function public.get_admin_practice_sets_v3(requested_subject_id uuid)
returns table (
  practice_set_id uuid,
  practice_type public.practice_type,
  set_number integer,
  status public.practice_set_status,
  expected_question_count integer,
  active_question_count bigint,
  draft_count bigint,
  review_count bigint,
  published_count bigint,
  archived_count bigint,
  attempt_count integer,
  in_progress_attempt_count integer,
  completed_attempt_count integer,
  published_at timestamptz,
  withdrawn_at timestamptz,
  retired_at timestamptz,
  updated_at timestamptz,
  logical_set_key uuid,
  version_number integer,
  replaces_practice_set_id uuid,
  replaced_by_practice_set_id uuid,
  capabilities jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_access();
  return query
  select
    ps.id, ps.practice_type, ps.set_number, ps.status, ps.expected_question_count,
    case when ps.practice_type = 'oral'
      then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status <> 'archived' and (q.supersedes_question_id is null or q.status = 'published'))
      else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status <> 'archived' and (q.supersedes_question_id is null or q.status = 'published'))
    end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'draft') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'draft') end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'review') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'review') end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'published') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'published') end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'archived') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'archived') end,
    coalesce((public.admin_get_practice_set_capabilities(ps.id)->>'attempt_count')::integer, 0),
    coalesce((public.admin_get_practice_set_capabilities(ps.id)->>'in_progress_attempt_count')::integer, 0),
    coalesce((public.admin_get_practice_set_capabilities(ps.id)->>'completed_attempt_count')::integer, 0),
    ps.published_at, ps.withdrawn_at, ps.retired_at, ps.updated_at,
    ps.logical_set_key, ps.version_number, ps.replaces_practice_set_id,
    ps.replaced_by_practice_set_id,
    public.admin_get_practice_set_capabilities(ps.id)
  from public.practice_sets ps
  where ps.subject_id = requested_subject_id
    and ps.exam_pack_id = (
      select ep.id from public.exam_packs ep where ep.is_active = true
      order by ep.active_from desc, ep.created_at desc limit 1
    )
  order by ps.set_number, ps.version_number desc;
end;
$$;

create or replace function public.start_objective_practice_session(
  requested_subject_id uuid default null,
  requested_subject_slug text default null,
  requested_batch_number integer default null,
  requested_allow_free_lock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_ctx record;
  v_subject public.subjects%rowtype;
  v_set public.practice_sets%rowtype;
  v_session public.objective_practice_sessions%rowtype;
  v_question_ids uuid[];
  v_questions jsonb;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;

  select * into v_subject
  from public.subjects
  where (requested_subject_id is not null and id = requested_subject_id)
     or (coalesce(btrim(requested_subject_slug), '') <> '' and slug = requested_subject_slug)
  order by sort_order
  limit 1;

  if not found or v_subject.practice_type <> 'objective' then
    raise exception 'Choose an objective practice module';
  end if;
  if v_subject.candidate_availability = 'paused' then
    raise exception 'This module is temporarily paused. Your access and previous results are safe.';
  end if;
  if v_subject.candidate_availability <> 'available' then
    raise exception 'Practice is not available for this module yet.';
  end if;

  select * into v_ctx
  from public.resolve_practice_batch_context(
    requested_subject_id => start_objective_practice_session.requested_subject_id,
    requested_subject_slug => start_objective_practice_session.requested_subject_slug,
    requested_batch_number => start_objective_practice_session.requested_batch_number,
    allow_free_lock => start_objective_practice_session.requested_allow_free_lock
  );

  select * into v_set
  from public.practice_sets
  where exam_pack_id = v_ctx.exam_pack_id
    and subject_id = v_ctx.subject_id
    and set_number = v_ctx.batch_number
    and practice_type = 'objective'
    and status = 'published'
  order by version_number desc
  limit 1;

  if not found then
    raise exception 'This practice set is temporarily unavailable while its content is being updated. Your access and previous results are safe.';
  end if;

  select * into v_session
  from public.objective_practice_sessions
  where user_id = v_user_id
    and practice_set_id = v_set.id
    and status = 'active'
    and expires_at > now()
  order by started_at desc
  limit 1
  for update;

  if v_session.id is null then
    update public.objective_practice_sessions
    set status = 'abandoned'
    where user_id = v_user_id and practice_set_id = v_set.id and status = 'active';

    select array_agg(q.id order by coalesce(q.batch_position, 1000000), q.id)
    into v_question_ids
    from public.questions q
    where q.practice_set_id = v_set.id and q.status = 'published';

    if coalesce(cardinality(v_question_ids), 0) <> v_set.expected_question_count then
      raise exception 'This practice set is not ready yet';
    end if;

    insert into public.objective_practice_sessions (
      user_id, exam_pack_id, subject_id, practice_set_id, question_ids,
      batch_number, pass_mark_percent, is_free_attempt, retry_number
    ) values (
      v_user_id, v_ctx.exam_pack_id, v_ctx.subject_id, v_set.id, v_question_ids,
      v_ctx.batch_number, v_ctx.pass_mark_percent, v_ctx.is_free_attempt, v_ctx.retry_number
    ) returning * into v_session;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'practice_session_id', v_session.id,
      'practice_set_id', v_set.id,
      'subject_id', q.subject_id,
      'subject_name', v_ctx.subject_name,
      'subject_slug', v_ctx.subject_slug,
      'service_level', q.service_level,
      'difficulty', q.difficulty,
      'question_text', q.question_text,
      'option_a', q.option_a,
      'option_b', q.option_b,
      'option_c', q.option_c,
      'option_d', q.option_d,
      'correct_option', null,
      'explanation', null,
      'reference_note', q.reference_note,
      'batch_number', v_session.batch_number,
      'batch_size', cardinality(v_session.question_ids),
      'pass_mark_percent', v_session.pass_mark_percent,
      'is_free_attempt', v_session.is_free_attempt,
      'retry_number', v_session.retry_number,
      'display_order', question_order.ordinality
    ) order by question_order.ordinality
  ) into v_questions
  from unnest(v_session.question_ids) with ordinality as question_order(question_id, ordinality)
  join public.questions q on q.id = question_order.question_id;

  return jsonb_build_object(
    'practice_session_id', v_session.id,
    'practice_set_id', v_set.id,
    'questions', coalesce(v_questions, '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_objective_practice_session(
  submitted_session_id uuid,
  submitted_mode public.attempt_mode,
  submitted_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.objective_practice_sessions%rowtype;
  v_attempt_id uuid;
  v_answer_row record;
  v_question public.questions%rowtype;
  v_selected_option text;
  v_option_order text[];
  v_score integer := 0;
  v_total integer := 0;
  v_score_percent integer := 0;
  v_passed boolean := false;
  v_next_set_number integer;
  v_next_action text := 'review_only';
  v_review jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if submitted_answers is null or jsonb_typeof(submitted_answers) <> 'array'
     or jsonb_array_length(submitted_answers) = 0 then
    raise exception 'Answer at least one question before submitting.';
  end if;

  select * into v_session
  from public.objective_practice_sessions
  where id = submitted_session_id and user_id = v_user_id
  for update;

  if not found then raise exception 'This practice session could not be found. Start again from the dashboard.'; end if;
  if v_session.status <> 'active' then raise exception 'This practice session has already been completed.'; end if;
  if v_session.expires_at <= now() then raise exception 'This practice session has expired. Start a new attempt.'; end if;

  if exists (
    select 1
    from jsonb_array_elements(submitted_answers) answer
    where not ((answer->>'question_id')::uuid = any(v_session.question_ids))
  ) then
    raise exception 'The submitted answers do not belong to this practice session.';
  end if;

  insert into public.attempts (
    user_id, exam_pack_id, mode, subject_id, service_level, batch_number,
    retry_number, is_free_attempt, practice_set_id
  ) values (
    v_user_id, v_session.exam_pack_id, submitted_mode, v_session.subject_id,
    null, v_session.batch_number, v_session.retry_number,
    v_session.is_free_attempt, v_session.practice_set_id
  ) returning id into v_attempt_id;

  for v_answer_row in
    select payload.answer, payload.ordinality::integer as ordinal_position
    from jsonb_array_elements(submitted_answers) with ordinality as payload(answer, ordinality)
  loop
    select * into v_question from public.questions
    where id = (v_answer_row.answer->>'question_id')::uuid
      and practice_set_id = v_session.practice_set_id;
    if not found then raise exception 'A question in this session is no longer available for historical grading.'; end if;

    v_selected_option := nullif(upper(btrim(coalesce(v_answer_row.answer->>'selected_option', ''))), '');
    select array_agg(upper(option_key) order by option_position)
    into v_option_order
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_answer_row.answer->'option_order') = 'array'
        then v_answer_row.answer->'option_order'
        else '["A", "B", "C", "D"]'::jsonb end
    ) with ordinality as options(option_key, option_position);
    if cardinality(v_option_order) <> 4 or not (v_option_order @> array['A','B','C','D']::text[]) then
      v_option_order := array['A','B','C','D']::text[];
    end if;

    v_total := v_total + 1;
    if v_selected_option = v_question.correct_option then v_score := v_score + 1; end if;

    insert into public.attempt_answers (
      attempt_id, user_id, question_id, selected_option, is_correct,
      time_spent_seconds, display_order, option_order
    ) values (
      v_attempt_id, v_user_id, v_question.id, v_selected_option,
      coalesce(v_selected_option = v_question.correct_option, false),
      greatest(coalesce((v_answer_row.answer->>'time_spent_seconds')::integer, 0), 0),
      coalesce((v_answer_row.answer->>'display_order')::integer, v_answer_row.ordinal_position),
      v_option_order
    );

    v_review := v_review || jsonb_build_object(
      'question_id', v_question.id,
      'selected_option', v_selected_option,
      'correct_option', v_question.correct_option,
      'is_correct', coalesce(v_selected_option = v_question.correct_option, false),
      'explanation', v_question.explanation,
      'reference_note', v_question.reference_note,
      'display_order', coalesce((v_answer_row.answer->>'display_order')::integer, v_answer_row.ordinal_position),
      'option_order', to_jsonb(v_option_order)
    );
  end loop;

  if v_total > 0 then v_score_percent := round((v_score::numeric * 100) / v_total)::integer; end if;
  v_passed := v_total > 0 and v_score_percent >= v_session.pass_mark_percent;

  update public.attempts
  set completed_at = now(), score = v_score, total_questions = v_total,
      score_percent = v_score_percent, passed = v_passed
  where id = v_attempt_id;

  update public.objective_practice_sessions
  set status = 'completed', completed_at = now()
  where id = v_session.id;

  select min(ps.set_number) into v_next_set_number
  from public.practice_sets ps
  where ps.exam_pack_id = v_session.exam_pack_id
    and ps.subject_id = v_session.subject_id
    and ps.practice_type = 'objective'
    and ps.status = 'published'
    and ps.set_number > v_session.batch_number;

  if v_session.is_free_attempt then
    update public.user_module_progress
    set free_first_attempt_completed = true,
        free_retry_consumed = case when v_session.retry_number >= 1 then true else free_retry_consumed end,
        last_attempt_id = v_attempt_id, last_attempted_at = now(),
        current_batch_number = 1,
        highest_unlocked_batch_number = greatest(coalesce(highest_unlocked_batch_number, 1), 1)
    where user_id = v_user_id and exam_pack_id = v_session.exam_pack_id
      and subject_id = v_session.subject_id;
    v_next_action := case when v_passed or v_session.retry_number >= 1
      then 'unlock_full_access' else 'retry_free_batch' end;
  else
    update public.user_module_progress
    set last_attempt_id = v_attempt_id, last_attempted_at = now(),
        current_batch_number = case when v_passed and v_next_set_number is not null then v_next_set_number else v_session.batch_number end,
        highest_unlocked_batch_number = case when v_passed and v_next_set_number is not null
          then greatest(coalesce(highest_unlocked_batch_number, 1), v_next_set_number)
          else greatest(coalesce(highest_unlocked_batch_number, 1), v_session.batch_number) end
    where user_id = v_user_id and exam_pack_id = v_session.exam_pack_id
      and subject_id = v_session.subject_id;
    v_next_action := case
      when v_passed and v_next_set_number is not null then 'next_batch'
      when v_passed then 'module_complete'
      when v_next_set_number is not null then 'retry_or_next'
      else 'review_only' end;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt_id, 'score', v_score, 'total_questions', v_total,
    'review', v_review, 'batch_number', v_session.batch_number,
    'score_percent', v_score_percent, 'passed', v_passed,
    'retry_number', v_session.retry_number, 'next_action', v_next_action
  );
end;
$$;

create or replace function public.submit_attempt_idempotent_v2(
  submitted_session_id uuid,
  submitted_mode public.attempt_mode,
  submitted_answers jsonb,
  submitted_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_response jsonb;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if submitted_token is null then raise exception 'Submission token is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || submitted_token::text, 0));

  select response_payload into v_response
  from public.attempt_submission_keys
  where user_id = v_user_id and submission_token = submitted_token;
  if v_response is not null then return v_response; end if;

  v_response := public.submit_objective_practice_session(
    submitted_session_id, submitted_mode, submitted_answers
  );
  insert into public.attempt_submission_keys (user_id, submission_token, response_payload)
  values (v_user_id, submitted_token, v_response);
  return v_response;
end;
$$;

create or replace function public.admin_inspect_retired_practice_sets()
returns table (
  practice_set_id uuid,
  module_name text,
  practice_type public.practice_type,
  set_number integer,
  version_number integer,
  status public.practice_set_status,
  question_count bigint,
  attempt_count bigint,
  in_progress_attempt_count bigint,
  completed_attempt_count bigint,
  active_entitlement_count bigint,
  current_slot_practice_set_id uuid,
  recovery_recommendation text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_access();
  return query
  select
    ps.id,
    s.name,
    ps.practice_type,
    ps.set_number,
    ps.version_number,
    ps.status,
    coalesce((caps.data->>'question_count')::bigint, 0),
    coalesce((caps.data->>'attempt_count')::bigint, 0),
    coalesce((caps.data->>'in_progress_attempt_count')::bigint, 0),
    coalesce((caps.data->>'completed_attempt_count')::bigint, 0),
    (select count(*)
      from public.module_entitlements me
      where me.exam_pack_id = ps.exam_pack_id and me.subject_id = ps.subject_id
        and me.status = 'active' and me.expires_at > now())
      + (select count(*)
        from public.entitlements e
        where e.exam_pack_id = ps.exam_pack_id and e.status = 'active' and e.expires_at > now()),
    current_set.id,
    case
      when coalesce((caps.data->>'attempt_count')::integer, 0) = 0
        and ps.replaced_by_practice_set_id is null
        and current_set.id is null
      then 'Eligible for the documented one-time pre-redesign recovery after a final reference check.'
      else 'Preserve this retired version and create or use a replacement draft.'
    end
  from public.practice_sets ps
  join public.subjects s on s.id = ps.subject_id
  cross join lateral (
    select public.admin_get_practice_set_capabilities(ps.id) as data
  ) caps
  left join lateral (
    select published.id
    from public.practice_sets published
    where published.exam_pack_id = ps.exam_pack_id
      and published.subject_id = ps.subject_id
      and published.set_number = ps.set_number
      and published.practice_type = ps.practice_type
      and published.status = 'published'
      and published.id <> ps.id
    limit 1
  ) current_set on true
  where ps.status = 'archived'
  order by ps.retired_at desc nulls last, ps.updated_at desc;
end;
$$;

-- Existing oral attempts resume before current availability is checked. New
-- attempts still require an available module and a currently published set.
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

  select * into v_pack from public.exam_packs
  where is_active = true order by active_from desc, created_at desc limit 1;
  if v_pack.id is null then raise exception 'No active exam pack is configured'; end if;

  select * into v_active_attempt
  from public.oral_attempts
  where user_id = v_user_id and status = 'active'
  order by started_at desc limit 1 for update;
  if v_active_attempt.id is not null then
    return public.get_oral_attempt_state(v_active_attempt.id);
  end if;

  select * into v_subject from public.subjects
  where slug = requested_subject_slug and is_active = true and practice_type = 'oral'
  limit 1;
  if v_subject.id is null then raise exception 'This oral practice module is unavailable'; end if;
  if v_subject.candidate_availability = 'paused' then
    raise exception 'This module is temporarily paused. Your access and previous results are safe.';
  end if;
  if v_subject.candidate_availability <> 'available' then
    raise exception 'Practice is not available for this module yet.';
  end if;

  select * into v_set from public.practice_sets
  where exam_pack_id = v_pack.id and subject_id = v_subject.id
    and set_number = greatest(coalesce(requested_set_number, 1), 1)
    and practice_type = 'oral' and status = 'published'
  order by version_number desc limit 1;
  if v_set.id is null then
    raise exception 'This oral practice set is temporarily unavailable while its content is being updated. Your access and previous results are safe.';
  end if;

  select count(*)::integer into v_question_count from public.oral_questions
  where practice_set_id = v_set.id and status = 'published';
  if v_question_count = 0 or v_question_count <> v_set.expected_question_count then
    raise exception 'This oral practice set is not ready yet';
  end if;

  v_is_paid := public.has_active_module_entitlement(v_pack.id, v_subject.id);
  if not v_is_paid then
    select subject_id into v_selected_free_subject_id
    from public.user_module_progress
    where user_id = v_user_id and exam_pack_id = v_pack.id
      and selected_for_free_access = true limit 1;

    if v_selected_free_subject_id is not null and v_selected_free_subject_id <> v_subject.id then
      raise exception 'Your free practice is already assigned to another module';
    end if;
    if v_set.set_number <> 1 then raise exception 'Unlock this module to use more oral practice sets'; end if;
    if exists (
      select 1 from public.oral_attempts
      where user_id = v_user_id and exam_pack_id = v_pack.id
        and subject_id = v_subject.id and practice_set_id = v_set.id and status = 'completed'
    ) then
      raise exception 'Your free oral practice is complete. Unlock this module to practise again';
    end if;

    insert into public.user_module_progress (
      user_id, exam_pack_id, subject_id, current_batch_number,
      highest_unlocked_batch_number, selected_for_free_access
    ) values (v_user_id, v_pack.id, v_subject.id, 1, 1, true)
    on conflict (user_id, exam_pack_id, subject_id)
    do update set selected_for_free_access = true, updated_at = now();
  end if;

  insert into public.oral_attempts (
    user_id, exam_pack_id, subject_id, practice_set_id,
    seconds_per_question, current_position, total_questions
  ) values (
    v_user_id, v_pack.id, v_subject.id, v_set.id,
    requested_seconds_per_question, 1, v_question_count
  ) returning id into v_attempt_id;

  insert into public.oral_responses (
    attempt_id, user_id, question_id, display_order, question_text_snapshot,
    model_answer_snapshot, key_points_snapshot, reference_note_snapshot,
    status, started_at, deadline_at
  )
  select v_attempt_id, v_user_id, q.id,
    row_number() over (order by q.batch_position, q.id)::integer,
    q.question_text, q.model_answer, q.key_points, q.reference_note,
    case when row_number() over (order by q.batch_position, q.id) = 1
      then 'active'::public.oral_response_status else 'pending'::public.oral_response_status end,
    case when row_number() over (order by q.batch_position, q.id) = 1 then v_now else null end,
    case when row_number() over (order by q.batch_position, q.id) = 1
      then v_now + make_interval(secs => requested_seconds_per_question) else null end
  from public.oral_questions q
  where q.practice_set_id = v_set.id and q.status = 'published'
  order by q.batch_position, q.id;

  return public.build_oral_attempt_payload(v_attempt_id);
end;
$$;

drop function if exists public.get_module_access_catalog();
create function public.get_module_access_catalog()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  practice_type public.practice_type,
  lifecycle_status public.module_lifecycle_status,
  candidate_availability public.module_candidate_availability,
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
    select ep.* from public.exam_packs ep
    where ep.is_active = true order by ep.active_from desc, ep.created_at desc limit 1
  ),
  legacy_access as (
    select max(e.expires_at) as expires_at
    from public.entitlements e join active_pack ap on ap.id = e.exam_pack_id
    where e.user_id = auth.uid() and e.status = 'active' and e.expires_at > now()
  ),
  module_access as (
    select me.subject_id, max(me.expires_at) as expires_at
    from public.module_entitlements me join active_pack ap on ap.id = me.exam_pack_id
    where me.user_id = auth.uid() and me.status = 'active' and me.expires_at > now()
    group by me.subject_id
  ),
  free_module as (
    select ump.subject_id from public.user_module_progress ump
    join active_pack ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid() and ump.selected_for_free_access = true limit 1
  ),
  published as (
    select ps.subject_id, count(*)::integer as batch_count
    from public.practice_sets ps join active_pack ap on ap.id = ps.exam_pack_id
    where ps.status = 'published'
      and exists (
        select 1 from public.questions q where q.practice_set_id = ps.id and q.status = 'published'
        union all
        select 1 from public.oral_questions oq where oq.practice_set_id = ps.id and oq.status = 'published'
      )
    group by ps.subject_id
  )
  select
    s.id, s.name, s.slug, s.practice_type, s.lifecycle_status,
    s.candidate_availability, mo.id, mo.price_kobo, mo.currency,
    coalesce(mo.is_active, false) and s.lifecycle_status = 'active'
      and coalesce(p.batch_count, 0) > 0,
    (la.expires_at is not null or ma.expires_at is not null),
    greatest(la.expires_at, ma.expires_at),
    exists (select 1 from free_module fm where fm.subject_id = s.id),
    coalesce(p.batch_count, 0)
  from public.subjects s
  cross join active_pack ap
  left join public.module_offerings mo
    on mo.exam_pack_id = ap.id and mo.subject_id = s.id
  left join published p on p.subject_id = s.id
  left join module_access ma on ma.subject_id = s.id
  cross join legacy_access la
  where s.is_active = true
  order by s.sort_order, s.name;
$$;

revoke all on function public.admin_get_practice_set_capabilities(uuid) from public, anon;
revoke all on function public.admin_withdraw_practice_set(uuid) from public, anon;
revoke all on function public.admin_republish_practice_set(uuid) from public, anon;
revoke all on function public.admin_retire_practice_set(uuid, text) from public, anon;
revoke all on function public.admin_create_practice_set_replacement(uuid, boolean) from public, anon;
revoke all on function public.admin_publish_practice_set_replacement(uuid) from public, anon;
revoke all on function public.admin_replace_practice_set_questions(uuid, jsonb, text, text) from public, anon;
revoke all on function public.admin_delete_unpublished_practice_set(uuid) from public, anon;
revoke all on function public.admin_update_module_availability(uuid, text, text) from public, anon;
revoke all on function public.admin_update_module_sales_availability(uuid, boolean) from public, anon;
revoke all on function public.admin_update_module_lifecycle(uuid, text, text) from public, anon;
revoke all on function public.get_admin_content_modules_v3() from public, anon;
revoke all on function public.get_admin_practice_sets_v3(uuid) from public, anon;
revoke all on function public.admin_inspect_retired_practice_sets() from public, anon;
revoke all on function public.start_objective_practice_session(uuid, text, integer, boolean) from public, anon;
revoke all on function public.submit_objective_practice_session(uuid, public.attempt_mode, jsonb) from public, anon;
revoke all on function public.submit_attempt_idempotent_v2(uuid, public.attempt_mode, jsonb, uuid) from public, anon;

grant execute on function public.admin_get_practice_set_capabilities(uuid) to authenticated;
grant execute on function public.admin_withdraw_practice_set(uuid) to authenticated;
grant execute on function public.admin_republish_practice_set(uuid) to authenticated;
grant execute on function public.admin_retire_practice_set(uuid, text) to authenticated;
grant execute on function public.admin_create_practice_set_replacement(uuid, boolean) to authenticated;
grant execute on function public.admin_publish_practice_set_replacement(uuid) to authenticated;
grant execute on function public.admin_replace_practice_set_questions(uuid, jsonb, text, text) to authenticated;
grant execute on function public.admin_delete_unpublished_practice_set(uuid) to authenticated;
grant execute on function public.admin_update_module_availability(uuid, text, text) to authenticated;
grant execute on function public.admin_update_module_sales_availability(uuid, boolean) to authenticated;
grant execute on function public.admin_update_module_lifecycle(uuid, text, text) to authenticated;
grant execute on function public.get_admin_content_modules_v3() to authenticated;
grant execute on function public.get_admin_practice_sets_v3(uuid) to authenticated;
grant execute on function public.admin_inspect_retired_practice_sets() to authenticated;
grant execute on function public.start_objective_practice_session(uuid, text, integer, boolean) to authenticated;
grant execute on function public.submit_attempt_idempotent_v2(uuid, public.attempt_mode, jsonb, uuid) to authenticated;
revoke all on function public.get_module_access_catalog() from public, anon;
grant execute on function public.get_module_access_catalog() to authenticated;
