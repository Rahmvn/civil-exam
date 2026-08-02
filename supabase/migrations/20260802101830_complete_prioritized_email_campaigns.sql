alter table public.email_campaigns
  drop constraint email_campaigns_type_check,
  drop constraint email_campaigns_segment_check;

alter table public.email_campaigns
  add column priority smallint not null default 3,
  add constraint email_campaigns_type_check check (
    campaign_type in (
      'payment_started_support_checkin',
      'practice_support_checkin',
      'getting_started_support_checkin'
    )
  ),
  add constraint email_campaigns_segment_check check (
    segment in (
      'payment_started_unpaid',
      'practiced_unpaid_no_checkout',
      'not_started_unpaid'
    )
  ),
  add constraint email_campaigns_priority_check check (priority between 1 and 3);

update public.email_campaigns
set priority = case campaign_type
  when 'payment_started_support_checkin' then 1
  when 'practice_support_checkin' then 2
  else 3
end;

alter table public.email_campaign_recipients
  add column included boolean not null default true;

create unique index email_campaigns_one_active_idx
on public.email_campaigns ((1))
where status in ('draft', 'tested', 'sending');

create index email_campaigns_type_sent_idx
on public.email_campaigns (campaign_type, sent_at desc)
where status = 'sent';

create index email_campaign_recipients_campaign_included_status_idx
on public.email_campaign_recipients (campaign_id, included, status, created_at);

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

  case v_type
    when 'payment_started_support_checkin' then
      return jsonb_build_object(
        'subject', 'Can we help with your PromotionSure payment?',
        'body_text', concat_ws(E'\n',
          'Hi {{first_name}},',
          '',
          'We noticed you started a payment on PromotionSure but did not complete it.',
          '',
          'If anything got in the way, reply to this email and we will help.',
          '',
          'PromotionSure Team'
        )
      );
    when 'practice_support_checkin' then
      return jsonb_build_object(
        'subject', 'How is your PromotionSure practice going?',
        'body_text', concat_ws(E'\n',
          'Hi {{first_name}},',
          '',
          'You have started practising on PromotionSure. We would like to know how the experience has been so far.',
          '',
          'If you ran into any difficulty or have a question, reply to this email and we will help.',
          '',
          'PromotionSure Team'
        )
      );
    when 'getting_started_support_checkin' then
      return jsonb_build_object(
        'subject', 'Need help getting started on PromotionSure?',
        'body_text', concat_ws(E'\n',
          'Hi {{first_name}},',
          '',
          'Your PromotionSure account is ready.',
          '',
          'If you would like help choosing a module or starting your first practice, reply to this email and we will help.',
          '',
          'PromotionSure Team'
        )
      );
    else
      raise exception 'Choose a valid campaign type';
  end case;
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
  v_campaign_type text;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  v_campaign_type := case v_segment
    when 'payment_started_unpaid' then 'payment_started_support_checkin'
    when 'practiced_unpaid_no_checkout' then 'practice_support_checkin'
    when 'not_started_unpaid' then 'getting_started_support_checkin'
    else null
  end;

  if v_campaign_type is null then
    raise exception 'Choose a valid campaign segment';
  end if;

  return query
  with objective_practice as (
    select a.user_id, count(*)::integer as attempt_count,
      max(coalesce(a.completed_at, a.started_at)) as last_practice_at
    from public.attempts a
    group by a.user_id
  ),
  oral_practice as (
    select oa.user_id, count(*)::integer as attempt_count,
      max(coalesce(oa.completed_at, oa.updated_at, oa.started_at)) as last_practice_at
    from public.oral_attempts oa
    group by oa.user_id
  ),
  payment_summary as (
    select
      po.user_id,
      count(*) filter (
        where po.status = 'active' or po.provider_status = 'success'
      )::integer as successful_payment_count,
      count(*) filter (
        where po.status = 'pending'
          and coalesce(po.provider_status, 'pending') in (
            'initializing', 'initialized', 'ongoing', 'pending',
            'processing', 'queued'
          )
      )::integer as pending_payment_count,
      max(po.created_at) as last_checkout_at,
      (array_agg(coalesce(po.provider_status, po.status::text)
        order by po.created_at desc))[1] as last_provider_status
    from public.payment_orders po
    group by po.user_id
  ),
  access_summary as (
    select me.user_id, count(*)::integer as active_module_count
    from public.module_entitlements me
    where me.status = 'active' and me.expires_at > now()
    group by me.user_id
  ),
  candidates as (
    select
      p.id,
      lower(p.email) as email,
      p.full_name,
      p.created_at,
      coalesce(op.attempt_count, 0) + coalesce(orp.attempt_count, 0) as attempt_count,
      greatest(op.last_practice_at, orp.last_practice_at) as last_practice_at,
      coalesce(ps.successful_payment_count, 0) as successful_payment_count,
      coalesce(ps.pending_payment_count, 0) as pending_payment_count,
      ps.last_checkout_at,
      ps.last_provider_status,
      coalesce(a.active_module_count, 0) as active_module_count
    from public.profiles p
    left join objective_practice op on op.user_id = p.id
    left join oral_practice orp on orp.user_id = p.id
    left join payment_summary ps on ps.user_id = p.id
    left join access_summary a on a.user_id = p.id
    left join public.email_preferences pref on pref.user_id = p.id
    where p.role = 'candidate'
      and p.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      and p.email !~* '@promotionsure\.com\.ng$'
      and coalesce(pref.marketing_opted_out, false) = false
      and coalesce(ps.successful_payment_count, 0) = 0
      and coalesce(a.active_module_count, 0) = 0
      and not exists (
        select 1
        from public.email_campaign_recipients previous_recipient
        join public.email_campaigns previous_campaign
          on previous_campaign.id = previous_recipient.campaign_id
        where previous_recipient.user_id = p.id
          and previous_recipient.status = 'sent'
          and previous_campaign.campaign_type = v_campaign_type
          and previous_recipient.sent_at > now() - interval '14 days'
      )
  )
  select
    c.id,
    c.email,
    c.full_name,
    c.last_checkout_at,
    c.last_provider_status
  from candidates c
  where (
    v_segment = 'payment_started_unpaid'
    and c.pending_payment_count > 0
    and c.last_checkout_at between now() - interval '30 days' and now() - interval '30 minutes'
  ) or (
    v_segment = 'practiced_unpaid_no_checkout'
    and c.attempt_count > 0
    and c.pending_payment_count = 0
    and c.last_practice_at >= now() - interval '30 days'
  ) or (
    v_segment = 'not_started_unpaid'
    and c.attempt_count = 0
    and c.pending_payment_count = 0
    and c.created_at between now() - interval '30 days' and now() - interval '24 hours'
  )
  order by
    case v_segment
      when 'payment_started_unpaid' then c.last_checkout_at
      when 'practiced_unpaid_no_checkout' then c.last_practice_at
      else c.created_at
    end desc nulls last,
    c.id;
end;
$$;

create or replace function public.get_admin_email_campaign_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  select jsonb_agg(to_jsonb(item_row) order by item_row.priority)
  into v_items
  from (
    select
      values_row.campaign_type,
      values_row.segment,
      values_row.priority,
      values_row.title,
      values_row.description,
      (select count(*)::integer
       from public.admin_email_campaign_segment_recipients(values_row.segment)) as recipient_count,
      public.admin_email_campaign_default_copy(values_row.campaign_type)->>'subject' as default_subject,
      public.admin_email_campaign_default_copy(values_row.campaign_type)->>'body_text' as default_body_text
    from (values
      (
        'payment_started_support_checkin'::text,
        'payment_started_unpaid'::text,
        1::smallint,
        'Payment check-in'::text,
        'Started checkout, still unpaid after 30 minutes.'::text
      ),
      (
        'practice_support_checkin'::text,
        'practiced_unpaid_no_checkout'::text,
        2::smallint,
        'Practice check-in'::text,
        'Practised recently, with no payment attempt.'::text
      ),
      (
        'getting_started_support_checkin'::text,
        'not_started_unpaid'::text,
        3::smallint,
        'Getting started'::text,
        'Joined over a day ago and has not practised.'::text
      )
    ) as values_row(campaign_type, segment, priority, title, description)
  ) item_row;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
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
  v_expected_segment text;
  v_priority smallint;
  v_default_copy jsonb;
  v_subject text;
  v_body text;
  v_campaign_id uuid;
  v_recipient_count integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  select mapping.segment, mapping.priority
  into v_expected_segment, v_priority
  from (values
    ('payment_started_support_checkin'::text, 'payment_started_unpaid'::text, 1::smallint),
    ('practice_support_checkin'::text, 'practiced_unpaid_no_checkout'::text, 2::smallint),
    ('getting_started_support_checkin'::text, 'not_started_unpaid'::text, 3::smallint)
  ) as mapping(campaign_type, segment, priority)
  where mapping.campaign_type = v_type;

  if v_expected_segment is null or v_segment <> v_expected_segment then
    raise exception 'Choose a valid campaign scenario';
  end if;

  if exists (
    select 1 from public.email_campaigns
    where status in ('draft', 'tested', 'sending')
  ) then
    raise exception 'Finish or cancel the current campaign before creating another';
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
    campaign_type, segment, priority, subject, body_text, created_by
  ) values (
    v_type, v_segment, v_priority, v_subject, v_body, v_admin_id
  ) returning id into v_campaign_id;

  insert into public.email_campaign_recipients (
    campaign_id, user_id, recipient_email, recipient_name, metadata
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
  if v_recipient_count = 0 then
    raise exception 'There are no eligible recipients for this campaign';
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_admin_id,
    'email_campaign_created',
    'email_campaign',
    v_campaign_id,
    jsonb_build_object(
      'campaign_type', v_type,
      'segment', v_segment,
      'priority', v_priority,
      'recipient_count', v_recipient_count
    )
  );

  return public.get_admin_email_campaign(v_campaign_id);
end;
$$;

create or replace function public.admin_set_email_campaign_recipient_included(
  requested_campaign_id uuid,
  requested_recipient_id uuid,
  requested_included boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign_status text;
  v_updated integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  select status into v_campaign_status
  from public.email_campaigns
  where id = requested_campaign_id
  for update;

  if not found then
    raise exception 'Campaign not found';
  end if;
  if v_campaign_status not in ('draft', 'tested') then
    raise exception 'Recipients cannot be changed while this campaign is sending';
  end if;

  update public.email_campaign_recipients
  set included = coalesce(requested_included, false)
  where id = requested_recipient_id
    and campaign_id = requested_campaign_id
    and status in ('pending', 'failed');

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'This recipient can no longer be changed';
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'email_campaign_recipient_selection_updated',
    'email_campaign',
    requested_campaign_id,
    jsonb_build_object(
      'recipient_id', requested_recipient_id,
      'included', coalesce(requested_included, false)
    )
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
      ec.id, ec.campaign_type, ec.segment, ec.priority, ec.subject,
      ec.body_text, ec.status, ec.test_recipient_email, ec.tested_at,
      ec.sent_at, ec.cancelled_at, ec.created_by,
      p.email as created_by_email, ec.created_at, ec.updated_at
    from public.email_campaigns ec
    left join public.profiles p on p.id = ec.created_by
    where ec.id = requested_campaign_id
  ) campaign;

  if v_campaign is null then
    raise exception 'Campaign not found';
  end if;

  select jsonb_build_object(
    'selected', count(*) filter (where included),
    'excluded', count(*) filter (where not included),
    'pending', count(*) filter (where included and status = 'pending'),
    'sent', count(*) filter (where included and status = 'sent'),
    'failed', count(*) filter (where included and status = 'failed'),
    'skipped', count(*) filter (where status = 'skipped'),
    'all', count(*)
  ) into v_counts
  from public.email_campaign_recipients
  where campaign_id = requested_campaign_id;

  select coalesce(jsonb_agg(to_jsonb(recipient_row)), '[]'::jsonb)
  into v_recipients
  from (
    select
      id, user_id, recipient_email, recipient_name, included, status,
      provider, provider_message_id, error_message, skipped_reason,
      attempted_at, sent_at, created_at, updated_at, metadata
    from public.email_campaign_recipients
    where campaign_id = requested_campaign_id
    order by
      included desc,
      case status when 'failed' then 1 when 'pending' then 2 when 'skipped' then 3 else 4 end,
      created_at,
      id
    limit 100
  ) recipient_row;

  return v_campaign || jsonb_build_object('counts', v_counts, 'recipients', v_recipients);
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
      ec.id, ec.campaign_type, ec.segment, ec.priority, ec.subject,
      ec.status, ec.tested_at, ec.sent_at, ec.cancelled_at, ec.created_at,
      jsonb_build_object(
        'selected', count(ecr.id) filter (where ecr.included),
        'excluded', count(ecr.id) filter (where not ecr.included),
        'pending', count(ecr.id) filter (where ecr.included and ecr.status = 'pending'),
        'sent', count(ecr.id) filter (where ecr.included and ecr.status = 'sent'),
        'failed', count(ecr.id) filter (where ecr.included and ecr.status = 'failed'),
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

create or replace function public.system_revalidate_email_campaign_recipients(
  requested_campaign_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_skipped integer;
begin
  update public.email_campaign_recipients recipient
  set
    status = 'skipped',
    included = false,
    skipped_reason = case
      when not exists (
        select 1 from public.profiles profile
        where profile.id = recipient.user_id
          and profile.role = 'candidate'
          and profile.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
          and profile.email !~* '@promotionsure\.com\.ng$'
      ) then 'Candidate account or email is no longer eligible'
      when exists (
        select 1 from public.email_preferences preference
        where preference.user_id = recipient.user_id
          and preference.marketing_opted_out
      ) then 'User opted out of follow-up emails'
      when exists (
        select 1 from public.module_entitlements entitlement
        where entitlement.user_id = recipient.user_id
          and entitlement.status = 'active'
          and entitlement.expires_at > now()
      ) or exists (
        select 1 from public.payment_orders payment
        where payment.user_id = recipient.user_id
          and (payment.status = 'active' or payment.provider_status = 'success')
      ) then 'User has paid access'
      else 'Recipient is no longer eligible'
    end,
    attempted_at = now()
  where recipient.campaign_id = requested_campaign_id
    and recipient.included
    and recipient.status = 'pending'
    and (
      not exists (
        select 1 from public.profiles profile
        where profile.id = recipient.user_id
          and profile.role = 'candidate'
          and profile.email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
          and profile.email !~* '@promotionsure\.com\.ng$'
      )
      or exists (
        select 1 from public.email_preferences preference
        where preference.user_id = recipient.user_id
          and preference.marketing_opted_out
      )
      or exists (
        select 1 from public.module_entitlements entitlement
        where entitlement.user_id = recipient.user_id
          and entitlement.status = 'active'
          and entitlement.expires_at > now()
      )
      or exists (
        select 1 from public.payment_orders payment
        where payment.user_id = recipient.user_id
          and (payment.status = 'active' or payment.provider_status = 'success')
      )
    );

  get diagnostics v_skipped = row_count;
  return v_skipped;
end;
$$;

revoke all on function public.get_admin_email_campaign_catalog()
from public, anon, authenticated, service_role;
revoke all on function public.admin_set_email_campaign_recipient_included(uuid, uuid, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.system_revalidate_email_campaign_recipients(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_admin_email_campaign_catalog()
to authenticated;
grant execute on function public.admin_set_email_campaign_recipient_included(uuid, uuid, boolean)
to authenticated;
grant execute on function public.system_revalidate_email_campaign_recipients(uuid)
to service_role;
