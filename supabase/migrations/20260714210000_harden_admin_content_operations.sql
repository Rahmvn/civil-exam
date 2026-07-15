-- Keep content publication separate from commerce and make destructive/import
-- operations fully traceable without weakening the existing admin RPC boundary.

alter function public.admin_transition_practice_set(uuid, text)
  rename to admin_transition_practice_set_content_lifecycle;

revoke all on function public.admin_transition_practice_set_content_lifecycle(uuid, text)
from public, anon, authenticated;

create function public.admin_transition_practice_set(
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
  sales_were_enabled boolean := false;
  result jsonb;
begin
  perform public.admin_assert_access();

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id;

  if not found then
    raise exception 'Practice set not found';
  end if;

  select coalesce(mo.is_active, false)
  into sales_were_enabled
  from public.module_offerings as mo
  where mo.exam_pack_id = target_set.exam_pack_id
    and mo.subject_id = target_set.subject_id
  for update;

  result := public.admin_transition_practice_set_content_lifecycle(
    requested_practice_set_id,
    requested_status
  );

  -- The legacy lifecycle operation activates the first module offering when its
  -- first set is published. Restore the administrator's explicit sales choice.
  if requested_status = 'published' then
    update public.module_offerings
    set is_active = sales_were_enabled
    where exam_pack_id = target_set.exam_pack_id
      and subject_id = target_set.subject_id;
  end if;

  return result;
end;
$$;

revoke all on function public.admin_transition_practice_set(uuid, text) from public, anon;
grant execute on function public.admin_transition_practice_set(uuid, text) to authenticated;

create or replace function public.admin_archive_question(requested_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_question public.questions%rowtype;
begin
  perform public.admin_assert_access();

  select * into target_question
  from public.questions
  where id = requested_question_id
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  if target_question.status = 'published' then
    raise exception 'Replace a published question or archive its entire practice set';
  end if;

  update public.questions
  set status = 'archived', updated_by = auth.uid()
  where id = requested_question_id;

  perform public.admin_write_audit(
    'ARCHIVE',
    'question',
    target_question.id,
    jsonb_build_object(
      'practice_set_id', target_question.practice_set_id,
      'batch_position', target_question.batch_position,
      'supersedes_question_id', target_question.supersedes_question_id
    )
  );

  return true;
end;
$$;

create or replace function public.admin_delete_draft_question(requested_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_question public.questions%rowtype;
begin
  perform public.admin_assert_access();

  select * into target_question
  from public.questions
  where id = requested_question_id
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  if target_question.status not in ('draft', 'review')
     or exists (select 1 from public.attempt_answers where question_id = target_question.id) then
    raise exception 'Only an unused draft or review question can be permanently deleted';
  end if;

  perform public.admin_write_audit(
    'DELETE',
    'question',
    target_question.id,
    jsonb_build_object(
      'practice_set_id', target_question.practice_set_id,
      'batch_position', target_question.batch_position,
      'status', target_question.status
    )
  );

  delete from public.questions where id = target_question.id;
  return true;
end;
$$;

revoke all on function public.admin_import_questions(uuid, jsonb) from public, anon, authenticated;
drop function public.admin_import_questions(uuid, jsonb);

create function public.admin_import_questions(
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
  item jsonb;
  item_number integer := 0;
  base_position integer := 0;
  requested_position integer;
  imported_count integer := 0;
  normalized_checksum text := lower(trim(coalesce(requested_file_checksum, '')));
  normalized_file_name text := left(trim(coalesce(requested_file_name, '')), 255);
begin
  perform public.admin_assert_access();

  if jsonb_typeof(requested_questions) <> 'array' then
    raise exception 'Imported questions must be an array';
  end if;

  if jsonb_array_length(requested_questions) < 1 or jsonb_array_length(requested_questions) > 200 then
    raise exception 'Import between 1 and 200 questions at a time';
  end if;

  if normalized_checksum <> '' and normalized_checksum !~ '^[a-f0-9]{64}$' then
    raise exception 'The import file checksum is invalid';
  end if;

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then
    raise exception 'Practice set not found';
  end if;

  if target_set.status in ('published', 'archived') then
    raise exception 'Questions can only be imported into a draft or review practice set';
  end if;

  if normalized_checksum <> '' and exists (
    select 1
    from public.admin_audit_logs as aal
    where aal.action = 'IMPORT'
      and aal.entity_type = 'practice_set'
      and aal.entity_id = target_set.id
      and aal.metadata->>'file_checksum' = normalized_checksum
  ) then
    raise exception 'This file has already been imported into this practice set';
  end if;

  select coalesce(max(q.batch_position), 0)
  into base_position
  from public.questions as q
  where q.practice_set_id = target_set.id
    and q.status <> 'archived';

  for item in select value from jsonb_array_elements(requested_questions)
  loop
    item_number := item_number + 1;
    if nullif(item->>'batch_position', '') is null then
      item := jsonb_set(item, '{batch_position}', to_jsonb(base_position + item_number), true);
    end if;

    item := jsonb_set(item, '{practice_set_id}', to_jsonb(target_set.id::text), true);
    perform public.admin_validate_question_payload(item, false);
    requested_position := (item->>'batch_position')::integer;

    if exists (
      select 1 from public.questions q
      where q.practice_set_id = target_set.id
        and q.status <> 'archived'
        and q.batch_position = requested_position
    ) then
      raise exception 'Import row % uses an existing question position %', item_number, requested_position;
    end if;

    if exists (
      select 1 from public.questions q
      where q.practice_set_id = target_set.id
        and q.status <> 'archived'
        and lower(regexp_replace(trim(q.question_text), '\\s+', ' ', 'g')) =
            lower(regexp_replace(trim(item->>'question_text'), '\\s+', ' ', 'g'))
    ) then
      raise exception 'Import row % duplicates an existing question', item_number;
    end if;

    insert into public.questions (
      exam_pack_id,
      subject_id,
      practice_set_id,
      batch_number,
      batch_position,
      difficulty,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option,
      explanation,
      reference_note,
      source_note,
      status,
      created_by,
      updated_by
    )
    values (
      target_set.exam_pack_id,
      target_set.subject_id,
      target_set.id,
      target_set.set_number,
      requested_position,
      coalesce(item->>'difficulty', 'medium')::public.difficulty_level,
      trim(item->>'question_text'),
      trim(item->>'option_a'),
      trim(item->>'option_b'),
      trim(item->>'option_c'),
      trim(item->>'option_d'),
      upper(trim(item->>'correct_option')),
      trim(coalesce(item->>'explanation', '')),
      trim(coalesce(item->>'reference_note', '')),
      coalesce(nullif(trim(coalesce(item->>'source_note', '')), ''), 'Admin bulk import'),
      case when target_set.status = 'review' then 'review'::public.question_status else 'draft'::public.question_status end,
      auth.uid(),
      auth.uid()
    );

    imported_count := imported_count + 1;
  end loop;

  perform public.admin_write_audit(
    'IMPORT',
    'practice_set',
    target_set.id,
    jsonb_strip_nulls(jsonb_build_object(
      'question_count', imported_count,
      'file_name', nullif(normalized_file_name, ''),
      'file_checksum', nullif(normalized_checksum, '')
    ))
  );

  return jsonb_build_object(
    'imported_count', imported_count,
    'file_checksum', nullif(normalized_checksum, '')
  );
end;
$$;

revoke all on function public.admin_import_questions(uuid, jsonb, text, text) from public, anon;
grant execute on function public.admin_import_questions(uuid, jsonb, text, text) to authenticated;

