-- One-time operator script for the archived set identified in the 2026-07-18
-- read-only inspection. It creates an EMPTY draft and never reopens, edits, or
-- copies the historical version. Run only after both lifecycle migrations.

begin;

do $$
declare
  target_id uuid := '8daee506-14f7-4a62-b7c9-4242518b2d85';
  operator_id uuid := '00000000-0000-0000-0000-000000000000';
  target_set public.practice_sets%rowtype;
  replacement_id uuid;
  next_version integer;
begin
  if operator_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Set operator_id to the trusted administrator running this recovery';
  end if;
  if not exists (
    select 1 from public.profiles where id = operator_id and role = 'admin'
  ) then
    raise exception 'operator_id must identify an administrator';
  end if;

  select * into target_set from public.practice_sets
  where id = target_id for update;
  if not found or target_set.status <> 'archived' then
    raise exception 'Recovery refused: the target is not the expected retired practice set';
  end if;
  if target_set.replaced_by_practice_set_id is not null
     or exists (select 1 from public.practice_sets where replaces_practice_set_id = target_id) then
    raise exception 'Recovery refused: replacement lineage already exists';
  end if;
  if not exists (
    select 1 from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where q.practice_set_id = target_id
  ) then
    raise exception 'Recovery refused: use the zero-history recovery procedure instead';
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

  perform pg_advisory_xact_lock(hashtextextended(target_set.logical_set_key::text, 0));
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.practice_sets where logical_set_key = target_set.logical_set_key;

  insert into public.practice_sets (
    exam_pack_id, subject_id, set_number, expected_question_count, status,
    practice_type, logical_set_key, version_number, replaces_practice_set_id,
    created_by, updated_by
  ) values (
    target_set.exam_pack_id, target_set.subject_id, target_set.set_number,
    target_set.expected_question_count, 'draft', target_set.practice_type,
    target_set.logical_set_key, next_version, target_set.id,
    operator_id, operator_id
  ) returning id into replacement_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    operator_id, 'CREATE_HISTORICAL_REPLACEMENT', 'practice_set', replacement_id,
    jsonb_build_object(
      'old_practice_set_id', target_set.id,
      'replacement_practice_set_id', replacement_id,
      'module_id', target_set.subject_id,
      'set_number', target_set.set_number,
      'version_number', next_version,
      'copied_question_count', 0,
      'reason', 'Corrected replacement for content retired before withdrawal existed'
    )
  );
end $$;

select
  replacement.id,
  replacement.status,
  replacement.version_number,
  replacement.replaces_practice_set_id,
  replacement.expected_question_count
from public.practice_sets replacement
where replacement.replaces_practice_set_id = '8daee506-14f7-4a62-b7c9-4242518b2d85'
order by replacement.version_number desc
limit 1;

-- Inspect the row above. Replace ROLLBACK with COMMIT only in an approved,
-- backed-up operator session after confirming the target and operator IDs.
rollback;
