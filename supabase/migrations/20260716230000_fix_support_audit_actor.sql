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

revoke all on function public.update_support_request(uuid, text, text) from public;
grant execute on function public.update_support_request(uuid, text, text) to authenticated;
