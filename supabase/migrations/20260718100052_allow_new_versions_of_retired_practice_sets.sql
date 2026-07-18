-- Retiring a practice-set version closes that immutable version permanently,
-- but administrators may still create a later version in the same numbered slot.

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
      to_jsonb(array['Published and historical content is immutable. Create a new version instead.'])
    );
  end if;

  if v_in_progress_count > 0 then
    v_warnings := array_append(v_warnings, format('%s candidate attempt(s) are currently in progress.', v_in_progress_count));
  end if;
  if target_set.status = 'withdrawn' then
    v_warnings := array_append(v_warnings, 'New attempts are paused; existing attempts and reviews remain available.');
  end if;
  if target_set.status = 'archived' then
    v_warnings := array_append(v_warnings, 'This version is permanently retired and cannot be republished. A separate new version may be created.');
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
    'can_create_replacement', target_set.status in ('published', 'withdrawn', 'archived')
      and target_set.replaced_by_practice_set_id is null
      and not v_is_replacement_source
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
  next_version integer;
begin
  perform public.admin_assert_access();

  select * into source_set
  from public.practice_sets
  where id = requested_source_practice_set_id
  for update;

  if not found then raise exception 'Practice set not found'; end if;
  if source_set.status not in ('published', 'withdrawn', 'archived') then
    raise exception 'Create a new version only from a published, withdrawn, or retired practice set';
  end if;
  if source_set.replaced_by_practice_set_id is not null then
    raise exception 'This version already has a replacement';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(source_set.logical_set_key::text, 0));

  if exists (
    select 1 from public.practice_sets newer
    where newer.logical_set_key = source_set.logical_set_key
      and newer.version_number > source_set.version_number
  ) then
    raise exception 'Create the new version from the latest practice-set version';
  end if;
  if exists (
    select 1 from public.practice_sets pending
    where pending.logical_set_key = source_set.logical_set_key
      and pending.replaces_practice_set_id is not null
      and pending.status in ('draft', 'review')
  ) then
    raise exception 'A replacement draft already exists for this practice set';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.practice_sets
  where logical_set_key = source_set.logical_set_key;

  insert into public.practice_sets (
    exam_pack_id, subject_id, set_number, expected_question_count, status,
    practice_type, logical_set_key, version_number, replaces_practice_set_id,
    created_by, updated_by
  ) values (
    source_set.exam_pack_id, source_set.subject_id, source_set.set_number,
    source_set.expected_question_count, 'draft', source_set.practice_type,
    source_set.logical_set_key, next_version, source_set.id,
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
      'copied_question_count', copied_count,
      'source_status', source_set.status
    ));

  return jsonb_build_object(
    'id', replacement_set.id,
    'source_practice_set_id', source_set.id,
    'set_number', replacement_set.set_number,
    'version_number', replacement_set.version_number,
    'copied_question_count', copied_count
  );
end;
$$;

revoke all on function public.admin_get_practice_set_capabilities(uuid) from public, anon;
revoke all on function public.admin_create_practice_set_replacement(uuid, boolean) from public, anon;
grant execute on function public.admin_get_practice_set_capabilities(uuid) to authenticated;
grant execute on function public.admin_create_practice_set_replacement(uuid, boolean) to authenticated;
