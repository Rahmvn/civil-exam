-- Neutralize legacy free-question trial summary fields now that
-- candidate access is batch-based instead of question-count based.

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
    from public.exam_packs as ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  active_entitlement as (
    select e.expires_at
    from public.entitlements as e
    join active_pack as ap on ap.id = e.exam_pack_id
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
    from public.user_module_progress as ump
    join public.subjects as s on s.id = ump.subject_id
    join active_pack as ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  )
  select
    ap.id as pack_id,
    ap.name as pack_name,
    ap.price_kobo,
    ap.currency,
    null::integer as trial_question_limit,
    null::bigint as trial_questions_used,
    exists (select 1 from active_entitlement) as has_paid_access,
    (select ae.expires_at from active_entitlement as ae) as access_expires_at,
    (select fm.subject_id from free_module as fm) as free_module_subject_id,
    (select fm.subject_slug from free_module as fm) as free_module_subject_slug,
    coalesce((select fm.free_first_attempt_completed from free_module as fm), false) as free_first_attempt_completed,
    coalesce((select fm.free_retry_consumed from free_module as fm), false) as free_retry_consumed
  from active_pack as ap;
$$;
