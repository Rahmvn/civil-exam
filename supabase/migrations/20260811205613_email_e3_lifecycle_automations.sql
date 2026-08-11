-- Phase E3: server-authoritative lifecycle automation feeding the E1 queue.
-- Every automation is disabled and unactivated on deployment. Enabling an
-- automation establishes a fresh cutoff; historical triggers are not backfilled.

alter table public.email_runtime_config
  add column lifecycle_min_interval_hours integer not null default 24
  check (lifecycle_min_interval_hours between 0 and 8760);

insert into public.admin_email_templates (
  template_key, name, category, subject, preheader, body_text, cta_label, cta_url
)
values
  (
    'never_practised', 'Never practised', 'engagement',
    'Your PromotionSure practice is ready',
    'Begin your first practice session when you are ready.',
    E'Hi {{first_name}},\n\nYour PromotionSure account is ready, but you have not started a practice session yet.\n\nChoose an available module and begin when you are ready.\n\nPromotionSure Team',
    'Start practising', 'https://promotionsure.com.ng/dashboard'
  ),
  (
    'access_expiring', 'Access expiring', 'engagement',
    'Your PromotionSure access is expiring soon',
    'Review your access before it expires.',
    E'Hi {{first_name}},\n\nOne of your PromotionSure modules is approaching its access expiry date.\n\nYou can review or extend your access from PromotionSure.\n\nPromotionSure Team',
    'Review access', 'https://promotionsure.com.ng/access'
  )
on conflict (template_key) do nothing;

create table public.email_lifecycle_automations (
  automation_key text primary key,
  name text not null,
  purpose text not null,
  enabled boolean not null default false,
  activated_at timestamptz,
  timing_mode text not null,
  delay_minutes integer not null,
  min_delay_minutes integer not null,
  max_delay_minutes integer not null,
  template_id uuid not null references public.admin_email_templates(id) on delete restrict,
  sort_order integer not null,
  last_evaluated_at timestamptz,
  last_run_started_at timestamptz,
  last_run_completed_at timestamptz,
  last_run_discovered integer not null default 0,
  last_run_queued integer not null default 0,
  last_run_skipped integer not null default 0,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_lifecycle_automations_key_check check (
    automation_key in ('getting_started', 'never_practised', 'practised_unpaid', 'incomplete_checkout', 'access_expiring')
  ),
  constraint email_lifecycle_automations_name_check check (btrim(name) <> '' and char_length(name) <= 120),
  constraint email_lifecycle_automations_purpose_check check (btrim(purpose) <> '' and char_length(purpose) <= 500),
  constraint email_lifecycle_automations_timing_check check (timing_mode in ('after_trigger', 'before_expiry')),
  constraint email_lifecycle_automations_delay_bounds check (
    min_delay_minutes > 0 and max_delay_minutes >= min_delay_minutes
    and delay_minutes between min_delay_minutes and max_delay_minutes
  ),
  constraint email_lifecycle_automations_activation_check check (not enabled or activated_at is not null)
);

create trigger email_lifecycle_automations_touch_updated_at
before update on public.email_lifecycle_automations
for each row execute function public.touch_updated_at();

insert into public.email_lifecycle_automations (
  automation_key, name, purpose, timing_mode, delay_minutes,
  min_delay_minutes, max_delay_minutes, template_id, sort_order
)
select seed.automation_key, seed.name, seed.purpose, seed.timing_mode,
  seed.delay_minutes, seed.min_delay_minutes, seed.max_delay_minutes,
  template.id, seed.sort_order
from (values
  ('getting_started', 'Getting started', 'Welcome confirmed candidates and show them how to begin practising.', 'after_trigger', 10, 5, 1440, 'getting_started', 10),
  ('never_practised', 'Never practised', 'Remind confirmed candidates who still have no completed practice activity.', 'after_trigger', 1440, 60, 10080, 'never_practised', 20),
  ('practised_unpaid', 'Practised but unpaid', 'Help candidates continue after practice when the practised module remains unpaid.', 'after_trigger', 1440, 60, 10080, 'practised_unpaid', 30),
  ('incomplete_checkout', 'Incomplete checkout', 'Offer help when an intended purchase remains genuinely incomplete.', 'after_trigger', 120, 60, 43200, 'incomplete_checkout', 40),
  ('access_expiring', 'Access expiring', 'Remind candidates before paid module access expires.', 'before_expiry', 10080, 1440, 43200, 'access_expiring', 50)
) seed(automation_key, name, purpose, timing_mode, delay_minutes, min_delay_minutes, max_delay_minutes, template_key, sort_order)
join public.admin_email_templates template on template.template_key = seed.template_key
on conflict (automation_key) do nothing;

create table public.email_lifecycle_instances (
  id uuid primary key default gen_random_uuid(),
  automation_key text not null references public.email_lifecycle_automations(automation_key) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null,
  source_key text not null,
  source_id uuid,
  trigger_at timestamptz not null,
  due_at timestamptz not null,
  state text not null default 'scheduled',
  eligibility_result text not null default 'pending',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  transactional_email_event_id uuid references public.transactional_email_events(id) on delete set null,
  evaluated_at timestamptz,
  queued_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_lifecycle_instances_source_check check (btrim(source_type) <> '' and btrim(source_key) <> '' and char_length(source_key) <= 240),
  constraint email_lifecycle_instances_time_check check (due_at >= trigger_at or automation_key = 'access_expiring'),
  constraint email_lifecycle_instances_state_check check (state in ('scheduled', 'queued', 'sent', 'skipped', 'cancelled', 'error')),
  constraint email_lifecycle_instances_eligibility_check check (eligibility_result in ('pending', 'eligible', 'ineligible', 'deferred', 'error')),
  constraint email_lifecycle_instances_identity_unique unique (automation_key, source_key)
);

create trigger email_lifecycle_instances_touch_updated_at
before update on public.email_lifecycle_instances
for each row execute function public.touch_updated_at();

alter table public.transactional_email_events
  add column lifecycle_instance_id uuid references public.email_lifecycle_instances(id) on delete set null;

create unique index transactional_email_events_lifecycle_instance_unique
on public.transactional_email_events (lifecycle_instance_id)
where lifecycle_instance_id is not null;

create index email_lifecycle_instances_due
on public.email_lifecycle_instances (due_at, created_at)
where state = 'scheduled';

create index email_lifecycle_instances_user_history
on public.email_lifecycle_instances (user_id, created_at desc);

create index email_lifecycle_instances_automation_history
on public.email_lifecycle_instances (automation_key, created_at desc);

create index payment_orders_lifecycle_pending
on public.payment_orders (created_at, id)
where status = 'pending' and fulfillment_status <> 'fulfilled';

create index attempts_lifecycle_first_completed
on public.attempts (completed_at, user_id, subject_id)
where completed_at is not null;

create index oral_attempts_lifecycle_first_completed
on public.oral_attempts (completed_at, user_id, subject_id)
where status = 'completed' and completed_at is not null;

create index module_entitlements_lifecycle_expiry
on public.module_entitlements (expires_at, user_id, subject_id)
where status = 'active' and payment_order_id is not null;

alter table public.email_lifecycle_automations enable row level security;
alter table public.email_lifecycle_instances enable row level security;
revoke all on table public.email_lifecycle_automations from public, anon, authenticated;
revoke all on table public.email_lifecycle_instances from public, anon, authenticated;
grant select, insert, update on table public.email_lifecycle_automations to service_role;
grant select, insert, update on table public.email_lifecycle_instances to service_role;

create or replace function private.e3_order_intent_unsatisfied(requested_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_orders abandoned
    join public.payment_order_items intended on intended.payment_order_id = abandoned.id
    where abandoned.id = requested_order_id
      and abandoned.status = 'pending'
      and abandoned.fulfillment_status <> 'fulfilled'
      and coalesce(abandoned.provider_status, 'pending') in ('initializing', 'initialized', 'ongoing', 'pending', 'processing', 'queued')
      and not exists (
        select 1
        from public.payment_order_items fulfilled_item
        join public.payment_orders fulfilled on fulfilled.id = fulfilled_item.payment_order_id
        where fulfilled.user_id = abandoned.user_id
          and fulfilled.exam_pack_id = abandoned.exam_pack_id
          and fulfilled_item.subject_id = intended.subject_id
          and fulfilled.fulfillment_status = 'fulfilled'
          and fulfilled.id <> abandoned.id
          and coalesce(fulfilled.paid_at, fulfilled.updated_at, fulfilled.created_at) > abandoned.created_at
      )
      and not exists (
        select 1 from public.payment_order_item_access_outcomes outcome
        where outcome.user_id = abandoned.user_id
          and outcome.exam_pack_id = abandoned.exam_pack_id
          and outcome.subject_id = intended.subject_id
          and outcome.effect_state = 'effective'
          and outcome.activated_at > abandoned.created_at
      )
      and not exists (
        select 1 from public.module_entitlements entitlement
        where entitlement.user_id = abandoned.user_id
          and entitlement.exam_pack_id = abandoned.exam_pack_id
          and entitlement.subject_id = intended.subject_id
          and entitlement.created_at > abandoned.created_at
      )
  )
$$;

create or replace function private.e3_practice_activity()
returns table (user_id uuid, subject_id uuid, activity_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select activity.user_id, activity.subject_id, activity.activity_at
  from (
    select attempt.user_id, attempt.subject_id, attempt.completed_at as activity_at, attempt.id
    from public.attempts attempt where attempt.completed_at is not null
    union all
    select oral.user_id, oral.subject_id, oral.completed_at, oral.id
    from public.oral_attempts oral where oral.status = 'completed' and oral.completed_at is not null
  ) activity
  order by activity.activity_at, activity.id
$$;

create or replace function private.e3_trigger_candidates(
  requested_automation_key text,
  requested_activated_at timestamptz,
  requested_delay_minutes integer,
  requested_limit integer
)
returns table (
  user_id uuid, source_type text, source_key text, source_id uuid,
  trigger_at timestamptz, due_at timestamptz, metadata jsonb
)
language plpgsql
stable
security definer
set search_path = public, auth, private, pg_temp
as $$
declare safe_limit integer := greatest(1, least(coalesce(requested_limit, 100), 500));
begin
  if requested_automation_key in ('getting_started', 'never_practised') then
    return query
    select profile.id, 'candidate_account'::text, profile.id::text, profile.id,
      greatest(profile.created_at, auth_user.email_confirmed_at),
      greatest(profile.created_at, auth_user.email_confirmed_at) + make_interval(mins => requested_delay_minutes),
      jsonb_build_object('joined_at', greatest(profile.created_at, auth_user.email_confirmed_at))
    from public.profiles profile
    join auth.users auth_user on auth_user.id = profile.id and auth_user.email_confirmed_at is not null
    where profile.role = 'candidate'
      and greatest(profile.created_at, auth_user.email_confirmed_at) >= requested_activated_at
      and (
        requested_automation_key = 'getting_started'
        or not exists (select 1 from public.attempts attempt where attempt.user_id = profile.id and attempt.completed_at is not null)
           and not exists (select 1 from public.oral_attempts oral where oral.user_id = profile.id and oral.status = 'completed')
      )
    order by greatest(profile.created_at, auth_user.email_confirmed_at), profile.id
    limit safe_limit;
  elsif requested_automation_key = 'practised_unpaid' then
    return query
    select practice.user_id, 'practice_activity'::text,
      practice.user_id::text || ':' || practice.subject_id::text,
      practice.subject_id, practice.activity_at,
      practice.activity_at + make_interval(mins => requested_delay_minutes),
      jsonb_build_object('subject_id', practice.subject_id, 'first_practice_at', practice.activity_at)
    from (
      select distinct on (activity.user_id)
        activity.user_id, activity.subject_id, activity.activity_at
      from private.e3_practice_activity() activity
      where not exists (
        select 1 from public.module_entitlements entitlement
        where entitlement.user_id = activity.user_id and entitlement.subject_id = activity.subject_id
          and entitlement.status = 'active' and entitlement.expires_at > now()
      )
      and not exists (
        select 1 from public.payment_orders payment
        join public.payment_order_items item on item.payment_order_id = payment.id
        where payment.user_id = activity.user_id and item.subject_id = activity.subject_id
          and payment.fulfillment_status = 'fulfilled'
      )
      order by activity.user_id, activity.activity_at, activity.subject_id
    ) practice
    join public.profiles profile on profile.id = practice.user_id and profile.role = 'candidate'
    join auth.users auth_user on auth_user.id = practice.user_id and auth_user.email_confirmed_at is not null
    where practice.activity_at >= requested_activated_at
    order by practice.activity_at, practice.user_id
    limit safe_limit;
  elsif requested_automation_key = 'incomplete_checkout' then
    return query
    select orders.user_id, 'payment_order'::text, orders.id::text, orders.id,
      orders.created_at, orders.created_at + make_interval(mins => requested_delay_minutes),
      jsonb_build_object('payment_order_id', orders.id, 'provider_reference', orders.provider_reference)
    from public.payment_orders orders
    join public.profiles profile on profile.id = orders.user_id and profile.role = 'candidate'
    join auth.users auth_user on auth_user.id = orders.user_id and auth_user.email_confirmed_at is not null
    where orders.created_at >= requested_activated_at
      and private.e3_order_intent_unsatisfied(orders.id)
    order by orders.created_at, orders.id
    limit safe_limit;
  elsif requested_automation_key = 'access_expiring' then
    return query
    with expiry_scope as (
      select entitlement.user_id, entitlement.exam_pack_id,
        (entitlement.expires_at at time zone 'UTC')::date as expiry_date,
        min(entitlement.expires_at) as expires_at,
        (array_agg(entitlement.id order by subject.sort_order, entitlement.id))[1] as representative_id,
        array_agg(entitlement.id order by subject.sort_order, entitlement.id) as entitlement_ids,
        array_agg(entitlement.subject_id order by subject.sort_order, entitlement.id) as subject_ids,
        array_agg(subject.name order by subject.sort_order, entitlement.id) as module_names,
        count(*)::integer as module_count
      from public.module_entitlements entitlement
      join public.payment_orders payment on payment.id = entitlement.payment_order_id and payment.fulfillment_status = 'fulfilled'
      join public.subjects subject on subject.id = entitlement.subject_id
      join public.profiles profile on profile.id = entitlement.user_id and profile.role = 'candidate'
      join auth.users auth_user on auth_user.id = entitlement.user_id and auth_user.email_confirmed_at is not null
      where entitlement.status = 'active' and entitlement.expires_at > now()
        and entitlement.expires_at - make_interval(mins => requested_delay_minutes) >= requested_activated_at
      group by entitlement.user_id, entitlement.exam_pack_id,
        (entitlement.expires_at at time zone 'UTC')::date
    )
    select scope.user_id, 'access_expiry_scope'::text,
      scope.user_id::text || ':' || scope.exam_pack_id::text || ':' || scope.expiry_date::text,
      scope.representative_id,
      scope.expires_at - make_interval(mins => requested_delay_minutes),
      scope.expires_at - make_interval(mins => requested_delay_minutes),
      jsonb_build_object(
        'exam_pack_id', scope.exam_pack_id, 'expiry_date', scope.expiry_date,
        'expires_at', scope.expires_at, 'entitlement_ids', to_jsonb(scope.entitlement_ids),
        'subject_ids', to_jsonb(scope.subject_ids), 'module_count', scope.module_count,
        'module_name', case when scope.module_count = 1 then scope.module_names[1] else scope.module_count::text || ' modules' end
      )
    from expiry_scope scope
    order by scope.expires_at, scope.user_id, scope.exam_pack_id
    limit safe_limit;
  else
    raise exception 'Unsupported lifecycle automation';
  end if;
end;
$$;

create or replace function private.e3_validate_lifecycle_instance(requested_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, private, pg_temp
as $$
declare
  instance public.email_lifecycle_instances;
  automation public.email_lifecycle_automations;
  current_email text;
  interval_hours integer;
  last_engagement_at timestamptz;
  target_expiry_date date;
  target_exam_pack uuid;
  target_subject uuid;
begin
  select * into instance from public.email_lifecycle_instances where id = requested_instance_id;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'instance_unavailable', 'disposition', 'cancel'); end if;
  select * into automation from public.email_lifecycle_automations where automation_key = instance.automation_key;
  if not found or not automation.enabled then return jsonb_build_object('allowed', false, 'reason', 'automation_disabled', 'disposition', 'cancel'); end if;
  if instance.trigger_at < automation.activated_at then return jsonb_build_object('allowed', false, 'reason', 'before_activation_cutoff', 'disposition', 'cancel'); end if;

  select lower(auth_user.email) into current_email
  from auth.users auth_user join public.profiles profile on profile.id = auth_user.id
  where auth_user.id = instance.user_id and auth_user.email_confirmed_at is not null and profile.role = 'candidate';
  if current_email is null then return jsonb_build_object('allowed', false, 'reason', 'candidate_unavailable', 'disposition', 'cancel'); end if;

  if instance.automation_key = 'never_practised' and (
    exists (select 1 from public.attempts attempt where attempt.user_id = instance.user_id and attempt.completed_at is not null)
    or exists (select 1 from public.oral_attempts oral where oral.user_id = instance.user_id and oral.status = 'completed')
  ) then return jsonb_build_object('allowed', false, 'reason', 'practice_started', 'disposition', 'cancel'); end if;

  if instance.automation_key = 'practised_unpaid' then
    target_subject := (instance.metadata->>'subject_id')::uuid;
    if exists (
      select 1 from public.module_entitlements entitlement
      where entitlement.user_id = instance.user_id and entitlement.subject_id = target_subject
        and entitlement.status = 'active' and entitlement.expires_at > now()
    ) or exists (
      select 1 from public.payment_orders payment join public.payment_order_items item on item.payment_order_id = payment.id
      where payment.user_id = instance.user_id and item.subject_id = target_subject and payment.fulfillment_status = 'fulfilled'
    ) then return jsonb_build_object('allowed', false, 'reason', 'relevant_access_obtained', 'disposition', 'cancel'); end if;
  end if;

  if instance.automation_key = 'incomplete_checkout'
     and not private.e3_order_intent_unsatisfied(instance.source_id) then
    return jsonb_build_object('allowed', false, 'reason', 'checkout_satisfied', 'disposition', 'cancel');
  end if;

  if instance.automation_key = 'access_expiring' then
    target_expiry_date := (instance.metadata->>'expiry_date')::date;
    target_exam_pack := (instance.metadata->>'exam_pack_id')::uuid;
    if not exists (
      select 1 from public.module_entitlements entitlement
      where entitlement.user_id = instance.user_id and entitlement.exam_pack_id = target_exam_pack
        and entitlement.status = 'active' and entitlement.expires_at > now()
        and (entitlement.expires_at at time zone 'UTC')::date = target_expiry_date
    ) then return jsonb_build_object('allowed', false, 'reason', 'access_renewed_or_replaced', 'disposition', 'cancel'); end if;
  end if;

  if exists (
    select 1 from public.email_preferences preference
    where preference.user_id = instance.user_id and preference.marketing_opted_out
  ) then return jsonb_build_object('allowed', false, 'reason', 'opted_out', 'disposition', 'skip'); end if;

  if exists (
    select 1 from public.email_suppressions suppression
    where suppression.email = current_email and suppression.active
  ) then return jsonb_build_object('allowed', false, 'reason', 'suppressed', 'disposition', 'skip'); end if;

  select lifecycle_min_interval_hours into interval_hours from private.e2_email_config();
  select max(event.accepted_at) into last_engagement_at
  from public.transactional_email_events event
  where event.user_id = instance.user_id and event.category = 'engagement'
    and event.dispatch_status = 'accepted'
    and event.lifecycle_instance_id is distinct from instance.id;
  if interval_hours > 0 and last_engagement_at > now() - make_interval(hours => interval_hours) then
    return jsonb_build_object(
      'allowed', false, 'reason', 'recently_contacted', 'disposition', 'defer',
      'next_eligible_at', last_engagement_at + make_interval(hours => interval_hours)
    );
  end if;

  return jsonb_build_object('allowed', true, 'recipient_email', current_email);
end;
$$;

create or replace function public.evaluate_email_lifecycle_automations(requested_batch_size integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_batch integer := greatest(1, least(coalesce(requested_batch_size, 100), 500));
  remaining integer := greatest(1, least(coalesce(requested_batch_size, 100), 500));
  automation public.email_lifecycle_automations;
  candidate record;
  instance public.email_lifecycle_instances;
  validation jsonb;
  template public.admin_email_templates;
  event_id uuid;
  recipient_name text;
  discovered integer := 0;
  queued integer := 0;
  skipped integer := 0;
  deferred integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('promotionsure-email-lifecycle-evaluator'));

  for automation in
    select * from public.email_lifecycle_automations where enabled order by sort_order
  loop
    update public.email_lifecycle_automations set last_run_started_at = now(), last_error = null where automation_key = automation.automation_key;
    for candidate in
      select * from private.e3_trigger_candidates(
        automation.automation_key, automation.activated_at, automation.delay_minutes, remaining
      )
    loop
      insert into public.email_lifecycle_instances (
        automation_key, user_id, source_type, source_key, source_id,
        trigger_at, due_at, metadata
      ) values (
        automation.automation_key, candidate.user_id, candidate.source_type,
        candidate.source_key, candidate.source_id, candidate.trigger_at,
        candidate.due_at, candidate.metadata
      ) on conflict (automation_key, source_key) do nothing;
      if found then discovered := discovered + 1; remaining := greatest(0, remaining - 1); end if;
      exit when remaining = 0;
    end loop;
    update public.email_lifecycle_automations
    set last_evaluated_at = now(), last_run_completed_at = now()
    where automation_key = automation.automation_key;
    exit when remaining = 0;
  end loop;

  for instance in
    select scheduled_instance.* from public.email_lifecycle_instances scheduled_instance
    join public.email_lifecycle_automations active on active.automation_key = scheduled_instance.automation_key and active.enabled
    where scheduled_instance.state = 'scheduled' and scheduled_instance.due_at <= now()
    order by scheduled_instance.due_at, scheduled_instance.created_at
    for update of scheduled_instance skip locked
    limit safe_batch
  loop
    validation := private.e3_validate_lifecycle_instance(instance.id);
    if coalesce((validation->>'allowed')::boolean, false) then
      select message.* into template
      from public.email_lifecycle_automations configured
      join public.admin_email_templates message on message.id = configured.template_id
      where configured.automation_key = instance.automation_key and message.active and message.category = 'engagement';
      if not found then
        update public.email_lifecycle_instances set state = 'error', eligibility_result = 'error',
          reason = 'template_unavailable', evaluated_at = now(), completed_at = now()
        where id = instance.id;
        skipped := skipped + 1;
        continue;
      end if;
      select profile.full_name into recipient_name
      from public.profiles profile where profile.id = instance.user_id;

      insert into public.transactional_email_events (
        event_key, event_type, template_key, category, priority, user_id,
        status, dispatch_status, delivery_status, metadata, payload,
        next_attempt_at, lifecycle_instance_id
      ) values (
        'lifecycle:' || instance.automation_key || ':' || instance.source_key,
        'lifecycle_' || instance.automation_key, 'admin_campaign', 'engagement', 50,
        instance.user_id, 'pending', 'pending', 'unknown',
        jsonb_build_object(
          'automation_key', instance.automation_key, 'lifecycle_instance_id', instance.id,
          'source_type', instance.source_type, 'source_id', instance.source_id,
          'trigger_at', instance.trigger_at, 'due_at', instance.due_at
        ) || instance.metadata,
        jsonb_build_object(
          'subject', template.subject, 'preheader', template.preheader,
          'body_text', template.body_text, 'cta_label', template.cta_label,
          'cta_url', template.cta_url, 'category', 'engagement',
          'module_name', instance.metadata->>'module_name',
          'recipient_name', coalesce(recipient_name, 'Candidate')
        ),
        now(), instance.id
      ) on conflict (event_key) do update set event_key = excluded.event_key
      returning id into event_id;

      update public.email_lifecycle_instances set state = 'queued', eligibility_result = 'eligible',
        reason = null, transactional_email_event_id = event_id, evaluated_at = now(), queued_at = coalesce(queued_at, now())
      where id = instance.id;
      queued := queued + 1;
    elsif validation->>'disposition' = 'defer' then
      update public.email_lifecycle_instances set eligibility_result = 'deferred',
        reason = validation->>'reason', due_at = (validation->>'next_eligible_at')::timestamptz,
        evaluated_at = now()
      where id = instance.id;
      deferred := deferred + 1;
    else
      update public.email_lifecycle_instances
      set state = case when validation->>'disposition' = 'skip' then 'skipped' else 'cancelled' end,
        eligibility_result = 'ineligible', reason = validation->>'reason',
        evaluated_at = now(), completed_at = now()
      where id = instance.id;
      skipped := skipped + 1;
    end if;
  end loop;

  update public.email_lifecycle_automations configured
  set last_run_discovered = aggregate.discovered,
      last_run_queued = aggregate.queued,
      last_run_skipped = aggregate.skipped
  from (
    select configured_inner.automation_key,
      count(*) filter (where lifecycle_row.created_at >= configured_inner.last_run_started_at)::integer as discovered,
      count(*) filter (where lifecycle_row.queued_at >= configured_inner.last_run_started_at)::integer as queued,
      count(*) filter (where lifecycle_row.completed_at >= configured_inner.last_run_started_at and lifecycle_row.state in ('skipped', 'cancelled', 'error'))::integer as skipped
    from public.email_lifecycle_automations configured_inner
    left join public.email_lifecycle_instances lifecycle_row on lifecycle_row.automation_key = configured_inner.automation_key
    where configured_inner.enabled
    group by configured_inner.automation_key
  ) aggregate
  where configured.automation_key = aggregate.automation_key;

  return jsonb_build_object('discovered', discovered, 'queued', queued, 'skipped', skipped, 'deferred', deferred);
exception when others then
  update public.email_lifecycle_automations
  set last_error = left(sqlerrm, 500), last_error_at = now(), last_run_completed_at = now()
  where enabled;
  return jsonb_build_object(
    'discovered', 0, 'queued', 0, 'skipped', 0, 'deferred', 0,
    'error', left(sqlerrm, 500)
  );
end;
$$;

create or replace function public.system_validate_e3_lifecycle_event(requested_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when event.lifecycle_instance_id is null then jsonb_build_object('allowed', true)
    else private.e3_validate_lifecycle_instance(event.lifecycle_instance_id)
  end
  from public.transactional_email_events event
  where event.id = requested_event_id
$$;

create or replace function public.system_defer_e3_lifecycle_event(
  requested_event_id uuid,
  requested_lease_token uuid,
  requested_next_attempt_at timestamptz,
  requested_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target public.transactional_email_events;
begin
  select * into target from public.transactional_email_events
  where id = requested_event_id and lifecycle_instance_id is not null
    and dispatch_status = 'processing' and lease_token = requested_lease_token
  for update;
  if not found then return jsonb_build_object('released', false, 'reason', 'lease_lost'); end if;
  update public.transactional_email_events set dispatch_status = 'pending', status = 'pending',
    next_attempt_at = greatest(coalesce(requested_next_attempt_at, now() + interval '1 hour'), now() + interval '1 minute'),
    lease_token = null, leased_at = null, lease_expires_at = null,
    last_error_code = left(coalesce(requested_reason, 'lifecycle_deferred'), 120), updated_at = now()
  where id = target.id;
  update public.email_lifecycle_instances set state = 'queued', eligibility_result = 'deferred',
    reason = left(coalesce(requested_reason, 'lifecycle_deferred'), 120), evaluated_at = now()
  where id = target.lifecycle_instance_id;
  return jsonb_build_object('released', true, 'disposition', 'deferred');
end;
$$;

create or replace function public.system_mark_e3_lifecycle_event_skipped(
  requested_event_id uuid,
  requested_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare instance_id uuid;
begin
  select lifecycle_instance_id into instance_id from public.transactional_email_events where id = requested_event_id;
  if instance_id is null then return jsonb_build_object('updated', false); end if;
  update public.email_lifecycle_instances
  set state = case when requested_reason in ('opted_out', 'suppressed') then 'skipped' else 'cancelled' end,
    eligibility_result = 'ineligible', reason = left(coalesce(requested_reason, 'no_longer_eligible'), 120),
    evaluated_at = now(), completed_at = now()
  where id = instance_id;
  return jsonb_build_object('updated', true);
end;
$$;

create or replace function private.e3_sync_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.lifecycle_instance_id is null then return new; end if;
  if new.dispatch_status = 'accepted' then
    update public.email_lifecycle_instances set state = 'sent', eligibility_result = 'eligible',
      reason = null, completed_at = coalesce(completed_at, now()) where id = new.lifecycle_instance_id;
  elsif new.dispatch_status = 'dead' then
    update public.email_lifecycle_instances set state = 'error', eligibility_result = 'error',
      reason = coalesce(new.last_error_code, 'dispatch_failed'), completed_at = coalesce(completed_at, now()) where id = new.lifecycle_instance_id;
  elsif new.dispatch_status = 'cancelled' then
    update public.email_lifecycle_instances set state = case when new.delivery_status = 'suppressed' then 'skipped' else 'cancelled' end,
      eligibility_result = 'ineligible', reason = coalesce(new.last_error_code, reason, 'dispatch_cancelled'),
      completed_at = coalesce(completed_at, now()) where id = new.lifecycle_instance_id;
  end if;
  return new;
end;
$$;

create trigger transactional_email_events_sync_e3_lifecycle
after update of dispatch_status on public.transactional_email_events
for each row when (new.lifecycle_instance_id is not null)
execute function private.e3_sync_lifecycle_event();

create or replace function public.get_admin_email_automations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sort_order), '[]'::jsonb))
  into result
  from (
    select automation.automation_key, automation.name, automation.purpose,
      automation.enabled, automation.activated_at, automation.timing_mode,
      automation.delay_minutes, automation.min_delay_minutes, automation.max_delay_minutes,
      automation.template_id, template.name as template_name, template.template_key,
      automation.sort_order, automation.last_evaluated_at, automation.last_run_started_at,
      automation.last_run_completed_at, automation.last_run_discovered,
      automation.last_run_queued, automation.last_run_skipped,
      automation.last_error, automation.last_error_at,
      count(instance.id) filter (where instance.state = 'sent')::integer as sent_count,
      count(instance.id) filter (where instance.state in ('skipped', 'cancelled'))::integer as skipped_cancelled_count,
      count(instance.id) filter (where instance.state = 'scheduled')::integer as scheduled_count,
      count(instance.id) filter (where instance.state = 'error')::integer as error_count
    from public.email_lifecycle_automations automation
    join public.admin_email_templates template on template.id = automation.template_id
    left join public.email_lifecycle_instances instance on instance.automation_key = automation.automation_key
    group by automation.automation_key, template.id
  ) row_data;
  return result;
end;
$$;

create or replace function public.get_admin_email_automation_history(
  requested_automation_key text default null,
  requested_state text default 'all',
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
declare result jsonb; safe_limit integer := greatest(1, least(coalesce(requested_limit, 50), 100)); safe_offset integer := greatest(0, coalesce(requested_offset, 0)); query_text text := nullif(lower(btrim(coalesce(requested_query, ''))), '');
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if coalesce(requested_state, 'all') not in ('all', 'scheduled', 'queued', 'sent', 'skipped', 'cancelled', 'error') then raise exception 'Choose a valid lifecycle state'; end if;
  with filtered as (
    select instance.id, instance.automation_key, automation.name as automation_name,
      instance.user_id, coalesce(profile.full_name, 'Candidate') as display_name,
      lower(auth_user.email) as current_email, instance.source_type, instance.source_id,
      instance.trigger_at, instance.due_at, instance.state, instance.eligibility_result,
      instance.reason, instance.transactional_email_event_id, instance.created_at,
      event.dispatch_status, event.delivery_status, event.last_error_code
    from public.email_lifecycle_instances instance
    join public.email_lifecycle_automations automation on automation.automation_key = instance.automation_key
    left join public.profiles profile on profile.id = instance.user_id
    left join auth.users auth_user on auth_user.id = instance.user_id
    left join public.transactional_email_events event on event.id = instance.transactional_email_event_id
    where (requested_automation_key is null or instance.automation_key = requested_automation_key)
      and (requested_state = 'all' or instance.state = requested_state)
      and (query_text is null or concat_ws(' ', profile.full_name, auth_user.email, instance.reason, instance.source_type) ilike '%' || query_text || '%')
  ), page as (
    select * from filtered order by created_at desc, id limit safe_limit offset safe_offset
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page_row)) from page page_row), '[]'::jsonb),
    'total', (select count(*) from filtered), 'limit', safe_limit, 'offset', safe_offset,
    'has_more', safe_offset + safe_limit < (select count(*) from filtered)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_update_email_automation(
  requested_automation_key text,
  requested_enabled boolean,
  requested_delay_minutes integer,
  requested_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor uuid := auth.uid(); current_row public.email_lifecycle_automations; saved public.email_lifecycle_automations; template public.admin_email_templates;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select * into current_row from public.email_lifecycle_automations where automation_key = requested_automation_key for update;
  if not found then raise exception 'Automation not found'; end if;
  if requested_delay_minutes not between current_row.min_delay_minutes and current_row.max_delay_minutes then raise exception 'Choose a timing within the allowed range'; end if;
  select * into template from public.admin_email_templates where id = requested_template_id and active and category = 'engagement';
  if not found then raise exception 'Choose an active engagement template'; end if;

  update public.email_lifecycle_automations
  set enabled = coalesce(requested_enabled, false),
      activated_at = case
        when coalesce(requested_enabled, false) and not current_row.enabled then now()
        when coalesce(requested_enabled, false) then current_row.activated_at
        else null
      end,
      delay_minutes = requested_delay_minutes,
      template_id = requested_template_id,
      last_error = null
  where automation_key = requested_automation_key
  returning * into saved;

  if current_row.enabled and not saved.enabled then
    update public.transactional_email_events event
    set dispatch_status = 'cancelled', status = 'skipped', last_error_code = 'automation_disabled',
      error_message = 'Lifecycle automation disabled before dispatch', next_attempt_at = null, updated_at = now()
    from public.email_lifecycle_instances instance
    where instance.automation_key = saved.automation_key
      and event.lifecycle_instance_id = instance.id
      and event.dispatch_status in ('pending', 'retrying');
    update public.email_lifecycle_instances set state = 'cancelled', eligibility_result = 'ineligible',
      reason = 'automation_disabled', completed_at = now()
    where automation_key = saved.automation_key and state in ('scheduled', 'queued');
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_automation_updated', 'email_lifecycle_automation', null,
    jsonb_build_object('automation_key', saved.automation_key, 'enabled', saved.enabled,
      'delay_minutes', saved.delay_minutes, 'template_id', saved.template_id));
  return (public.get_admin_email_automations()->'items') -> (
    select ordinality::integer - 1 from jsonb_array_elements(public.get_admin_email_automations()->'items') with ordinality item(value, ordinality)
    where item.value->>'automation_key' = saved.automation_key limit 1
  );
end;
$$;

revoke all on function private.e3_order_intent_unsatisfied(uuid) from public, anon, authenticated;
revoke all on function private.e3_practice_activity() from public, anon, authenticated;
revoke all on function private.e3_trigger_candidates(text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function private.e3_validate_lifecycle_instance(uuid) from public, anon, authenticated;
revoke all on function public.evaluate_email_lifecycle_automations(integer) from public, anon, authenticated;
revoke all on function public.system_validate_e3_lifecycle_event(uuid) from public, anon, authenticated;
revoke all on function public.system_defer_e3_lifecycle_event(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.system_mark_e3_lifecycle_event_skipped(uuid, text) from public, anon, authenticated;
revoke all on function public.get_admin_email_automations() from public, anon, authenticated, service_role;
revoke all on function public.get_admin_email_automation_history(text, text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_email_automation(text, boolean, integer, uuid) from public, anon, authenticated, service_role;

grant execute on function public.evaluate_email_lifecycle_automations(integer) to service_role;
grant execute on function public.system_validate_e3_lifecycle_event(uuid) to service_role;
grant execute on function public.system_defer_e3_lifecycle_event(uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.system_mark_e3_lifecycle_event_skipped(uuid, text) to service_role;
grant execute on function public.get_admin_email_automations() to authenticated;
grant execute on function public.get_admin_email_automation_history(text, text, text, integer, integer) to authenticated;
grant execute on function public.admin_update_email_automation(text, boolean, integer, uuid) to authenticated;
