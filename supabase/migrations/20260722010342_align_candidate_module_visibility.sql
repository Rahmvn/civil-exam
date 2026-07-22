-- Candidate visibility and purchase authority must follow the explicit
-- availability controls introduced by the content-lifecycle redesign.
create or replace function public.get_public_module_catalog()
returns table (
  name text,
  slug text,
  practice_type text,
  availability_status text,
  sort_order integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with active_pack as (
    select ep.id
    from public.exam_packs as ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  published_subjects as (
    select distinct ps.subject_id
    from public.practice_sets as ps
    join active_pack as ap on ap.id = ps.exam_pack_id
    where ps.status = 'published'
      and (
        exists (
          select 1
          from public.questions as q
          where q.practice_set_id = ps.id
            and q.status = 'published'
        )
        or exists (
          select 1
          from public.oral_questions as oq
          where oq.practice_set_id = ps.id
            and oq.status = 'published'
        )
      )
  )
  select
    s.name,
    s.slug,
    s.practice_type::text,
    s.candidate_availability::text,
    s.sort_order
  from public.subjects as s
  cross join active_pack as ap
  left join published_subjects as published on published.subject_id = s.id
  where s.is_active = true
    and s.lifecycle_status not in ('draft', 'retired')
    and s.candidate_availability in ('available', 'coming_soon', 'paused')
    and (
      s.candidate_availability in ('coming_soon', 'paused')
      or published.subject_id is not null
    )
  order by s.sort_order, s.name;
$$;

revoke all on function public.get_public_module_catalog() from public;
grant execute on function public.get_public_module_catalog() to anon, authenticated;

create or replace function public.get_module_access_catalog()
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
set search_path = public, pg_temp
as $$
  with active_pack as (
    select ep.*
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  legacy_access as (
    select max(e.expires_at) as expires_at
    from public.entitlements e
    join active_pack ap on ap.id = e.exam_pack_id
    where e.user_id = auth.uid()
      and e.status = 'active'
      and e.expires_at > now()
  ),
  module_access as (
    select me.subject_id, max(me.expires_at) as expires_at
    from public.module_entitlements me
    join active_pack ap on ap.id = me.exam_pack_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.expires_at > now()
    group by me.subject_id
  ),
  free_module as (
    select ump.subject_id
    from public.user_module_progress ump
    join active_pack ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  ),
  published as (
    select ps.subject_id, count(*)::integer as batch_count
    from public.practice_sets ps
    join active_pack ap on ap.id = ps.exam_pack_id
    where ps.status = 'published'
      and (
        exists (
          select 1 from public.questions q
          where q.practice_set_id = ps.id and q.status = 'published'
        )
        or exists (
          select 1 from public.oral_questions oq
          where oq.practice_set_id = ps.id and oq.status = 'published'
        )
      )
    group by ps.subject_id
  )
  select
    s.id,
    s.name,
    s.slug,
    s.practice_type,
    s.lifecycle_status,
    s.candidate_availability,
    mo.id,
    mo.price_kobo,
    mo.currency,
    coalesce(mo.is_active, false)
      and s.lifecycle_status = 'active'
      and s.candidate_availability = 'available'
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

revoke all on function public.get_module_access_catalog() from public, anon;
grant execute on function public.get_module_access_catalog() to authenticated;
