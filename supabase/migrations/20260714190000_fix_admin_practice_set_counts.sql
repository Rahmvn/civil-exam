create or replace function public.get_admin_practice_sets(requested_subject_id uuid)
returns table (
  practice_set_id uuid,
  set_number integer,
  status public.practice_set_status,
  expected_question_count integer,
  active_question_count bigint,
  draft_count bigint,
  review_count bigint,
  published_count bigint,
  archived_count bigint,
  attempted_question_count bigint,
  published_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_access();

  return query
  with question_counts as (
    select
      q.practice_set_id,
      count(*) filter (
        where q.status <> 'archived'
          and (q.supersedes_question_id is null or q.status = 'published')
      ) as active_question_count,
      count(*) filter (where q.status = 'draft') as draft_count,
      count(*) filter (where q.status = 'review') as review_count,
      count(*) filter (where q.status = 'published') as published_count,
      count(*) filter (where q.status = 'archived') as archived_count
    from public.questions as q
    group by q.practice_set_id
  ),
  attempted_counts as (
    select
      q.practice_set_id,
      count(distinct aa.question_id) as attempted_question_count
    from public.questions as q
    join public.attempt_answers as aa on aa.question_id = q.id
    group by q.practice_set_id
  )
  select
    ps.id,
    ps.set_number,
    ps.status,
    ps.expected_question_count,
    coalesce(qc.active_question_count, 0),
    coalesce(qc.draft_count, 0),
    coalesce(qc.review_count, 0),
    coalesce(qc.published_count, 0),
    coalesce(qc.archived_count, 0),
    coalesce(ac.attempted_question_count, 0),
    ps.published_at,
    ps.updated_at
  from public.practice_sets as ps
  left join question_counts as qc on qc.practice_set_id = ps.id
  left join attempted_counts as ac on ac.practice_set_id = ps.id
  where ps.subject_id = requested_subject_id
    and ps.exam_pack_id = (
      select ep.id
      from public.exam_packs as ep
      where ep.is_active = true
      order by ep.active_from desc, ep.created_at desc
      limit 1
    )
  order by ps.set_number;
end;
$$;

revoke all on function public.get_admin_practice_sets(uuid) from public, anon;
grant execute on function public.get_admin_practice_sets(uuid) to authenticated;
