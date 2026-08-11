-- Phase E2: Admin Email Center and campaign delivery through the E1 queue.
-- Existing campaign rows remain historical. Only explicitly finalized E2 drafts
-- create dispatchable transactional_email_events.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.admin_email_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name text not null,
  category text not null,
  subject text not null,
  preheader text,
  body_text text not null,
  cta_label text,
  cta_url text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_email_templates_key_safe check (template_key ~ '^[a-z0-9_]{2,80}$'),
  constraint admin_email_templates_name_safe check (btrim(name) <> '' and char_length(name) <= 120),
  constraint admin_email_templates_category_check check (category in ('support', 'engagement')),
  constraint admin_email_templates_subject_safe check (btrim(subject) <> '' and char_length(subject) <= 160),
  constraint admin_email_templates_preheader_safe check (preheader is null or char_length(preheader) <= 200),
  constraint admin_email_templates_body_safe check (btrim(body_text) <> '' and char_length(body_text) <= 5000),
  constraint admin_email_templates_cta_safe check (
    (cta_label is null and cta_url is null)
    or (
      btrim(coalesce(cta_label, '')) <> ''
      and char_length(cta_label) <= 80
      and char_length(cta_url) <= 500
      and cta_url ~* '^https://[^[:space:]]+$'
    )
  )
);

create trigger admin_email_templates_touch_updated_at
before update on public.admin_email_templates
for each row execute function public.touch_updated_at();

alter table public.admin_email_templates enable row level security;
revoke all on table public.admin_email_templates from public, anon, authenticated;
grant select, insert, update on table public.admin_email_templates to service_role;

insert into public.admin_email_templates (
  template_key, name, category, subject, preheader, body_text, cta_label, cta_url
)
values
  (
    'incomplete_checkout',
    'Incomplete checkout',
    'engagement',
    'Can we help with your PromotionSure payment?',
    'Help is available if anything interrupted your checkout.',
    E'Hi {{first_name}},\n\nWe noticed you started a payment on PromotionSure but did not complete it.\n\nIf anything got in the way, reply to this email and we will help.\n\nPromotionSure Team',
    null,
    null
  ),
  (
    'practised_unpaid',
    'Practised but unpaid',
    'engagement',
    'Continue preparing with PromotionSure',
    'Keep building on the practice you have already started.',
    E'Hi {{first_name}},\n\nYou have started practising on PromotionSure. Keep building on that progress when you are ready.\n\nIf you have a question, reply to this email and we will help.\n\nPromotionSure Team',
    'View access options',
    'https://promotionsure.com.ng/access'
  ),
  (
    'getting_started',
    'Getting started',
    'engagement',
    'Ready to begin with PromotionSure?',
    'Your PromotionSure account is ready when you are.',
    E'Hi {{first_name}},\n\nYour PromotionSure account is ready.\n\nYou can begin with an available practice module whenever you are ready. If you need help, reply to this email.\n\nPromotionSure Team',
    'Start practising',
    'https://promotionsure.com.ng/dashboard'
  ),
  (
    'general_support',
    'General support',
    'support',
    'A message from PromotionSure Support',
    null,
    E'Hi {{first_name}},\n\nWe are contacting you from PromotionSure Support.\n\nPromotionSure Team',
    null,
    null
  ),
  (
    'custom_message',
    'Custom message',
    'engagement',
    'An update from PromotionSure',
    null,
    E'Hi {{first_name}},\n\nWrite your message here.\n\nPromotionSure Team',
    null,
    null
  )
on conflict (template_key) do nothing;

create table public.email_runtime_config (
  singleton boolean primary key default true check (singleton),
  engagement_daily_cap integer not null default 50 check (engagement_daily_cap between 1 and 10000),
  engagement_min_interval_hours integer not null default 168 check (engagement_min_interval_hours between 0 and 8760),
  max_campaign_recipients integer not null default 500 check (max_campaign_recipients between 1 and 100000),
  updated_at timestamptz not null default now()
);

insert into public.email_runtime_config (singleton) values (true)
on conflict (singleton) do nothing;

alter table public.email_runtime_config enable row level security;
revoke all on table public.email_runtime_config from public, anon, authenticated;
grant select, update on table public.email_runtime_config to service_role;

alter table public.email_campaigns
  drop constraint if exists email_campaigns_type_check,
  drop constraint if exists email_campaigns_segment_check,
  drop constraint if exists email_campaigns_status_check,
  drop constraint if exists email_campaigns_body_safe;

alter table public.email_campaigns
  add column internal_name text,
  add column audience_kind text,
  add column segment_key text,
  add column segment_params jsonb not null default '{}'::jsonb,
  add column audience_user_ids uuid[] not null default '{}'::uuid[],
  add column category text,
  add column preheader text,
  add column cta_label text,
  add column cta_url text,
  add column template_id uuid references public.admin_email_templates(id) on delete set null,
  add column delivery_mode text not null default 'e1_queue',
  add column test_status text not null default 'not_sent',
  add column tested_fingerprint text,
  add column test_provider_message_id text,
  add column test_error_message text,
  add column tested_by uuid references public.profiles(id) on delete set null,
  add column queued_by uuid references public.profiles(id) on delete set null,
  add column paused_by uuid references public.profiles(id) on delete set null,
  add column resumed_by uuid references public.profiles(id) on delete set null,
  add column cancelled_by uuid references public.profiles(id) on delete set null,
  add column queued_at timestamptz,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column paused_at timestamptz,
  add column final_eligible_count integer,
  add column final_excluded_count integer;

update public.email_campaigns
set
  internal_name = coalesce(internal_name, subject),
  audience_kind = coalesce(audience_kind, 'segment'),
  segment_key = coalesce(segment_key, segment),
  category = coalesce(category, 'engagement'),
  delivery_mode = 'legacy_direct',
  test_status = case when tested_at is not null then 'passed' else 'not_sent' end
where internal_name is null or audience_kind is null or category is null;

alter table public.email_campaigns
  alter column internal_name set default 'Legacy campaign',
  alter column internal_name set not null,
  alter column audience_kind set default 'segment',
  alter column audience_kind set not null,
  alter column category set default 'engagement',
  alter column category set not null,
  alter column delivery_mode set default 'legacy_direct',
  add constraint email_campaigns_type_check check (
    campaign_type in (
      'payment_started_support_checkin',
      'practice_support_checkin',
      'getting_started_support_checkin',
      'admin_message'
    )
  ),
  add constraint email_campaigns_audience_kind_check check (audience_kind in ('individual', 'selected', 'segment')),
  add constraint email_campaigns_category_check check (category in ('support', 'engagement')),
  add constraint email_campaigns_status_check check (
    status in ('draft', 'tested', 'queued', 'running', 'paused', 'completed', 'cancelled', 'sending', 'sent')
  ),
  add constraint email_campaigns_delivery_mode_check check (delivery_mode in ('legacy_direct', 'e1_queue')),
  add constraint email_campaigns_test_status_check check (test_status in ('not_sent', 'pending', 'passed', 'failed')),
  add constraint email_campaigns_name_safe check (btrim(internal_name) <> '' and char_length(internal_name) <= 160),
  add constraint email_campaigns_body_safe check (btrim(body_text) <> '' and char_length(body_text) <= 5000),
  add constraint email_campaigns_preheader_safe check (preheader is null or char_length(preheader) <= 200),
  add constraint email_campaigns_cta_safe check (
    (cta_label is null and cta_url is null)
    or (
      btrim(coalesce(cta_label, '')) <> ''
      and char_length(cta_label) <= 80
      and char_length(cta_url) <= 500
      and cta_url ~* '^https://[^[:space:]]+$'
    )
  );

drop index if exists public.email_campaigns_one_active_idx;
create index email_campaigns_status_updated_idx
on public.email_campaigns (status, updated_at desc);

alter table public.email_campaign_recipients
  drop constraint if exists email_campaign_recipients_email_safe,
  drop constraint if exists email_campaign_recipients_status_check,
  alter column recipient_email drop not null,
  add column eligibility_state text not null default 'eligible',
  add column exclusion_reason text,
  add column transactional_email_event_id uuid references public.transactional_email_events(id) on delete set null,
  add column queued_at timestamptz,
  add column cancelled_at timestamptz,
  add constraint email_campaign_recipients_status_check check (
    status in ('pending', 'queued', 'sent', 'failed', 'skipped', 'cancelled')
  ),
  add constraint email_campaign_recipients_eligibility_check check (
    eligibility_state in ('eligible', 'excluded', 'queued', 'skipped', 'cancelled')
  );

create unique index email_campaign_recipients_event_unique
on public.email_campaign_recipients (transactional_email_event_id)
where transactional_email_event_id is not null;

alter table public.transactional_email_events
  add column campaign_id uuid references public.email_campaigns(id) on delete set null,
  add column campaign_recipient_id uuid references public.email_campaign_recipients(id) on delete set null;

create index transactional_email_events_campaign_dispatch_idx
on public.transactional_email_events (campaign_id, dispatch_status, created_at)
where campaign_id is not null;

create unique index transactional_email_events_campaign_recipient_unique
on public.transactional_email_events (campaign_recipient_id)
where campaign_recipient_id is not null;

create or replace function private.e2_email_config()
returns public.email_runtime_config
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select config
  from public.email_runtime_config config
  where singleton
$$;

create or replace function private.e2_candidate_facts()
returns table (
  user_id uuid,
  display_name text,
  profile_email text,
  current_email text,
  confirmed boolean,
  joined_at timestamptz,
  has_fulfilled_payment boolean,
  has_incomplete_checkout boolean,
  has_active_access boolean,
  has_expired_access boolean,
  has_started_practice boolean,
  latest_objective_passed boolean,
  latest_objective_subject_id uuid
)
language sql
stable
security definer
set search_path = public, auth, private, pg_temp
as $$
  with payment as (
    select
      orders.user_id,
      bool_or(orders.fulfillment_status = 'fulfilled') as has_fulfilled_payment
    from public.payment_orders orders
    group by orders.user_id
  ), incomplete_checkout as (
    select distinct abandoned.user_id
    from public.payment_orders abandoned
    where abandoned.fulfillment_status <> 'fulfilled'
      and abandoned.status = 'pending'
      and coalesce(abandoned.provider_status, 'pending') in (
        'initializing', 'initialized', 'ongoing', 'pending', 'processing', 'queued'
      )
      and abandoned.created_at between now() - interval '30 days' and now() - interval '30 minutes'
      and exists (
        select 1
        from public.payment_order_items intended
        where intended.payment_order_id = abandoned.id
      )
      and exists (
        select 1
        from public.payment_order_items intended
        where intended.payment_order_id = abandoned.id
          and not exists (
            select 1
            from public.payment_order_items fulfilled_item
            join public.payment_orders fulfilled
              on fulfilled.id = fulfilled_item.payment_order_id
            where fulfilled.user_id = abandoned.user_id
              and fulfilled.exam_pack_id = abandoned.exam_pack_id
              and fulfilled_item.subject_id = intended.subject_id
              and fulfilled.fulfillment_status = 'fulfilled'
              and fulfilled.id <> abandoned.id
              and coalesce(fulfilled.paid_at, fulfilled.updated_at, fulfilled.created_at)
                > abandoned.created_at
          )
          and not exists (
            select 1
            from public.payment_order_item_access_outcomes outcome
            where outcome.user_id = abandoned.user_id
              and outcome.exam_pack_id = abandoned.exam_pack_id
              and outcome.subject_id = intended.subject_id
              and outcome.effect_state = 'effective'
              and outcome.activated_at > abandoned.created_at
          )
          and not exists (
            select 1
            from public.module_entitlements entitlement
            where entitlement.user_id = abandoned.user_id
              and entitlement.exam_pack_id = abandoned.exam_pack_id
              and entitlement.subject_id = intended.subject_id
              and entitlement.created_at > abandoned.created_at
          )
      )
  ), access as (
    select
      entitlement.user_id,
      bool_or(entitlement.status = 'active' and entitlement.expires_at > now()) as has_active_access,
      bool_or(entitlement.expires_at <= now() or entitlement.status <> 'active') as has_expired_access
    from public.module_entitlements entitlement
    group by entitlement.user_id
  ), practice as (
    select activity.user_id, true as has_started_practice
    from (
      select attempts.user_id from public.attempts attempts
      union
      select oral.user_id from public.oral_attempts oral
    ) activity
    group by activity.user_id
  ), latest_objective as (
    select distinct on (attempts.user_id)
      attempts.user_id,
      attempts.passed,
      attempts.subject_id
    from public.attempts attempts
    where attempts.completed_at is not null
      and attempts.passed is not null
    order by attempts.user_id, attempts.completed_at desc, attempts.id desc
  )
  select
    profile.id,
    profile.full_name,
    lower(profile.email),
    lower(auth_user.email),
    auth_user.email_confirmed_at is not null,
    profile.created_at,
    coalesce(payment.has_fulfilled_payment, false),
    incomplete_checkout.user_id is not null,
    coalesce(access.has_active_access, false),
    coalesce(access.has_expired_access, false) and not coalesce(access.has_active_access, false),
    coalesce(practice.has_started_practice, false),
    latest_objective.passed,
    latest_objective.subject_id
  from public.profiles profile
  left join auth.users auth_user on auth_user.id = profile.id
  left join payment on payment.user_id = profile.id
  left join incomplete_checkout on incomplete_checkout.user_id = profile.id
  left join access on access.user_id = profile.id
  left join practice on practice.user_id = profile.id
  left join latest_objective on latest_objective.user_id = profile.id
  where profile.role = 'candidate'
$$;

create or replace function private.e2_segment_matches(
  requested_user_id uuid,
  requested_segment_key text,
  requested_params jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  facts record;
  segment_key text := lower(btrim(coalesce(requested_segment_key, '')));
  module_id uuid;
  module_latest_passed boolean;
begin
  select * into facts
  from private.e2_candidate_facts()
  where user_id = requested_user_id;

  if not found then return false; end if;

  if segment_key not in (
    'all_confirmed', 'paid', 'unpaid', 'active_access', 'expired_access',
    'started_practice', 'never_practised', 'practised_unpaid',
    'incomplete_checkout', 'active_module_access', 'joined_last_7_days',
    'joined_last_30_days', 'latest_objective_passed',
    'latest_objective_needs_retry'
  ) then
    raise exception 'Choose a valid audience segment';
  end if;

  if segment_key = 'active_module_access' and nullif(requested_params->>'module_id', '') is null then
    raise exception 'Choose a valid module';
  end if;

  if segment_key in ('active_module_access', 'latest_objective_passed', 'latest_objective_needs_retry')
     and nullif(requested_params->>'module_id', '') is not null then
    begin
      module_id := (requested_params->>'module_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Choose a valid module';
    end;
    if not exists (select 1 from public.subjects subject where subject.id = module_id) then
      raise exception 'Choose a valid module';
    end if;
  elsif requested_params <> '{}'::jsonb then
    raise exception 'Unsupported audience parameters';
  end if;

  if segment_key in ('latest_objective_passed', 'latest_objective_needs_retry') and module_id is not null then
    select attempt.passed into module_latest_passed
    from public.attempts attempt
    where attempt.user_id = requested_user_id
      and attempt.subject_id = module_id
      and attempt.completed_at is not null
      and attempt.passed is not null
    order by attempt.completed_at desc, attempt.id desc
    limit 1;
  end if;

  return case segment_key
    when 'all_confirmed' then facts.confirmed
    when 'paid' then facts.confirmed and facts.has_fulfilled_payment
    when 'unpaid' then facts.confirmed and not facts.has_fulfilled_payment
    when 'active_access' then facts.confirmed and facts.has_active_access
    when 'expired_access' then facts.confirmed and facts.has_expired_access
    when 'started_practice' then facts.confirmed and facts.has_started_practice
    when 'never_practised' then facts.confirmed and not facts.has_started_practice
    when 'practised_unpaid' then facts.confirmed and facts.has_started_practice and not facts.has_fulfilled_payment and not facts.has_active_access
    when 'incomplete_checkout' then facts.confirmed and facts.has_incomplete_checkout
    when 'active_module_access' then facts.confirmed and exists (
      select 1 from public.module_entitlements entitlement
      where entitlement.user_id = requested_user_id
        and entitlement.subject_id = module_id
        and entitlement.status = 'active'
        and entitlement.expires_at > now()
    )
    when 'joined_last_7_days' then facts.confirmed and facts.joined_at >= now() - interval '7 days'
    when 'joined_last_30_days' then facts.confirmed and facts.joined_at >= now() - interval '30 days'
    when 'latest_objective_passed' then facts.confirmed
      and (case when module_id is null then facts.latest_objective_passed else module_latest_passed end) is true
    when 'latest_objective_needs_retry' then facts.confirmed
      and (case when module_id is null then facts.latest_objective_passed else module_latest_passed end) is false
    else false
  end;
end;
$$;

create or replace function private.e2_audience_rows(
  requested_audience_kind text,
  requested_user_ids uuid[] default '{}'::uuid[],
  requested_segment_key text default null,
  requested_segment_params jsonb default '{}'::jsonb,
  requested_category text default 'engagement'
)
returns table (
  user_id uuid,
  display_name text,
  current_email text,
  eligible boolean,
  exclusion_reason text
)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  audience_kind text := lower(btrim(coalesce(requested_audience_kind, '')));
  category_key text := lower(btrim(coalesce(requested_category, '')));
  interval_hours integer;
begin
  if audience_kind not in ('individual', 'selected', 'segment') then
    raise exception 'Choose a valid audience type';
  end if;
  if category_key not in ('support', 'engagement') then
    raise exception 'Choose a valid email category';
  end if;
  if audience_kind = 'individual' and cardinality(coalesce(requested_user_ids, '{}'::uuid[])) <> 1 then
    raise exception 'Choose one user';
  end if;
  if audience_kind = 'selected' and cardinality(coalesce(requested_user_ids, '{}'::uuid[])) < 1 then
    raise exception 'Choose at least one user';
  end if;
  if category_key = 'support' and (
    audience_kind <> 'individual' or cardinality(coalesce(requested_user_ids, '{}'::uuid[])) <> 1
  ) then
    raise exception 'Support email is limited to one user';
  end if;
  if audience_kind = 'segment' and category_key <> 'engagement' then
    raise exception 'Segment email must use the engagement category';
  end if;
  if audience_kind in ('individual', 'selected') and exists (
    select 1
    from unnest(coalesce(requested_user_ids, '{}'::uuid[])) requested_user_id
    where not exists (
      select 1 from public.profiles profile
      where profile.id = requested_user_id and profile.role = 'candidate'
    )
  ) then
    raise exception 'Choose valid candidate users';
  end if;

  select engagement_min_interval_hours into interval_hours
  from private.e2_email_config();

  return query
  with audience as (
    select facts.*
    from private.e2_candidate_facts() facts
    where (
      audience_kind in ('individual', 'selected')
      and facts.user_id = any(coalesce(requested_user_ids, '{}'::uuid[]))
    ) or (
      audience_kind = 'segment'
      and private.e2_segment_matches(facts.user_id, requested_segment_key, requested_segment_params)
    )
  ), classified as (
    select
      audience.*,
      case
        when not audience.confirmed then 'unconfirmed_account'
        when audience.current_email is null
          or audience.current_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
          or char_length(audience.current_email) > 254 then 'invalid_recipient'
        when audience.current_email ~* '@promotionsure\.com\.ng$' then 'internal_account'
        when exists (
          select 1 from public.email_suppressions suppression
          where lower(suppression.email) = audience.current_email and suppression.active
        ) then 'suppressed'
        when category_key = 'engagement' and exists (
          select 1 from public.email_preferences preference
          where preference.user_id = audience.user_id and preference.marketing_opted_out
        ) then 'opted_out'
        when category_key = 'engagement' and interval_hours > 0 and exists (
          select 1 from public.transactional_email_events prior_event
          where prior_event.user_id = audience.user_id
            and prior_event.category = 'engagement'
            and prior_event.dispatch_status = 'accepted'
            and prior_event.accepted_at > now() - make_interval(hours => interval_hours)
        ) then 'recently_contacted'
        else null
      end as reason
    from audience
  )
  select
    classified.user_id,
    classified.display_name,
    classified.current_email,
    classified.reason is null,
    classified.reason
  from classified
  order by lower(coalesce(classified.display_name, classified.current_email, '')), classified.user_id;
end;
$$;

create or replace function private.e2_campaign_fingerprint(target public.email_campaigns)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select encode(
    digest(
      concat_ws(E'\n',
        target.category,
        target.audience_kind,
        coalesce(target.segment_key, ''),
        target.segment_params::text,
        array_to_string(target.audience_user_ids, ','),
        target.subject,
        coalesce(target.preheader, ''),
        target.body_text,
        coalesce(target.cta_label, ''),
        coalesce(target.cta_url, ''),
        coalesce(target.template_id::text, '')
      ),
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function public.get_admin_email_audience_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;

  select jsonb_build_object(
    'segments', jsonb_agg(to_jsonb(segment_row) order by segment_row.sort_order),
    'modules', (
      select coalesce(jsonb_agg(jsonb_build_object('id', subject.id, 'name', subject.name) order by subject.sort_order, subject.name), '[]'::jsonb)
      from public.subjects subject
      where subject.is_active
    ),
    'config', to_jsonb(private.e2_email_config()) - 'singleton' - 'updated_at'
  ) into result
  from (values
    ('all_confirmed'::text, 'All confirmed users'::text, 'Confirmed candidate accounts.'::text, false, 10),
    ('paid', 'Paid users'::text, 'Users with a currently fulfilled payment order.'::text, false, 20),
    ('unpaid', 'Unpaid users'::text, 'Users without a fulfilled payment order.'::text, false, 30),
    ('active_access', 'Active-access users'::text, 'Users with at least one active, unexpired module entitlement.'::text, false, 40),
    ('expired_access', 'Expired-access users'::text, 'Users with prior entitlement history and no active access.'::text, false, 50),
    ('started_practice', 'Started practising'::text, 'Users with objective or oral practice activity.'::text, false, 60),
    ('never_practised', 'Never practised'::text, 'Users with no objective or oral practice activity.'::text, false, 70),
    ('practised_unpaid', 'Practised but unpaid'::text, 'Users who practised and have neither fulfilled payment nor active access.'::text, false, 80),
    ('incomplete_checkout', 'Incomplete checkout'::text, 'Users with a recent pending purchase whose intended access was not subsequently fulfilled.'::text, false, 90),
    ('active_module_access', 'Active access to module'::text, 'Users with active access to the selected module.'::text, true, 100),
    ('joined_last_7_days', 'Joined in last 7 days'::text, 'Confirmed users who joined in the last 7 days.'::text, false, 110),
    ('joined_last_30_days', 'Joined in last 30 days'::text, 'Confirmed users who joined in the last 30 days.'::text, false, 120),
    ('latest_objective_passed', 'Latest objective practice passed'::text, 'Users whose latest completed objective attempt passed.'::text, false, 130),
    ('latest_objective_needs_retry', 'Latest objective practice needs retry'::text, 'Users whose latest completed objective attempt did not pass.'::text, false, 140)
  ) segment_row(segment_key, name, description, requires_module, sort_order);

  return result;
end;
$$;

create or replace function public.admin_preview_email_audience(
  requested_audience_kind text,
  requested_user_ids uuid[] default '{}'::uuid[],
  requested_segment_key text default null,
  requested_segment_params jsonb default '{}'::jsonb,
  requested_category text default 'engagement',
  requested_query text default null,
  requested_limit integer default 50,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  query_text text := nullif(lower(btrim(coalesce(requested_query, ''))), '');
  page_limit integer := greatest(1, least(coalesce(requested_limit, 50), 100));
  page_offset integer := greatest(0, coalesce(requested_offset, 0));
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;

  with audience as materialized (
    select * from private.e2_audience_rows(
      requested_audience_kind,
      requested_user_ids,
      requested_segment_key,
      requested_segment_params,
      requested_category
    )
  ), filtered as (
    select * from audience
    where query_text is null
      or concat_ws(' ', display_name, current_email, exclusion_reason) ilike '%' || query_text || '%'
  ), page as (
    select * from filtered
    order by lower(coalesce(display_name, current_email, '')), user_id
    limit page_limit offset page_offset
  )
  select jsonb_build_object(
    'eligible', (select count(*) from audience where eligible),
    'excluded', (select count(*) from audience where not eligible),
    'total', (select count(*) from audience),
    'excluded_counts', jsonb_build_object(
      'opted_out', (select count(*) from audience where exclusion_reason = 'opted_out'),
      'suppressed', (select count(*) from audience where exclusion_reason = 'suppressed'),
      'invalid_recipient', (select count(*) from audience where exclusion_reason = 'invalid_recipient'),
      'unconfirmed_account', (select count(*) from audience where exclusion_reason = 'unconfirmed_account'),
      'internal_account', (select count(*) from audience where exclusion_reason = 'internal_account'),
      'recently_contacted', (select count(*) from audience where exclusion_reason = 'recently_contacted')
    ),
    'items', coalesce((select jsonb_agg(to_jsonb(page_row)) from page page_row), '[]'::jsonb),
    'limit', page_limit,
    'offset', page_offset,
    'has_more', page_offset + page_limit < (select count(*) from filtered)
  ) into result;

  return result;
end;
$$;

create or replace function public.get_admin_email_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(template_row) order by template_row.name), '[]'::jsonb)
  ) into result
  from (
    select id, template_key, name, category, subject, preheader, body_text,
      cta_label, cta_url, active, created_at, updated_at
    from public.admin_email_templates
  ) template_row;
  return result;
end;
$$;

create or replace function public.admin_save_email_template(
  requested_template_id uuid,
  requested_name text,
  requested_category text,
  requested_subject text,
  requested_preheader text,
  requested_body_text text,
  requested_cta_label text,
  requested_cta_url text,
  requested_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  saved public.admin_email_templates;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if requested_template_id is null then raise exception 'Choose a template'; end if;

  update public.admin_email_templates
  set
    name = btrim(requested_name),
    category = lower(btrim(requested_category)),
    subject = btrim(requested_subject),
    preheader = nullif(btrim(coalesce(requested_preheader, '')), ''),
    body_text = btrim(requested_body_text),
    cta_label = nullif(btrim(coalesce(requested_cta_label, '')), ''),
    cta_url = nullif(btrim(coalesce(requested_cta_url, '')), ''),
    active = coalesce(requested_active, true),
    updated_by = actor
  where id = requested_template_id
  returning * into saved;

  if not found then raise exception 'Template not found'; end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'admin_email_template_updated', 'admin_email_template', saved.id,
    jsonb_build_object('template_key', saved.template_key, 'category', saved.category, 'active', saved.active));

  return to_jsonb(saved);
end;
$$;

create or replace function public.admin_create_e2_email_campaign(
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
  campaign_id uuid;
  template public.admin_email_templates;
  category_key text := lower(btrim(coalesce(requested_category, '')));
  audience_key text := lower(btrim(coalesce(requested_audience_kind, '')));
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;

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

  insert into public.email_campaigns (
    campaign_type, segment, priority, internal_name, audience_kind,
    segment_key, segment_params, audience_user_ids, category,
    subject, preheader, body_text, cta_label, cta_url,
    template_id, status, delivery_mode, created_by
  ) values (
    'admin_message',
    coalesce(nullif(lower(btrim(requested_segment_key)), ''), audience_key),
    case when category_key = 'support' then 2 else 3 end,
    btrim(requested_internal_name),
    audience_key,
    nullif(lower(btrim(requested_segment_key)), ''),
    coalesce(requested_segment_params, '{}'::jsonb),
    case when audience_key = 'segment' then '{}'::uuid[] else coalesce(requested_user_ids, '{}'::uuid[]) end,
    category_key,
    btrim(coalesce(requested_subject, template.subject)),
    nullif(btrim(coalesce(requested_preheader, template.preheader, '')), ''),
    btrim(coalesce(requested_body_text, template.body_text)),
    nullif(btrim(coalesce(requested_cta_label, template.cta_label, '')), ''),
    nullif(btrim(coalesce(requested_cta_url, template.cta_url, '')), ''),
    requested_template_id,
    'draft',
    'e1_queue',
    actor
  ) returning id into campaign_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_campaign_created', 'email_campaign', campaign_id,
    jsonb_build_object('audience_kind', audience_key, 'segment_key', requested_segment_key, 'category', category_key));

  return public.get_admin_email_campaign(campaign_id);
end;
$$;

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
  template public.admin_email_templates;
  audience_key text := lower(btrim(coalesce(requested_audience_kind, '')));
  category_key text := lower(btrim(coalesce(requested_category, '')));
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
    template_id = requested_template_id,
    status = 'draft',
    test_status = 'not_sent',
    tested_fingerprint = null,
    test_provider_message_id = null,
    test_error_message = null,
    tested_at = null,
    tested_by = null
  where id = requested_campaign_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_campaign_updated', 'email_campaign', requested_campaign_id,
    jsonb_build_object('previous_status', current_campaign.status, 'audience_kind', audience_key, 'category', category_key));

  return public.get_admin_email_campaign(requested_campaign_id);
end;
$$;

create or replace function public.system_get_e2_campaign_test_payload(
  requested_campaign_id uuid,
  requested_admin_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  campaign public.email_campaigns;
  admin_email text;
  recent_tests integer;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = requested_admin_id and profile.role = 'admin'
  ) then raise exception 'Admin access is required'; end if;

  select * into campaign from public.email_campaigns
  where id = requested_campaign_id and delivery_mode = 'e1_queue'
  for update;
  if not found then raise exception 'Campaign not found'; end if;
  if campaign.status not in ('draft', 'tested') then raise exception 'Only a draft campaign can send a test'; end if;

  select lower(email) into admin_email from auth.users where id = requested_admin_id;
  if admin_email is null or admin_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Your admin account has no valid test email address';
  end if;

  select count(*)::integer into recent_tests
  from public.admin_audit_logs log
  where log.actor_id = requested_admin_id
    and log.action in ('email_campaign_test_sent', 'email_campaign_test_failed')
    and log.created_at > now() - interval '1 hour';
  if recent_tests >= 10 then raise exception 'Test email limit reached. Try again later'; end if;

  update public.email_campaigns
  set test_status = 'pending', test_error_message = null
  where id = campaign.id;

  return jsonb_build_object(
    'campaign_id', campaign.id,
    'test_email', admin_email,
    'fingerprint', private.e2_campaign_fingerprint(campaign),
    'subject', campaign.subject,
    'preheader', campaign.preheader,
    'body_text', campaign.body_text,
    'cta_label', campaign.cta_label,
    'cta_url', campaign.cta_url,
    'category', campaign.category
  );
end;
$$;

create or replace function public.system_record_e2_campaign_test(
  requested_campaign_id uuid,
  requested_admin_id uuid,
  requested_fingerprint text,
  requested_succeeded boolean,
  requested_test_email text default null,
  requested_provider_message_id text default null,
  requested_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare campaign public.email_campaigns;
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = requested_admin_id and profile.role = 'admin'
  ) then raise exception 'Admin access is required'; end if;

  select * into campaign from public.email_campaigns
  where id = requested_campaign_id and delivery_mode = 'e1_queue'
  for update;
  if not found then raise exception 'Campaign not found'; end if;

  if requested_succeeded and private.e2_campaign_fingerprint(campaign) <> requested_fingerprint then
    raise exception 'Campaign changed while the test was sending';
  end if;

  update public.email_campaigns
  set
    status = case when requested_succeeded then 'tested' else 'draft' end,
    test_status = case when requested_succeeded then 'passed' else 'failed' end,
    tested_fingerprint = case when requested_succeeded then requested_fingerprint else null end,
    test_provider_message_id = case when requested_succeeded then requested_provider_message_id else null end,
    test_error_message = case when requested_succeeded then null else left(coalesce(requested_error_message, 'Test email failed'), 500) end,
    test_recipient_email = case when requested_succeeded then lower(requested_test_email) else test_recipient_email end,
    tested_at = case when requested_succeeded then now() else tested_at end,
    tested_by = case when requested_succeeded then requested_admin_id else tested_by end
  where id = requested_campaign_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    requested_admin_id,
    case when requested_succeeded then 'email_campaign_test_sent' else 'email_campaign_test_failed' end,
    'email_campaign',
    requested_campaign_id,
    jsonb_build_object(
      'provider_message_id', case when requested_succeeded then requested_provider_message_id else null end,
      'error_code', case when requested_succeeded then null else 'test_failed' end
    )
  );

  return jsonb_build_object('succeeded', requested_succeeded, 'test_status', case when requested_succeeded then 'passed' else 'failed' end);
end;
$$;

create or replace function public.admin_get_email_campaign_finalization(requested_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  campaign public.email_campaigns;
  preview jsonb;
  test_required boolean;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select * into campaign from public.email_campaigns where id = requested_campaign_id;
  if not found or campaign.delivery_mode <> 'e1_queue' then raise exception 'Campaign not found'; end if;
  if campaign.status not in ('draft', 'tested') then raise exception 'Campaign is already queued'; end if;

  preview := public.admin_preview_email_audience(
    campaign.audience_kind,
    campaign.audience_user_ids,
    campaign.segment_key,
    campaign.segment_params,
    campaign.category,
    null,
    50,
    0
  );
  test_required := campaign.audience_kind <> 'individual' or campaign.category = 'engagement';

  return preview || jsonb_build_object(
    'campaign_id', campaign.id,
    'internal_name', campaign.internal_name,
    'subject', campaign.subject,
    'audience_kind', campaign.audience_kind,
    'segment_key', campaign.segment_key,
    'category', campaign.category,
    'test_required', test_required,
    'test_valid', not test_required or (
      campaign.test_status = 'passed'
      and campaign.tested_fingerprint = private.e2_campaign_fingerprint(campaign)
    )
  );
end;
$$;

create or replace function public.admin_finalize_e2_email_campaign(requested_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  campaign public.email_campaigns;
  config public.email_runtime_config;
  test_required boolean;
  eligible_count integer;
  excluded_count integer;
  queued_count integer;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;

  select * into campaign from public.email_campaigns
  where id = requested_campaign_id for update;
  if not found or campaign.delivery_mode <> 'e1_queue' then raise exception 'Campaign not found'; end if;

  if campaign.status in ('queued', 'running', 'paused', 'completed') then
    return jsonb_build_object(
      'campaign_id', campaign.id,
      'queued', coalesce(campaign.final_eligible_count, 0),
      'excluded', coalesce(campaign.final_excluded_count, 0),
      'idempotent', true
    );
  end if;
  if campaign.status = 'cancelled' then raise exception 'Cancelled campaign cannot be queued'; end if;

  test_required := campaign.audience_kind <> 'individual' or campaign.category = 'engagement';
  if test_required and (
    campaign.test_status <> 'passed'
    or campaign.tested_fingerprint is distinct from private.e2_campaign_fingerprint(campaign)
  ) then raise exception 'Send a successful test for the current campaign before queueing'; end if;

  select * into config from private.e2_email_config();

  insert into public.email_campaign_recipients (
    campaign_id, user_id, recipient_email, recipient_name,
    status, included, eligibility_state, exclusion_reason, metadata
  )
  select
    campaign.id,
    audience.user_id,
    audience.current_email,
    audience.display_name,
    case when audience.eligible then 'pending' else 'skipped' end,
    audience.eligible,
    case when audience.eligible then 'eligible' else 'excluded' end,
    audience.exclusion_reason,
    jsonb_build_object('audience_kind', campaign.audience_kind, 'segment_key', campaign.segment_key)
  from private.e2_audience_rows(
    campaign.audience_kind,
    campaign.audience_user_ids,
    campaign.segment_key,
    campaign.segment_params,
    campaign.category
  ) audience
  on conflict (campaign_id, user_id) do update
  set
    recipient_email = excluded.recipient_email,
    recipient_name = excluded.recipient_name,
    status = excluded.status,
    included = excluded.included,
    eligibility_state = excluded.eligibility_state,
    exclusion_reason = excluded.exclusion_reason,
    metadata = excluded.metadata;

  select
    count(*) filter (where eligibility_state = 'eligible'),
    count(*) filter (where eligibility_state = 'excluded')
  into eligible_count, excluded_count
  from public.email_campaign_recipients
  where campaign_id = campaign.id;

  if eligible_count = 0 then raise exception 'There are no eligible recipients to queue'; end if;
  if eligible_count > config.max_campaign_recipients then
    raise exception 'Audience has % eligible recipients; the configured campaign maximum is %', eligible_count, config.max_campaign_recipients;
  end if;

  insert into public.transactional_email_events (
    event_key, event_type, recipient_email, user_id, provider,
    status, metadata, template_key, category, priority, payload,
    dispatch_status, delivery_status, attempt_count, max_attempts,
    next_attempt_at, campaign_id, campaign_recipient_id
  )
  select
    'admin-campaign/' || campaign.id::text || '/' || recipient.user_id::text,
    'admin_campaign',
    null,
    recipient.user_id,
    'resend',
    'pending',
    jsonb_build_object('campaign_id', campaign.id, 'campaign_recipient_id', recipient.id),
    'admin_campaign',
    campaign.category,
    case when campaign.category = 'support' then 20 else 50 end,
    jsonb_build_object(
      'campaign_id', campaign.id,
      'campaign_name', campaign.internal_name,
      'audience_kind', campaign.audience_kind,
      'segment_key', campaign.segment_key,
      'segment_params', campaign.segment_params,
      'category', campaign.category,
      'subject', campaign.subject,
      'preheader', campaign.preheader,
      'body_text', campaign.body_text,
      'cta_label', campaign.cta_label,
      'cta_url', campaign.cta_url,
      'recipient_name', recipient.recipient_name
    ),
    'pending',
    'unknown',
    0,
    6,
    now(),
    campaign.id,
    recipient.id
  from public.email_campaign_recipients recipient
  where recipient.campaign_id = campaign.id
    and recipient.eligibility_state = 'eligible'
  on conflict (event_key) do nothing;

  update public.email_campaign_recipients recipient
  set
    transactional_email_event_id = event.id,
    status = 'queued',
    eligibility_state = 'queued',
    queued_at = now()
  from public.transactional_email_events event
  where recipient.campaign_id = campaign.id
    and event.campaign_recipient_id = recipient.id
    and recipient.transactional_email_event_id is null;

  get diagnostics queued_count = row_count;

  update public.email_campaigns
  set
    status = 'queued',
    queued_by = actor,
    queued_at = now(),
    final_eligible_count = eligible_count,
    final_excluded_count = excluded_count
  where id = campaign.id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_campaign_queued', 'email_campaign', campaign.id,
    jsonb_build_object('eligible', eligible_count, 'excluded', excluded_count, 'events_created', queued_count));

  return jsonb_build_object(
    'campaign_id', campaign.id,
    'queued', eligible_count,
    'excluded', excluded_count,
    'events_created', queued_count,
    'idempotent', false
  );
end;
$$;

create or replace function public.admin_pause_email_campaign(requested_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor uuid := auth.uid(); previous_status text;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select status into previous_status from public.email_campaigns
  where id = requested_campaign_id and delivery_mode = 'e1_queue' for update;
  if not found then raise exception 'Campaign not found'; end if;
  if previous_status not in ('queued', 'running') then raise exception 'Only a queued or sending campaign can be paused'; end if;

  update public.email_campaigns
  set status = 'paused', paused_at = now(), paused_by = actor
  where id = requested_campaign_id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_campaign_paused', 'email_campaign', requested_campaign_id,
    jsonb_build_object('previous_status', previous_status));
  return public.get_admin_email_campaign(requested_campaign_id);
end;
$$;

create or replace function public.admin_resume_email_campaign(requested_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  update public.email_campaigns
  set status = 'queued', paused_at = null, resumed_by = actor
  where id = requested_campaign_id
    and delivery_mode = 'e1_queue'
    and status = 'paused';
  if not found then raise exception 'Only a paused campaign can be resumed'; end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_campaign_resumed', 'email_campaign', requested_campaign_id, '{}'::jsonb);
  return public.get_admin_email_campaign(requested_campaign_id);
end;
$$;

create or replace function public.admin_cancel_email_campaign(requested_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  campaign public.email_campaigns;
  cancelled_events integer := 0;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select * into campaign from public.email_campaigns
  where id = requested_campaign_id for update;
  if not found then raise exception 'Campaign not found'; end if;
  if campaign.status in ('completed', 'sent', 'cancelled') then raise exception 'This campaign can no longer be cancelled'; end if;

  if campaign.delivery_mode = 'legacy_direct' and campaign.status = 'sending' then
    raise exception 'This legacy campaign can no longer be cancelled';
  end if;

  update public.email_campaigns
  set status = 'cancelled', cancelled_at = now(), cancelled_by = actor
  where id = requested_campaign_id;

  if campaign.delivery_mode = 'e1_queue' then
    update public.transactional_email_events
    set
      dispatch_status = 'cancelled',
      status = 'skipped',
      next_attempt_at = null,
      lease_token = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = 'campaign_cancelled',
      error_message = 'Campaign cancelled before dispatch',
      updated_at = now()
    where campaign_id = requested_campaign_id
      and dispatch_status in ('pending', 'retrying');
    get diagnostics cancelled_events = row_count;

    update public.email_campaign_recipients recipient
    set
      status = 'cancelled',
      eligibility_state = 'cancelled',
      exclusion_reason = 'campaign_cancelled',
      cancelled_at = now()
    where recipient.campaign_id = requested_campaign_id
      and recipient.transactional_email_event_id in (
        select event.id from public.transactional_email_events event
        where event.campaign_id = requested_campaign_id and event.dispatch_status = 'cancelled'
      );
  else
    update public.email_campaign_recipients
    set status = 'skipped', skipped_reason = 'Campaign cancelled'
    where campaign_id = requested_campaign_id and status = 'pending';
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_campaign_cancelled', 'email_campaign', requested_campaign_id,
    jsonb_build_object('previous_status', campaign.status, 'cancelled_events', cancelled_events));
  return public.get_admin_email_campaign(requested_campaign_id);
end;
$$;

create or replace function private.e2_claim_transactional_email_events(
  requested_lease_token uuid,
  requested_batch_size integer default 20,
  requested_lease_seconds integer default 120
)
returns setof public.transactional_email_events
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  safe_batch integer := greatest(1, least(coalesce(requested_batch_size, 20), 50));
  safe_lease integer := greatest(30, least(coalesce(requested_lease_seconds, 120), 600));
  daily_cap integer;
  used_engagement integer;
  remaining_engagement integer;
begin
  if requested_lease_token is null then raise exception 'A lease token is required'; end if;
  perform pg_advisory_xact_lock(hashtext('promotionsure-email-engagement-cap'));

  select engagement_daily_cap into daily_cap from private.e2_email_config();
  select count(*)::integer into used_engagement
  from public.transactional_email_events event
  where event.category = 'engagement'
    and (
      (event.dispatch_status = 'accepted' and event.accepted_at >= date_trunc('day', now()))
      or (event.dispatch_status = 'processing' and event.leased_at >= date_trunc('day', now()))
    );
  remaining_engagement := greatest(0, daily_cap - used_engagement);

  return query
  with due as (
    select
      event.id,
      event.category,
      event.priority,
      event.next_attempt_at,
      event.created_at,
      row_number() over (
        partition by (event.category = 'engagement')
        order by event.priority, event.next_attempt_at nulls first, event.created_at, event.id
      ) as category_rank
    from public.transactional_email_events event
    where event.attempt_count < event.max_attempts
      and (
        (event.dispatch_status in ('pending', 'retrying') and coalesce(event.next_attempt_at, now()) <= now())
        or (event.dispatch_status = 'processing' and event.lease_expires_at <= now())
      )
      and (
        event.campaign_id is null
        or exists (
          select 1 from public.email_campaigns campaign
          where campaign.id = event.campaign_id
            and campaign.delivery_mode = 'e1_queue'
            and campaign.status in ('queued', 'running')
        )
      )
  ), candidates as (
    select due.id
    from due
    where due.category <> 'engagement' or due.category_rank <= remaining_engagement
    order by due.priority, due.next_attempt_at nulls first, due.created_at, due.id
    limit safe_batch
    for update skip locked
  )
  update public.transactional_email_events event
  set
    dispatch_status = 'processing',
    status = 'pending',
    lease_token = requested_lease_token,
    leased_at = now(),
    lease_expires_at = now() + make_interval(secs => safe_lease),
    attempted_at = now(),
    updated_at = now()
  from candidates
  where event.id = candidates.id
  returning event.*;
end;
$$;

create or replace function public.claim_transactional_email_events(
  requested_lease_token uuid,
  requested_batch_size integer default 20,
  requested_lease_seconds integer default 120
)
returns setof public.transactional_email_events
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from private.e2_claim_transactional_email_events(
    requested_lease_token,
    requested_batch_size,
    requested_lease_seconds
  )
$$;

create or replace function public.system_validate_e2_campaign_event(requested_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  event public.transactional_email_events;
  campaign public.email_campaigns;
  interval_hours integer;
begin
  select * into event from public.transactional_email_events where id = requested_event_id;
  if not found or event.campaign_id is null then return jsonb_build_object('allowed', true); end if;
  select * into campaign from public.email_campaigns where id = event.campaign_id;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'campaign_unavailable'); end if;

  if campaign.status = 'paused' then
    return jsonb_build_object('allowed', false, 'reason', 'campaign_paused', 'disposition', 'defer');
  end if;
  if campaign.status = 'cancelled' then
    return jsonb_build_object('allowed', false, 'reason', 'campaign_cancelled', 'disposition', 'cancel');
  end if;
  if campaign.status not in ('queued', 'running') then
    return jsonb_build_object('allowed', false, 'reason', 'campaign_unavailable', 'disposition', 'cancel');
  end if;

  if campaign.audience_kind = 'segment'
     and not private.e2_segment_matches(event.user_id, campaign.segment_key, campaign.segment_params) then
    return jsonb_build_object('allowed', false, 'reason', 'no_longer_eligible');
  end if;

  if campaign.category = 'engagement' and exists (
    select 1 from public.email_preferences preference
    where preference.user_id = event.user_id and preference.marketing_opted_out
  ) then return jsonb_build_object('allowed', false, 'reason', 'opted_out'); end if;

  select engagement_min_interval_hours into interval_hours from private.e2_email_config();
  if campaign.category = 'engagement' and interval_hours > 0 and exists (
    select 1 from public.transactional_email_events prior_event
    where prior_event.user_id = event.user_id
      and prior_event.id <> event.id
      and prior_event.category = 'engagement'
      and prior_event.dispatch_status = 'accepted'
      and prior_event.accepted_at > now() - make_interval(hours => interval_hours)
  ) then return jsonb_build_object('allowed', false, 'reason', 'recently_contacted'); end if;

  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function public.system_defer_paused_e2_campaign_event(
  requested_event_id uuid,
  requested_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event public.transactional_email_events;
  campaign_status text;
begin
  select candidate.* into event
  from public.transactional_email_events candidate
  where candidate.id = requested_event_id
    and candidate.campaign_id is not null
    and candidate.dispatch_status = 'processing'
    and candidate.lease_token = requested_lease_token
  for update;

  if not found then
    return jsonb_build_object('released', false, 'reason', 'lease_lost');
  end if;

  select campaign.status into campaign_status
  from public.email_campaigns campaign
  where campaign.id = event.campaign_id;

  if campaign_status = 'cancelled' then
    update public.transactional_email_events
    set
      dispatch_status = 'cancelled',
      status = 'skipped',
      next_attempt_at = null,
      lease_token = null,
      leased_at = null,
      lease_expires_at = null,
      last_error_code = 'campaign_cancelled',
      error_message = 'Campaign cancelled before provider dispatch',
      updated_at = now()
    where id = event.id;

    update public.email_campaign_recipients
    set
      status = 'cancelled',
      eligibility_state = 'cancelled',
      exclusion_reason = 'campaign_cancelled',
      cancelled_at = now()
    where id = event.campaign_recipient_id;

    return jsonb_build_object('released', true, 'disposition', 'cancelled');
  end if;

  update public.transactional_email_events
  set
    dispatch_status = 'pending',
    status = 'pending',
    next_attempt_at = now(),
    lease_token = null,
    leased_at = null,
    lease_expires_at = null,
    last_error_code = null,
    error_message = null,
    updated_at = now()
  where id = event.id;

  return jsonb_build_object('released', true, 'disposition', 'deferred');
end;
$$;

create or replace function public.system_mark_e2_campaign_recipient_skipped(
  requested_event_id uuid,
  requested_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.email_campaign_recipients recipient
  set
    status = case when requested_reason = 'campaign_cancelled' then 'cancelled' else 'skipped' end,
    eligibility_state = case when requested_reason = 'campaign_cancelled' then 'cancelled' else 'skipped' end,
    exclusion_reason = left(coalesce(nullif(btrim(requested_reason), ''), 'no_longer_eligible'), 80),
    cancelled_at = case when requested_reason = 'campaign_cancelled' then now() else cancelled_at end
  from public.transactional_email_events event
  where event.id = requested_event_id
    and recipient.id = event.campaign_recipient_id;
end;
$$;

create or replace function private.e2_refresh_campaign_from_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.campaign_id is null then return new; end if;

  if new.dispatch_status = 'processing' then
    update public.email_campaigns
    set status = 'running', started_at = coalesce(started_at, now())
    where id = new.campaign_id and status = 'queued';
  end if;

  if new.dispatch_status in ('accepted', 'cancelled', 'dead')
     and not exists (
       select 1 from public.transactional_email_events pending_event
       where pending_event.campaign_id = new.campaign_id
         and pending_event.id <> new.id
         and pending_event.dispatch_status in ('pending', 'retrying', 'processing')
     ) then
    update public.email_campaigns
    set status = 'completed', completed_at = coalesce(completed_at, now())
    where id = new.campaign_id and status in ('queued', 'running');
  end if;

  return new;
end;
$$;

create trigger transactional_email_events_refresh_e2_campaign
after update of dispatch_status on public.transactional_email_events
for each row
when (new.campaign_id is not null and old.dispatch_status is distinct from new.dispatch_status)
execute function private.e2_refresh_campaign_from_event();

create or replace function public.get_admin_email_campaign(requested_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  campaign_json jsonb;
  counts jsonb;
  recipients jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;

  select to_jsonb(campaign_row) into campaign_json
  from (
    select
      campaign.id, campaign.campaign_type, campaign.segment, campaign.priority,
      campaign.internal_name, campaign.audience_kind, campaign.segment_key,
      campaign.segment_params, campaign.audience_user_ids, campaign.category,
      campaign.subject, campaign.preheader, campaign.body_text,
      campaign.cta_label, campaign.cta_url, campaign.template_id,
      template.name as template_name, campaign.status, campaign.delivery_mode,
      campaign.test_status, campaign.test_recipient_email, campaign.tested_at,
      campaign.test_error_message, campaign.queued_at, campaign.started_at,
      campaign.paused_at, campaign.completed_at, campaign.sent_at,
      campaign.cancelled_at, campaign.final_eligible_count,
      campaign.final_excluded_count, campaign.created_by,
      creator.email as created_by_email, campaign.created_at, campaign.updated_at,
      (campaign.test_status = 'passed' and campaign.tested_fingerprint = private.e2_campaign_fingerprint(campaign)) as test_valid
    from public.email_campaigns campaign
    left join public.admin_email_templates template on template.id = campaign.template_id
    left join public.profiles creator on creator.id = campaign.created_by
    where campaign.id = requested_campaign_id
  ) campaign_row;

  if campaign_json is null then raise exception 'Campaign not found'; end if;

  select jsonb_build_object(
    'all', count(recipient.id),
    'eligible', count(recipient.id) filter (where recipient.eligibility_state in ('eligible', 'queued')),
    'excluded', count(recipient.id) filter (where recipient.eligibility_state = 'excluded'),
    'pending', count(recipient.id) filter (where event.dispatch_status in ('pending', 'retrying')),
    'processing', count(recipient.id) filter (where event.dispatch_status = 'processing'),
    'accepted', count(recipient.id) filter (where event.dispatch_status = 'accepted'),
    'delivered', count(recipient.id) filter (where event.delivery_status = 'delivered'),
    'delayed', count(recipient.id) filter (where event.delivery_status = 'delayed'),
    'bounced', count(recipient.id) filter (where event.delivery_status = 'bounced'),
    'complained', count(recipient.id) filter (where event.delivery_status = 'complained'),
    'suppressed', count(recipient.id) filter (where event.delivery_status = 'suppressed' or recipient.exclusion_reason = 'suppressed'),
    'failed', count(recipient.id) filter (where event.dispatch_status = 'dead' or event.delivery_status = 'failed'),
    'cancelled', count(recipient.id) filter (where event.dispatch_status = 'cancelled' or recipient.eligibility_state in ('skipped', 'cancelled'))
  ) into counts
  from public.email_campaign_recipients recipient
  left join public.transactional_email_events event on event.id = recipient.transactional_email_event_id
  where recipient.campaign_id = requested_campaign_id;

  select coalesce(jsonb_agg(to_jsonb(recipient_row)), '[]'::jsonb) into recipients
  from (
    select
      recipient.id, recipient.user_id, recipient.recipient_email,
      recipient.recipient_name, recipient.included, recipient.eligibility_state,
      recipient.exclusion_reason, recipient.created_at, recipient.queued_at,
      event.id as email_event_id, event.dispatch_status, event.delivery_status,
      event.attempt_count, event.provider_message_id, event.recipient_email_used,
      event.accepted_at, event.delivered_at, event.last_error_code, event.error_message
    from public.email_campaign_recipients recipient
    left join public.transactional_email_events event on event.id = recipient.transactional_email_event_id
    where recipient.campaign_id = requested_campaign_id
    order by
      case when recipient.exclusion_reason is not null then 2 else 1 end,
      lower(coalesce(recipient.recipient_name, recipient.recipient_email, '')),
      recipient.id
    limit 100
  ) recipient_row;

  return campaign_json || jsonb_build_object('counts', counts, 'recipients', recipients);
end;
$$;

create or replace function public.get_admin_email_campaigns(requested_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(campaign_row)), '[]'::jsonb)) into result
  from (
    select
      campaign.id, campaign.internal_name, campaign.campaign_type,
      campaign.audience_kind, campaign.segment_key, campaign.category,
      campaign.subject, campaign.status, campaign.delivery_mode,
      campaign.test_status, campaign.created_at, campaign.queued_at,
      campaign.completed_at, campaign.cancelled_at,
      creator.email as created_by_email,
      jsonb_build_object(
        'all', count(recipient.id),
        'eligible', count(recipient.id) filter (where recipient.eligibility_state in ('eligible', 'queued')),
        'excluded', count(recipient.id) filter (where recipient.eligibility_state = 'excluded'),
        'pending', count(recipient.id) filter (where event.dispatch_status in ('pending', 'retrying', 'processing')),
        'accepted', count(recipient.id) filter (where event.dispatch_status = 'accepted'),
        'delivered', count(recipient.id) filter (where event.delivery_status = 'delivered'),
        'failed', count(recipient.id) filter (where event.dispatch_status = 'dead' or event.delivery_status in ('failed', 'bounced', 'complained')),
        'cancelled', count(recipient.id) filter (where event.dispatch_status = 'cancelled' or recipient.eligibility_state in ('skipped', 'cancelled'))
      ) as counts
    from public.email_campaigns campaign
    left join public.profiles creator on creator.id = campaign.created_by
    left join public.email_campaign_recipients recipient on recipient.campaign_id = campaign.id
    left join public.transactional_email_events event on event.id = recipient.transactional_email_event_id
    group by campaign.id, creator.email
    order by campaign.created_at desc, campaign.id
    limit greatest(5, least(coalesce(requested_limit, 20), 100))
  ) campaign_row;
  return result;
end;
$$;

create or replace function public.get_admin_email_campaign_recipients(
  requested_campaign_id uuid,
  requested_query text default null,
  requested_state text default 'all',
  requested_limit integer default 50,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  query_text text := nullif(lower(btrim(coalesce(requested_query, ''))), '');
  state_key text := lower(btrim(coalesce(requested_state, 'all')));
  page_limit integer := greatest(1, least(coalesce(requested_limit, 50), 100));
  page_offset integer := greatest(0, coalesce(requested_offset, 0));
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if not exists (select 1 from public.email_campaigns where id = requested_campaign_id) then raise exception 'Campaign not found'; end if;

  with rows as (
    select
      recipient.id, recipient.user_id, recipient.recipient_name,
      recipient.recipient_email, recipient.eligibility_state,
      recipient.exclusion_reason, event.id as email_event_id,
      event.dispatch_status, event.delivery_status, event.attempt_count,
      event.recipient_email_used, event.accepted_at, event.delivered_at,
      event.last_error_code,
      case
        when recipient.exclusion_reason is not null then recipient.exclusion_reason
        when event.delivery_status <> 'unknown' then event.delivery_status
        else coalesce(event.dispatch_status, recipient.eligibility_state)
      end as display_state
    from public.email_campaign_recipients recipient
    left join public.transactional_email_events event on event.id = recipient.transactional_email_event_id
    where recipient.campaign_id = requested_campaign_id
  ), filtered as (
    select * from rows
    where (state_key = 'all' or display_state = state_key)
      and (query_text is null or concat_ws(' ', recipient_name, recipient_email, recipient_email_used) ilike '%' || query_text || '%')
  ), page as (
    select * from filtered
    order by lower(coalesce(recipient_name, recipient_email, recipient_email_used, '')), id
    limit page_limit offset page_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page_row)) from page page_row), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'limit', page_limit,
    'offset', page_offset,
    'has_more', page_offset + page_limit < (select count(*) from filtered)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_admin_user_application_email_history(
  requested_user_id uuid,
  requested_limit integer default 25,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb; page_limit integer := greatest(1, least(coalesce(requested_limit, 25), 100)); page_offset integer := greatest(0, coalesce(requested_offset, 0));
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if not exists (select 1 from public.profiles where id = requested_user_id) then raise exception 'User not found'; end if;

  with rows as (
    select
      event.id, event.event_type, event.template_key, event.category,
      event.dispatch_status, event.delivery_status, event.attempt_count,
      event.recipient_email_used, event.provider_message_id,
      event.accepted_at, event.delivered_at, event.created_at,
      event.campaign_id, campaign.internal_name as campaign_name,
      case when event.template_key = 'admin_campaign' then event.payload->>'subject' else null end as subject
    from public.transactional_email_events event
    left join public.email_campaigns campaign on campaign.id = event.campaign_id
    where event.user_id = requested_user_id
    order by event.created_at desc, event.id
  ), page as (
    select * from rows limit page_limit offset page_offset
  )
  select jsonb_build_object(
    'user', (
      select jsonb_build_object(
        'id', profile.id,
        'display_name', coalesce(nullif(btrim(profile.full_name), ''), 'Candidate'),
        'current_email', auth_user.email
      )
      from public.profiles profile
      join auth.users auth_user on auth_user.id = profile.id
      where profile.id = requested_user_id
    ),
    'items', coalesce((select jsonb_agg(to_jsonb(page_row)) from page page_row), '[]'::jsonb),
    'total', (select count(*) from rows),
    'limit', page_limit,
    'offset', page_offset,
    'has_more', page_offset + page_limit < (select count(*) from rows),
    'preference', (
      select jsonb_build_object(
        'engagement_enabled', not coalesce(preference.marketing_opted_out, false),
        'opted_out_at', preference.opted_out_at,
        'source', preference.opt_out_source
      )
      from (select requested_user_id as user_id) target
      left join public.email_preferences preference on preference.user_id = target.user_id
    ),
    'suppressions', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', suppression.reason, 'source', suppression.source, 'created_at', suppression.created_at)), '[]'::jsonb)
      from public.email_suppressions suppression
      join auth.users auth_user on lower(auth_user.email) = lower(suppression.email)
      where auth_user.id = requested_user_id and suppression.active
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.get_admin_transactional_email_events(
  requested_status text default 'all',
  requested_query text default null,
  requested_limit integer default 50,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  status_key text := lower(btrim(coalesce(requested_status, 'all')));
  query_text text := nullif(btrim(coalesce(requested_query, '')), '');
  page_limit integer := greatest(10, least(coalesce(requested_limit, 50), 100));
  page_offset integer := greatest(0, coalesce(requested_offset, 0));
  total_count integer;
  items jsonb;
  counts jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if status_key not in ('all', 'pending', 'processing', 'retrying', 'accepted', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed', 'dead', 'cancelled') then
    raise exception 'Choose a valid email status';
  end if;
  if char_length(coalesce(query_text, '')) > 120 then raise exception 'Email search is too long'; end if;

  with states as (
    select case when event.delivery_status <> 'unknown' then event.delivery_status else event.dispatch_status end as display_status
    from public.transactional_email_events event
  )
  select jsonb_build_object(
    'all', count(*),
    'pending', count(*) filter (where display_status = 'pending'),
    'processing', count(*) filter (where display_status = 'processing'),
    'retrying', count(*) filter (where display_status = 'retrying'),
    'accepted', count(*) filter (where display_status = 'accepted'),
    'sent', count(*) filter (where display_status = 'sent'),
    'delivered', count(*) filter (where display_status = 'delivered'),
    'delayed', count(*) filter (where display_status = 'delayed'),
    'failed', count(*) filter (where display_status = 'failed'),
    'bounced', count(*) filter (where display_status = 'bounced'),
    'complained', count(*) filter (where display_status = 'complained'),
    'suppressed', count(*) filter (where display_status = 'suppressed'),
    'dead', count(*) filter (where display_status = 'dead'),
    'cancelled', count(*) filter (where display_status = 'cancelled')
  ) into counts from states;

  with matching as (
    select
      event.*,
      case when event.delivery_status <> 'unknown' then event.delivery_status else event.dispatch_status end as display_status,
      payment.provider_reference, payment.purchase_type, payment.purchase_label,
      profile.full_name as requester_name, auth_user.email as current_email,
      campaign.internal_name as campaign_name, campaign.subject as campaign_subject,
      template.name as template_name,
      public.build_payment_order_presentation(event.payment_order_id) as truth
    from public.transactional_email_events event
    left join public.payment_orders payment on payment.id = event.payment_order_id
    left join public.profiles profile on profile.id = event.user_id
    left join auth.users auth_user on auth_user.id = event.user_id
    left join public.email_campaigns campaign on campaign.id = event.campaign_id
    left join public.admin_email_templates template on template.id = campaign.template_id
  ), filtered as (
    select * from matching
    where (status_key = 'all' or display_status = status_key)
      and (query_text is null or concat_ws(
        ' ', event_type, template_key, recipient_email_used, recipient_email,
        current_email, provider_message_id, error_message, provider_reference,
        purchase_label, requester_name, campaign_name, campaign_subject,
        template_name, truth ->> 'product_label', truth ->> 'plan_code'
      ) ilike '%' || query_text || '%')
  ), page as (
    select
      id, event_key, event_type, template_key, category,
      coalesce(recipient_email_used, current_email, recipient_email) as recipient_email,
      user_id, requester_name, payment_order_id, provider_reference,
      purchase_type, purchase_label, truth ->> 'product_label' as product_label,
      truth ->> 'purchase_scope' as purchase_scope,
      (truth ->> 'duration_months')::integer as duration_months,
      truth -> 'items' as items,
      case when (truth ->> 'item_count')::integer = 1 then truth #>> '{items,0,subject_name}' end as subject_name,
      campaign_id, campaign_name, campaign_subject as subject, template_name,
      case when campaign_id is null then 'transactional' else 'campaign' end as source,
      provider, provider_message_id, display_status as status,
      dispatch_status, delivery_status, attempt_count, max_attempts,
      error_message, last_error_code, attempted_at, next_attempt_at,
      accepted_at, sent_at, delivered_at, last_provider_event_at,
      created_at, updated_at
    from filtered
    order by created_at desc, id
    limit page_limit offset page_offset
  )
  select
    (select count(*)::integer from filtered),
    coalesce((select jsonb_agg(to_jsonb(page_row)) from page page_row), '[]'::jsonb)
  into total_count, items;

  return jsonb_build_object(
    'items', items, 'total', total_count, 'counts', counts,
    'limit', page_limit, 'offset', page_offset,
    'has_more', page_offset + jsonb_array_length(items) < total_count
  );
end;
$$;

create or replace function public.get_my_email_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare target_user_id uuid := auth.uid(); preference public.email_preferences;
begin
  if target_user_id is null then raise exception 'Sign in is required'; end if;
  select * into preference
  from public.email_preferences
  where email_preferences.user_id = target_user_id;
  return jsonb_build_object(
    'engagement_enabled', not coalesce(preference.marketing_opted_out, false),
    'updated_at', preference.updated_at
  );
end;
$$;

create or replace function public.set_my_engagement_email_enabled(requested_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target_user_id uuid := auth.uid(); enabled boolean := coalesce(requested_enabled, false); saved public.email_preferences;
begin
  if target_user_id is null then raise exception 'Sign in is required'; end if;
  insert into public.email_preferences (user_id, marketing_opted_out, opted_out_at, opt_out_source)
  values (target_user_id, not enabled, case when enabled then null else now() end, case when enabled then null else 'account_preferences' end)
  on conflict (user_id) do update
  set
    marketing_opted_out = excluded.marketing_opted_out,
    opted_out_at = excluded.opted_out_at,
    opt_out_source = excluded.opt_out_source
  returning * into saved;
  return jsonb_build_object('engagement_enabled', not saved.marketing_opted_out, 'updated_at', saved.updated_at);
end;
$$;

create or replace function public.system_unsubscribe_engagement_email(
  requested_user_id uuid,
  requested_source text default 'email_unsubscribe'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare saved public.email_preferences;
begin
  if requested_user_id is null or not exists (select 1 from public.profiles where id = requested_user_id) then
    return jsonb_build_object('updated', false, 'reason', 'unknown_user');
  end if;
  insert into public.email_preferences (user_id, marketing_opted_out, opted_out_at, opt_out_source)
  values (requested_user_id, true, now(), left(coalesce(requested_source, 'email_unsubscribe'), 80))
  on conflict (user_id) do update
  set
    marketing_opted_out = true,
    opted_out_at = coalesce(email_preferences.opted_out_at, now()),
    opt_out_source = left(coalesce(requested_source, 'email_unsubscribe'), 80)
  returning * into saved;
  return jsonb_build_object('updated', true, 'already_unsubscribed', saved.opted_out_at < now() - interval '1 second');
end;
$$;

revoke all on function public.get_admin_email_audience_catalog() from public, anon, authenticated, service_role;
revoke all on function public.admin_preview_email_audience(text, uuid[], text, jsonb, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_email_templates() from public, anon, authenticated, service_role;
revoke all on function public.admin_save_email_template(uuid, text, text, text, text, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.admin_create_e2_email_campaign(text, text, uuid[], text, jsonb, text, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_e2_email_campaign(uuid, text, text, uuid[], text, jsonb, text, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_email_campaign_finalization(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_finalize_e2_email_campaign(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_pause_email_campaign(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_resume_email_campaign(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_cancel_email_campaign(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_email_campaign(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_email_campaigns(integer) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_email_campaign_recipients(uuid, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_user_application_email_history(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_my_email_preferences() from public, anon, authenticated, service_role;
revoke all on function public.set_my_engagement_email_enabled(boolean) from public, anon, authenticated, service_role;
revoke all on function public.claim_transactional_email_events(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.system_get_e2_campaign_test_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function public.system_record_e2_campaign_test(uuid, uuid, text, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.system_validate_e2_campaign_event(uuid) from public, anon, authenticated;
revoke all on function public.system_defer_paused_e2_campaign_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.system_mark_e2_campaign_recipient_skipped(uuid, text) from public, anon, authenticated;
revoke all on function public.system_unsubscribe_engagement_email(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_create_email_campaign(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_email_campaign_copy(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_email_campaign_recipient_included(uuid, uuid, boolean) from public, anon, authenticated, service_role;

grant execute on function public.get_admin_email_audience_catalog() to authenticated;
grant execute on function public.admin_preview_email_audience(text, uuid[], text, jsonb, text, text, integer, integer) to authenticated;
grant execute on function public.get_admin_email_templates() to authenticated;
grant execute on function public.admin_save_email_template(uuid, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_create_e2_email_campaign(text, text, uuid[], text, jsonb, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.admin_update_e2_email_campaign(uuid, text, text, uuid[], text, jsonb, text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.admin_get_email_campaign_finalization(uuid) to authenticated;
grant execute on function public.admin_finalize_e2_email_campaign(uuid) to authenticated;
grant execute on function public.admin_pause_email_campaign(uuid) to authenticated;
grant execute on function public.admin_resume_email_campaign(uuid) to authenticated;
grant execute on function public.admin_cancel_email_campaign(uuid) to authenticated;
grant execute on function public.get_admin_email_campaign(uuid) to authenticated;
grant execute on function public.get_admin_email_campaigns(integer) to authenticated;
grant execute on function public.get_admin_email_campaign_recipients(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.get_admin_user_application_email_history(uuid, integer, integer) to authenticated;
grant execute on function public.get_my_email_preferences() to authenticated;
grant execute on function public.set_my_engagement_email_enabled(boolean) to authenticated;
grant execute on function public.claim_transactional_email_events(uuid, integer, integer) to service_role;
grant execute on function public.system_get_e2_campaign_test_payload(uuid, uuid) to service_role;
grant execute on function public.system_record_e2_campaign_test(uuid, uuid, text, boolean, text, text, text) to service_role;
grant execute on function public.system_validate_e2_campaign_event(uuid) to service_role;
grant execute on function public.system_defer_paused_e2_campaign_event(uuid, uuid) to service_role;
grant execute on function public.system_mark_e2_campaign_recipient_skipped(uuid, text) to service_role;
grant execute on function public.system_unsubscribe_engagement_email(uuid, text) to service_role;
