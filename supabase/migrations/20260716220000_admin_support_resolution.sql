create or replace function public.get_admin_support_requests(requested_limit integer default 100)
returns table (
  id uuid,
  user_id uuid,
  requester_name text,
  requester_email text,
  category text,
  subject text,
  description text,
  payment_reference text,
  page_path text,
  status text,
  resolution_note text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  return query
  select
    sr.id,
    sr.user_id,
    p.full_name,
    p.email,
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
  order by
    case sr.status when 'received' then 1 when 'in_review' then 2 when 'resolved' then 3 else 4 end,
    sr.created_at asc
  limit greatest(1, least(coalesce(requested_limit, 100), 200));
end;
$$;

create or replace function public.update_support_request(
  requested_id uuid,
  requested_status text,
  requested_resolution_note text default null
)
returns public.support_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.support_requests;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if requested_status not in ('received', 'in_review', 'resolved', 'closed') then
    raise exception 'Choose a valid support status';
  end if;

  if requested_status in ('resolved', 'closed')
    and char_length(btrim(coalesce(requested_resolution_note, ''))) < 5 then
    raise exception 'Add a resolution note before closing this request';
  end if;

  update public.support_requests
  set status = requested_status,
      resolution_note = nullif(btrim(coalesce(requested_resolution_note, '')), ''),
      updated_at = now()
  where id = requested_id
  returning * into v_request;

  if v_request.id is null then
    raise exception 'Support request not found';
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'UPDATE',
    'support_request',
    v_request.id,
    jsonb_build_object('status', requested_status, 'category', v_request.category)
  );

  return v_request;
end;
$$;

revoke all on function public.get_admin_support_requests(integer) from public;
revoke all on function public.update_support_request(uuid, text, text) from public;
grant execute on function public.get_admin_support_requests(integer) to authenticated;
grant execute on function public.update_support_request(uuid, text, text) to authenticated;
