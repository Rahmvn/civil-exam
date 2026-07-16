-- Fix: oral module set 1 was incorrectly shown as free/startable for any
-- candidate who had not yet selected a free module. The free-module-until-chosen
-- branch is intentional for objective modules but must not apply to oral modules.
-- Oral modules require an explicit module entitlement (paid access) or an
-- explicitly selected free-access slot to be startable.

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
    -- can_start: only allowed for paid users, or explicit free-access holders on set 1
    case
      when r.published_count = 0 then false
      when r.paid_access then true
      when r.free_access and r.set_number = 1 and r.completed_count = 0 then true
      else false
    end,
    -- state: reflects actual access; removes the unconditional 'available' for unpaid candidates
    case
      when r.published_count = 0 then 'unavailable_not_published'
      when r.completed_count > 0 then 'completed_passed'
      when r.paid_access then 'available'
      when r.free_access and r.set_number = 1 then 'available'
      else 'locked_requires_payment'
    end,
    -- reason_code: unpaid candidates without an explicit free slot always see requires_payment
    case
      when r.published_count = 0 then 'not_published'
      when r.completed_count > 0 and not r.paid_access then 'free_practice_completed'
      when not r.paid_access and not r.free_access then 'requires_payment'
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
    -- message: no longer offers "choose for free" language for oral modules
    case
      when r.published_count = 0 then 'This oral practice set is not available yet.'
      when r.completed_count > 0 and not r.paid_access then 'Your free oral practice is complete. Unlock the module to practise again.'
      when r.paid_access then 'Oral practice is available.'
      when r.free_access and r.set_number = 1 then 'Your free oral practice is available.'
      else 'Unlock this module to continue.'
    end,
    r.set_number = coalesce(r.first_incomplete_set, r.first_published_set, 1),
    r.latest_completed_attempt_id
  from resolved as r
  order by r.sort_order, r.set_number;
$$;

revoke all on function public.get_oral_practice_set_access(text) from public, anon;
grant execute on function public.get_oral_practice_set_access(text) to authenticated;
