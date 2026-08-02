create table public.email_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  marketing_opted_out boolean not null default false,
  opted_out_at timestamptz,
  opt_out_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_preferences_opt_out_source_safe check (
    opt_out_source is null
    or char_length(opt_out_source) <= 80
  ),
  constraint email_preferences_opted_out_at_consistent check (
    (marketing_opted_out = false and opted_out_at is null)
    or (marketing_opted_out = true and opted_out_at is not null)
  )
);

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_type text not null,
  segment text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'draft',
  test_recipient_email text,
  tested_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_campaigns_type_check check (
    campaign_type in ('payment_started_support_checkin')
  ),
  constraint email_campaigns_segment_check check (
    segment in ('payment_started_unpaid')
  ),
  constraint email_campaigns_status_check check (
    status in ('draft', 'tested', 'sending', 'sent', 'cancelled')
  ),
  constraint email_campaigns_subject_safe check (
    btrim(subject) <> ''
    and char_length(subject) <= 160
  ),
  constraint email_campaigns_body_safe check (
    btrim(body_text) <> ''
    and char_length(body_text) <= 3000
  ),
  constraint email_campaigns_test_email_safe check (
    test_recipient_email is null
    or (
      char_length(test_recipient_email) <= 254
      and test_recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    )
  )
);

create table public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  recipient_email text not null,
  recipient_name text,
  status text not null default 'pending',
  provider text,
  provider_message_id text,
  error_message text,
  skipped_reason text,
  sent_at timestamptz,
  attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint email_campaign_recipients_status_check check (
    status in ('pending', 'sent', 'failed', 'skipped')
  ),
  constraint email_campaign_recipients_email_safe check (
    char_length(recipient_email) <= 254
    and recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  constraint email_campaign_recipients_name_safe check (
    recipient_name is null
    or char_length(recipient_name) <= 120
  ),
  unique (campaign_id, user_id),
  unique (campaign_id, recipient_email)
);

create index email_campaigns_status_created_idx
on public.email_campaigns (status, created_at desc);

create index email_campaign_recipients_campaign_status_idx
on public.email_campaign_recipients (campaign_id, status, created_at);

create trigger email_preferences_touch_updated_at
before update on public.email_preferences
for each row execute function public.touch_updated_at();

create trigger email_campaigns_touch_updated_at
before update on public.email_campaigns
for each row execute function public.touch_updated_at();

create trigger email_campaign_recipients_touch_updated_at
before update on public.email_campaign_recipients
for each row execute function public.touch_updated_at();

alter table public.email_preferences enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;

revoke all on table public.email_preferences from public, anon, authenticated;
revoke all on table public.email_campaigns from public, anon, authenticated;
revoke all on table public.email_campaign_recipients from public, anon, authenticated;

grant select, insert, update on table public.email_preferences to service_role;
grant select, insert, update on table public.email_campaigns to service_role;
grant select, insert, update on table public.email_campaign_recipients to service_role;

create or replace function public.admin_email_campaign_default_copy(
  requested_campaign_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := lower(btrim(coalesce(requested_campaign_type, '')));
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_type <> 'payment_started_support_checkin' then
    raise exception 'Choose a valid campaign type';
  end if;

  return jsonb_build_object(
    'subject', 'Any issue with your PromotionSure payment?',
    'body_text', concat_ws(E'\n',
      'Hi {{first_name}},',
      '',
      'We noticed your PromotionSure payment was not completed.',
      '',
      'If there was any issue with payment, network, pricing, or access, kindly reply to this email so we can assist.',
      '',
      'Thank you.',
      '',
      'PromotionSure Team'
    )
  );
end;
$$;

create or replace function public.admin_email_campaign_segment_recipients(
  requested_segment text
)
returns table (
  user_id uuid,
  recipient_email text,
  recipient_name text,
  last_checkout_at timestamptz,
  last_provider_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_segment text := lower(btrim(coalesce(requested_segment, '')));
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_segment <> 'payment_started_unpaid' then
    raise exception 'Choose a valid campaign segment';
  end if;

  return query
  select
    p.id,
    p.email,
    p.full_name,
    payment.last_checkout_at,
    payment.last_provider_status
  from public.profiles p
  join lateral (
    select
      count(*) filter (
        where po.status = 'active'
           or po.provider_status = 'success'
      )::integer as successful_payment_count,
      count(*) filter (
        where po.status = 'pending'
          and coalesce(po.provider_status, 'pending') in (
            'initializing',
            'initialized',
            'ongoing',
            'pending',
            'processing',
            'queued'
          )
      )::integer as pending_payment_count,
      max(po.created_at) as last_checkout_at,
      (array_agg(coalesce(po.provider_status, po.status::text) order by po.created_at desc))[1] as last_provider_status
    from public.payment_orders po
    where po.user_id = p.id
  ) payment on true
  left join lateral (
    select count(*)::integer as active_module_count
    from public.module_entitlements me
    where me.user_id = p.id
      and me.status = 'active'
      and me.expires_at > now()
  ) access on true
  left join public.email_preferences pref on pref.user_id = p.id
  where p.role = 'candidate'
    and p.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and coalesce(pref.marketing_opted_out, false) = false
    and coalesce(payment.pending_payment_count, 0) > 0
    and coalesce(payment.successful_payment_count, 0) = 0
    and coalesce(access.active_module_count, 0) = 0
  order by payment.last_checkout_at desc nulls last, p.created_at desc, p.id;
end;
$$;

create or replace function public.admin_create_email_campaign(
  requested_campaign_type text,
  requested_segment text,
  requested_subject text default null,
  requested_body_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_type text := lower(btrim(coalesce(requested_campaign_type, '')));
  v_segment text := lower(btrim(coalesce(requested_segment, '')));
  v_default_copy jsonb;
  v_subject text;
  v_body text;
  v_campaign_id uuid;
  v_recipient_count integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_type <> 'payment_started_support_checkin' then
    raise exception 'Choose a valid campaign type';
  end if;

  if v_segment <> 'payment_started_unpaid' then
    raise exception 'Choose a valid campaign segment';
  end if;

  v_default_copy := public.admin_email_campaign_default_copy(v_type);
  v_subject := btrim(coalesce(requested_subject, v_default_copy->>'subject'));
  v_body := btrim(coalesce(requested_body_text, v_default_copy->>'body_text'));

  if v_subject = '' or char_length(v_subject) > 160 then
    raise exception 'Campaign subject is invalid';
  end if;

  if v_body = '' or char_length(v_body) > 3000 then
    raise exception 'Campaign body is invalid';
  end if;

  insert into public.email_campaigns (
    campaign_type,
    segment,
    subject,
    body_text,
    created_by
  )
  values (
    v_type,
    v_segment,
    v_subject,
    v_body,
    v_admin_id
  )
  returning id into v_campaign_id;

  insert into public.email_campaign_recipients (
    campaign_id,
    user_id,
    recipient_email,
    recipient_name,
    metadata
  )
  select
    v_campaign_id,
    recipients.user_id,
    recipients.recipient_email,
    recipients.recipient_name,
    jsonb_build_object(
      'last_checkout_at', recipients.last_checkout_at,
      'last_provider_status', recipients.last_provider_status
    )
  from public.admin_email_campaign_segment_recipients(v_segment) recipients;

  get diagnostics v_recipient_count = row_count;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_admin_id,
    'email_campaign_created',
    'email_campaign',
    v_campaign_id,
    jsonb_build_object(
      'campaign_type', v_type,
      'segment', v_segment,
      'recipient_count', v_recipient_count
    )
  );

  return public.get_admin_email_campaign(v_campaign_id);
end;
$$;

create or replace function public.admin_cancel_email_campaign(
  requested_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.email_campaigns%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  select *
  into v_campaign
  from public.email_campaigns
  where id = requested_campaign_id
  for update;

  if not found then
    raise exception 'Campaign not found';
  end if;

  if v_campaign.status in ('sending', 'sent') then
    raise exception 'This campaign can no longer be cancelled';
  end if;

  update public.email_campaigns
  set status = 'cancelled',
      cancelled_at = now()
  where id = requested_campaign_id;

  update public.email_campaign_recipients
  set status = 'skipped',
      skipped_reason = 'Campaign cancelled'
  where campaign_id = requested_campaign_id
    and status = 'pending';

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'email_campaign_cancelled',
    'email_campaign',
    requested_campaign_id,
    jsonb_build_object('previous_status', v_campaign.status)
  );

  return public.get_admin_email_campaign(requested_campaign_id);
end;
$$;

create or replace function public.get_admin_email_campaign(
  requested_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign jsonb;
  v_recipients jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  select to_jsonb(campaign)
  into v_campaign
  from (
    select
      ec.id,
      ec.campaign_type,
      ec.segment,
      ec.subject,
      ec.body_text,
      ec.status,
      ec.test_recipient_email,
      ec.tested_at,
      ec.sent_at,
      ec.cancelled_at,
      ec.created_by,
      p.email as created_by_email,
      ec.created_at,
      ec.updated_at
    from public.email_campaigns ec
    left join public.profiles p on p.id = ec.created_by
    where ec.id = requested_campaign_id
  ) campaign;

  if v_campaign is null then
    raise exception 'Campaign not found';
  end if;

  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'sent', count(*) filter (where status = 'sent'),
    'failed', count(*) filter (where status = 'failed'),
    'skipped', count(*) filter (where status = 'skipped'),
    'all', count(*)
  )
  into v_counts
  from public.email_campaign_recipients
  where campaign_id = requested_campaign_id;

  select coalesce(jsonb_agg(to_jsonb(recipient_row)), '[]'::jsonb)
  into v_recipients
  from (
    select
      id,
      user_id,
      recipient_email,
      recipient_name,
      status,
      provider,
      provider_message_id,
      error_message,
      skipped_reason,
      attempted_at,
      sent_at,
      created_at,
      updated_at,
      metadata
    from public.email_campaign_recipients
    where campaign_id = requested_campaign_id
    order by
      case status when 'failed' then 1 when 'pending' then 2 when 'skipped' then 3 else 4 end,
      created_at,
      id
    limit 100
  ) recipient_row;

  return v_campaign || jsonb_build_object(
    'counts', v_counts,
    'recipients', v_recipients
  );
end;
$$;

create or replace function public.get_admin_email_campaigns(
  requested_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(5, least(coalesce(requested_limit, 20), 50));
  v_items jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(campaign_row)), '[]'::jsonb)
  into v_items
  from (
    select
      ec.id,
      ec.campaign_type,
      ec.segment,
      ec.subject,
      ec.status,
      ec.tested_at,
      ec.sent_at,
      ec.cancelled_at,
      ec.created_at,
      jsonb_build_object(
        'pending', count(ecr.id) filter (where ecr.status = 'pending'),
        'sent', count(ecr.id) filter (where ecr.status = 'sent'),
        'failed', count(ecr.id) filter (where ecr.status = 'failed'),
        'skipped', count(ecr.id) filter (where ecr.status = 'skipped'),
        'all', count(ecr.id)
      ) as counts
    from public.email_campaigns ec
    left join public.email_campaign_recipients ecr on ecr.campaign_id = ec.id
    group by ec.id
    order by ec.created_at desc, ec.id
    limit v_limit
  ) campaign_row;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.admin_email_campaign_default_copy(text)
from public, anon, authenticated, service_role;
revoke all on function public.admin_email_campaign_segment_recipients(text)
from public, anon, authenticated, service_role;
revoke all on function public.admin_create_email_campaign(text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.admin_cancel_email_campaign(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_admin_email_campaign(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_admin_email_campaigns(integer)
from public, anon, authenticated, service_role;

grant execute on function public.admin_email_campaign_default_copy(text)
to authenticated;
grant execute on function public.admin_email_campaign_segment_recipients(text)
to authenticated;
grant execute on function public.admin_create_email_campaign(text, text, text, text)
to authenticated;
grant execute on function public.admin_cancel_email_campaign(uuid)
to authenticated;
grant execute on function public.get_admin_email_campaign(uuid)
to authenticated;
grant execute on function public.get_admin_email_campaigns(integer)
to authenticated;
