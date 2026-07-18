-- One-time operator script. This is intentionally outside supabase/migrations.
-- Replace the placeholder only after admin_inspect_retired_practice_sets()
-- reports zero attempts and the checks below have been independently reviewed.

begin;

do $$
declare
  target_id uuid := '00000000-0000-0000-0000-000000000000';
  target_set public.practice_sets%rowtype;
begin
  if target_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Set target_id before running this recovery';
  end if;

  select * into target_set from public.practice_sets
  where id = target_id for update;

  if not found or target_set.status <> 'archived' then
    raise exception 'The target is not a retired practice set';
  end if;
  if exists (select 1 from public.attempts where practice_set_id = target_id)
     or exists (select 1 from public.oral_attempts where practice_set_id = target_id)
     or exists (select 1 from public.objective_practice_sessions where practice_set_id = target_id)
     or exists (
       select 1 from public.attempt_answers aa
       join public.questions q on q.id = aa.question_id
       where q.practice_set_id = target_id
     )
     or exists (
       select 1 from public.oral_responses r
       join public.oral_questions q on q.id = r.question_id
       where q.practice_set_id = target_id
     ) then
    raise exception 'Recovery refused: candidate history references this version';
  end if;
  if target_set.replaces_practice_set_id is not null
     or target_set.replaced_by_practice_set_id is not null
     or exists (select 1 from public.practice_sets where replaces_practice_set_id = target_id) then
    raise exception 'Recovery refused: replacement lineage references this version';
  end if;
  if exists (
    select 1 from public.practice_sets ps
    where ps.id <> target_id
      and ps.exam_pack_id = target_set.exam_pack_id
      and ps.subject_id = target_set.subject_id
      and ps.set_number = target_set.set_number
      and ps.practice_type = target_set.practice_type
      and ps.status in ('draft', 'review', 'published', 'withdrawn')
  ) then
    raise exception 'Recovery refused: another version occupies this logical slot';
  end if;

  if target_set.practice_type = 'oral' then
    update public.oral_questions set status = 'review'
    where practice_set_id = target_id and status = 'archived';
  else
    update public.questions set status = 'review'
    where practice_set_id = target_id and status = 'archived';
  end if;

  update public.practice_sets
  set status = 'review', retired_at = null, archived_at = null,
      retirement_reason = null, updated_at = now()
  where id = target_id;

  insert into public.admin_audit_logs (action, entity_type, entity_id, metadata)
  values ('PRE_REDESIGN_RECOVERY', 'practice_set', target_id,
    jsonb_build_object('previous_status', 'archived', 'new_status', 'review',
      'reason', 'One-time recovery of unused content archived before withdrawal existed'));
end $$;

-- Inspect the changed row, question statuses, and validation result before
-- replacing this rollback with COMMIT in a controlled operator session.
select ps.id, ps.status, ps.set_number, ps.version_number,
  public.admin_get_practice_set_validation_v2(ps.id) as validation
from public.practice_sets ps
where ps.id = '00000000-0000-0000-0000-000000000000';

rollback;
