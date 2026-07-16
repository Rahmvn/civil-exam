-- Fix: get_module_access_catalog returned 0 for published_batch_count for 
-- oral modules because it only joined public.questions (objective questions). 
-- This updates the published CTE to count distinct sets from both objective 
-- and oral question banks.

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
  published as (
    select subject_id, sum(batch_count)::integer as batch_count
    from (
      select q.subject_id, count(distinct q.batch_number)::integer as batch_count
      from public.questions as q
      join active_pack as ap on ap.id = q.exam_pack_id
      where q.status = 'published'
      group by q.subject_id
      union all
      select oq.subject_id, count(distinct ps.set_number)::integer as batch_count
      from public.oral_questions as oq
      join public.practice_sets as ps on ps.id = oq.practice_set_id
      join active_pack as ap on ap.id = oq.exam_pack_id
      where oq.status = 'published'
      group by oq.subject_id
    ) unified
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

grant execute on function public.get_module_access_catalog() to authenticated;
