-- Reapply the history-preserving removal path for databases that recorded an
-- earlier version of the original migration before its function was corrected.

create or replace function public.admin_delete_draft_question(requested_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_question public.questions%rowtype;
  target_set_status public.practice_set_status;
  preserve_history boolean;
begin
  perform public.admin_assert_access();

  select * into target_question
  from public.questions
  where id = requested_question_id
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  if target_question.status not in ('draft', 'review') then
    raise exception 'Only a draft or review question can be removed directly';
  end if;

  select ps.status into target_set_status
  from public.practice_sets as ps
  where ps.id = target_question.practice_set_id
  for update;

  select
    exists (
      select 1
      from public.attempt_answers as aa
      where aa.question_id = target_question.id
    )
    or exists (
      select 1
      from public.questions as revision
      where revision.supersedes_question_id = target_question.id
    )
  into preserve_history;

  if preserve_history then
    update public.questions
    set status = 'archived', updated_by = auth.uid()
    where id = target_question.id;

    -- The status trigger may archive an otherwise empty set. Keep an editable
    -- set in the lifecycle state it had before the question was removed.
    update public.practice_sets
    set status = target_set_status,
        archived_at = case when target_set_status = 'archived' then archived_at else null end,
        updated_by = auth.uid()
    where id = target_question.practice_set_id;

    perform public.admin_write_audit(
      'ARCHIVE',
      'question',
      target_question.id,
      jsonb_build_object(
        'practice_set_id', target_question.practice_set_id,
        'batch_position', target_question.batch_position,
        'previous_status', target_question.status,
        'reason', 'historical_attempt_or_revision'
      )
    );
  else
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
  end if;

  return true;
end;
$$;

revoke all on function public.admin_delete_draft_question(uuid) from public, anon;
grant execute on function public.admin_delete_draft_question(uuid) to authenticated;
