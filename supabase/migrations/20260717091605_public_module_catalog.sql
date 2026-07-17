-- Expose only the module names and lifecycle state needed by the public
-- landing page. Candidate access, pricing, and content remain private.
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
    select ps.subject_id
    from public.practice_sets as ps
    join active_pack as ap on ap.id = ps.exam_pack_id
    where ps.status = 'published'
      and ps.practice_type = 'objective'
      and exists (
        select 1
        from public.questions as q
        where q.exam_pack_id = ps.exam_pack_id
          and q.subject_id = ps.subject_id
          and q.batch_number = ps.set_number
          and q.status = 'published'
      )
    union
    select ps.subject_id
    from public.practice_sets as ps
    join active_pack as ap on ap.id = ps.exam_pack_id
    where ps.status = 'published'
      and ps.practice_type = 'oral'
      and exists (
        select 1
        from public.oral_questions as oq
        where oq.exam_pack_id = ps.exam_pack_id
          and oq.subject_id = ps.subject_id
          and oq.practice_set_id = ps.id
          and oq.status = 'published'
      )
  )
  select
    s.name,
    s.slug,
    s.practice_type::text,
    case
      when s.lifecycle_status = 'coming_soon' then 'coming_soon'
      else 'available'
    end,
    s.sort_order
  from public.subjects as s
  cross join active_pack as ap
  left join published_subjects as published on published.subject_id = s.id
  where s.is_active = true
    and (
      s.lifecycle_status = 'coming_soon'
      or (s.lifecycle_status = 'active' and published.subject_id is not null)
    )
  order by s.sort_order, s.name;
$$;

revoke all on function public.get_public_module_catalog() from public;
grant execute on function public.get_public_module_catalog() to anon, authenticated;
