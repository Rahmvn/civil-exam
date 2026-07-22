create or replace function public.get_admin_support_queue(
  requested_status text default 'open',
  requested_query text default null,
  requested_limit integer default 25,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(requested_status, 'open')));
  v_query text := nullif(btrim(coalesce(requested_query, '')), '');
  v_limit integer := greatest(10, least(coalesce(requested_limit, 25), 50));
  v_offset integer := greatest(0, coalesce(requested_offset, 0));
  v_total integer;
  v_items jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_status not in ('all', 'open', 'received', 'in_review', 'resolved', 'closed') then
    raise exception 'Choose a valid support status';
  end if;

  if char_length(coalesce(v_query, '')) > 120 then
    raise exception 'Support search is too long';
  end if;

  select jsonb_build_object(
    'open', count(*) filter (where sr.status in ('received', 'in_review')),
    'received', count(*) filter (where sr.status = 'received'),
    'in_review', count(*) filter (where sr.status = 'in_review'),
    'resolved', count(*) filter (where sr.status = 'resolved'),
    'closed', count(*) filter (where sr.status = 'closed'),
    'all', count(*)
  )
  into v_counts
  from public.support_requests sr;

  select count(*)::integer
  into v_total
  from public.support_requests sr
  left join public.profiles p on p.id = sr.user_id
  where (
    v_status = 'all'
    or (v_status = 'open' and sr.status in ('received', 'in_review'))
    or sr.status = v_status
  )
  and (
    v_query is null
    or concat_ws(' ', sr.subject, sr.description, p.full_name, p.email, sr.payment_reference)
      ilike '%' || v_query || '%'
  );

  select coalesce(jsonb_agg(to_jsonb(queue_row)), '[]'::jsonb)
  into v_items
  from (
    select
      sr.id,
      sr.user_id,
      p.full_name as requester_name,
      p.email as requester_email,
      sr.category,
      sr.subject,
      sr.description,
      sr.payment_reference,
      sr.page_path,
      sr.status,
      sr.resolution_note,
      sr.created_at,
      sr.updated_at
    from public.support_requests sr
    left join public.profiles p on p.id = sr.user_id
    where (
      v_status = 'all'
      or (v_status = 'open' and sr.status in ('received', 'in_review'))
      or sr.status = v_status
    )
    and (
      v_query is null
      or concat_ws(' ', sr.subject, sr.description, p.full_name, p.email, sr.payment_reference)
        ilike '%' || v_query || '%'
    )
    order by
      case sr.status when 'received' then 1 when 'in_review' then 2 when 'resolved' then 3 else 4 end,
      case when sr.status in ('received', 'in_review') then sr.created_at end asc,
      case when sr.status in ('resolved', 'closed') then sr.updated_at end desc,
      sr.id
    limit v_limit
    offset v_offset
  ) queue_row;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'counts', v_counts,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_offset + jsonb_array_length(v_items) < v_total
  );
end;
$$;

revoke all on function public.get_admin_support_queue(text, text, integer, integer) from public;
grant execute on function public.get_admin_support_queue(text, text, integer, integer) to authenticated;
