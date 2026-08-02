create or replace function public.admin_update_email_campaign_copy(
  requested_campaign_id uuid,
  requested_subject text,
  requested_body_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.email_campaigns%rowtype;
  v_subject text := btrim(coalesce(requested_subject, ''));
  v_body text := btrim(coalesce(requested_body_text, ''));
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_subject = '' or char_length(v_subject) > 160 then
    raise exception 'Campaign subject is invalid';
  end if;

  if v_body = '' or char_length(v_body) > 3000 then
    raise exception 'Campaign body is invalid';
  end if;

  select *
  into v_campaign
  from public.email_campaigns
  where id = requested_campaign_id
  for update;

  if not found then
    raise exception 'Campaign not found';
  end if;

  if v_campaign.status not in ('draft', 'tested') then
    raise exception 'Only draft campaigns can be edited';
  end if;

  update public.email_campaigns
  set subject = v_subject,
      body_text = v_body,
      status = 'draft',
      tested_at = null,
      test_recipient_email = null
  where id = requested_campaign_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'email_campaign_copy_updated',
    'email_campaign',
    requested_campaign_id,
    jsonb_build_object(
      'previous_status', v_campaign.status,
      'segment', v_campaign.segment,
      'campaign_type', v_campaign.campaign_type
    )
  );

  return public.get_admin_email_campaign(requested_campaign_id);
end;
$$;

revoke all on function public.admin_update_email_campaign_copy(uuid, text, text)
from public, anon, authenticated, service_role;

grant execute on function public.admin_update_email_campaign_copy(uuid, text, text)
to authenticated;
