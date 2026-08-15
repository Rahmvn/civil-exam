create or replace function public.admin_update_e2_email_campaign(
  requested_campaign_id uuid,
  requested_internal_name text,
  requested_audience_kind text,
  requested_user_ids uuid[] default '{}'::uuid[],
  requested_segment_key text default null,
  requested_segment_params jsonb default '{}'::jsonb,
  requested_category text default 'engagement',
  requested_subject text default null,
  requested_preheader text default null,
  requested_body_text text default null,
  requested_cta_label text default null,
  requested_cta_url text default null,
  requested_template_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  current_campaign public.email_campaigns;
  saved_campaign public.email_campaigns;
  template public.admin_email_templates;
  audience_key text := lower(btrim(coalesce(requested_audience_kind, '')));
  category_key text := lower(btrim(coalesce(requested_category, '')));
  content_changed boolean;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;

  select * into current_campaign from public.email_campaigns
  where id = requested_campaign_id for update;
  if not found or current_campaign.delivery_mode <> 'e1_queue' then raise exception 'Campaign not found'; end if;
  if current_campaign.status not in ('draft', 'tested') then raise exception 'Queued campaign content cannot be edited'; end if;

  if requested_template_id is not null then
    select * into template from public.admin_email_templates
    where id = requested_template_id and active;
    if not found then raise exception 'Choose an active email template'; end if;
    if template.category <> category_key then raise exception 'Template category does not match campaign category'; end if;
  end if;

  perform 1 from private.e2_audience_rows(
    audience_key,
    requested_user_ids,
    requested_segment_key,
    requested_segment_params,
    category_key
  ) limit 1;

  update public.email_campaigns
  set
    internal_name = btrim(requested_internal_name),
    audience_kind = audience_key,
    segment = coalesce(nullif(lower(btrim(requested_segment_key)), ''), audience_key),
    segment_key = nullif(lower(btrim(requested_segment_key)), ''),
    segment_params = coalesce(requested_segment_params, '{}'::jsonb),
    audience_user_ids = case when audience_key = 'segment' then '{}'::uuid[] else coalesce(requested_user_ids, '{}'::uuid[]) end,
    category = category_key,
    priority = case when category_key = 'support' then 2 else 3 end,
    subject = btrim(requested_subject),
    preheader = nullif(btrim(coalesce(requested_preheader, '')), ''),
    body_text = btrim(requested_body_text),
    cta_label = nullif(btrim(coalesce(requested_cta_label, '')), ''),
    cta_url = nullif(btrim(coalesce(requested_cta_url, '')), ''),
    template_id = requested_template_id
  where id = requested_campaign_id
  returning * into saved_campaign;

  content_changed := private.e2_campaign_fingerprint(saved_campaign)
    is distinct from private.e2_campaign_fingerprint(current_campaign);

  if content_changed then
    update public.email_campaigns
    set status = 'draft',
        test_status = 'not_sent',
        tested_fingerprint = null,
        test_provider_message_id = null,
        test_error_message = null,
        tested_at = null,
        tested_by = null
    where id = requested_campaign_id;
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_campaign_updated', 'email_campaign', requested_campaign_id,
    jsonb_build_object(
      'previous_status', current_campaign.status,
      'audience_kind', audience_key,
      'category', category_key,
      'content_changed', content_changed
    ));

  return public.get_admin_email_campaign(requested_campaign_id);
end;
$$;

revoke all on function public.admin_update_e2_email_campaign(uuid, text, text, uuid[], text, jsonb, text, text, text, text, text, text, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.admin_update_e2_email_campaign(uuid, text, text, uuid[], text, jsonb, text, text, text, text, text, text, uuid)
to authenticated;
