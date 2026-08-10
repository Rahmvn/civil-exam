-- Phase E1: durable application-email dispatch and provider delivery truth.
-- Legacy rows remain historical. Only events created after this migration are
-- eligible for automatic dispatch.

alter table public.transactional_email_events
  drop constraint if exists transactional_email_events_status_check;

alter table public.transactional_email_events
  alter column recipient_email drop not null,
  add column if not exists template_key text,
  add column if not exists category text,
  add column if not exists priority smallint,
  add column if not exists payload jsonb,
  add column if not exists dispatch_status text,
  add column if not exists delivery_status text,
  add column if not exists recipient_email_used text,
  add column if not exists attempt_count integer,
  add column if not exists max_attempts integer,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists leased_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists last_error_code text;

update public.transactional_email_events
set
  template_key = coalesce(template_key, event_type),
  category = coalesce(category, 'transactional'),
  priority = coalesce(priority, 10),
  payload = coalesce(payload, metadata, '{}'::jsonb),
  dispatch_status = coalesce(dispatch_status, case status
    when 'sent' then 'accepted'
    when 'failed' then 'dead'
    when 'skipped' then 'cancelled'
    else 'cancelled'
  end),
  delivery_status = coalesce(delivery_status, 'unknown'),
  recipient_email_used = coalesce(recipient_email_used, recipient_email),
  attempt_count = coalesce(attempt_count, case when attempted_at is null then 0 else 1 end),
  max_attempts = coalesce(max_attempts, 6),
  accepted_at = coalesce(accepted_at, sent_at)
where template_key is null
   or category is null
   or priority is null
   or payload is null
   or dispatch_status is null
   or delivery_status is null
   or attempt_count is null
   or max_attempts is null;

alter table public.transactional_email_events
  alter column template_key set not null,
  alter column template_key set default 'legacy',
  alter column category set default 'transactional',
  alter column category set not null,
  alter column priority set default 10,
  alter column priority set not null,
  alter column payload set default '{}'::jsonb,
  alter column payload set not null,
  alter column dispatch_status set default 'cancelled',
  alter column dispatch_status set not null,
  alter column delivery_status set default 'unknown',
  alter column delivery_status set not null,
  alter column attempt_count set default 0,
  alter column attempt_count set not null,
  alter column max_attempts set default 6,
  alter column max_attempts set not null,
  alter column next_attempt_at set default now();

alter table public.transactional_email_events
  add constraint transactional_email_events_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  add constraint transactional_email_events_dispatch_status_check
    check (dispatch_status in ('pending', 'processing', 'retrying', 'accepted', 'cancelled', 'dead')),
  add constraint transactional_email_events_delivery_status_check
    check (delivery_status in ('unknown', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed')),
  add constraint transactional_email_events_category_present check (btrim(category) <> ''),
  add constraint transactional_email_events_template_key_present check (btrim(template_key) <> ''),
  add constraint transactional_email_events_attempt_count_check check (attempt_count >= 0),
  add constraint transactional_email_events_max_attempts_check check (max_attempts between 1 and 20),
  add constraint transactional_email_events_lease_shape_check check (
    (dispatch_status = 'processing' and lease_token is not null and leased_at is not null and lease_expires_at is not null)
    or dispatch_status <> 'processing'
  );

create index transactional_email_events_dispatch_due
on public.transactional_email_events (priority, next_attempt_at, created_at)
where dispatch_status in ('pending', 'retrying');

create index transactional_email_events_stale_lease
on public.transactional_email_events (lease_expires_at)
where dispatch_status = 'processing';

create unique index transactional_email_events_provider_message
on public.transactional_email_events (provider, provider_message_id)
where provider_message_id is not null;

create table public.transactional_email_attempts (
  id uuid primary key default gen_random_uuid(),
  email_event_id uuid not null references public.transactional_email_events(id) on delete cascade,
  attempt_number integer not null,
  lease_token uuid not null,
  outcome text not null,
  provider_http_status integer,
  provider_message_id text,
  retryable boolean not null default false,
  retry_after_seconds integer,
  error_code text,
  error_message text,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint transactional_email_attempts_number_check check (attempt_number > 0),
  constraint transactional_email_attempts_outcome_check check (
    outcome in ('accepted', 'retry_scheduled', 'permanent_failure', 'suppressed', 'cancelled')
  ),
  constraint transactional_email_attempts_event_number_unique unique (email_event_id, attempt_number)
);

create index transactional_email_attempts_event_created
on public.transactional_email_attempts (email_event_id, created_at desc);

create table public.email_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  provider_message_id text,
  email_event_id uuid references public.transactional_email_events(id) on delete set null,
  event_type text not null,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint email_provider_events_identity_unique unique (provider, provider_event_id),
  constraint email_provider_events_type_check check (
    event_type in ('sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed')
  )
);

create index email_provider_events_message_occurred
on public.email_provider_events (provider, provider_message_id, occurred_at desc);

create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  reason text not null,
  source text not null,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  provider_event_id uuid references public.email_provider_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_suppressions_email_normalized check (email = lower(btrim(email)) and btrim(email) <> ''),
  constraint email_suppressions_reason_check check (reason in ('hard_bounce', 'complaint', 'provider_suppression', 'manual')),
  constraint email_suppressions_source_present check (btrim(source) <> ''),
  constraint email_suppressions_email_unique unique (email)
);

alter table public.transactional_email_attempts enable row level security;
alter table public.email_provider_events enable row level security;
alter table public.email_suppressions enable row level security;

revoke all on table public.transactional_email_attempts from public, anon, authenticated;
revoke all on table public.email_provider_events from public, anon, authenticated;
revoke all on table public.email_suppressions from public, anon, authenticated;
grant select, insert, update on table public.transactional_email_attempts to service_role;
grant select, insert, update on table public.email_provider_events to service_role;
grant select, insert, update on table public.email_suppressions to service_role;

create or replace function public.enqueue_transactional_email_event(
  requested_event_key text,
  requested_event_type text,
  requested_user_id uuid,
  requested_payment_order_id uuid,
  requested_payload jsonb default '{}'::jsonb,
  requested_priority smallint default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  queued_id uuid;
  was_created boolean := false;
begin
  if nullif(btrim(coalesce(requested_event_key, '')), '') is null
     or char_length(requested_event_key) > 240 then
    raise exception 'A valid email event key is required';
  end if;
  if nullif(btrim(coalesce(requested_event_type, '')), '') is null
     or char_length(requested_event_type) > 80 then
    raise exception 'A valid email event type is required';
  end if;
  if requested_user_id is null then
    raise exception 'An email event user is required';
  end if;

  insert into public.transactional_email_events (
    event_key, event_type, template_key, category, priority, user_id,
    payment_order_id, status, dispatch_status, delivery_status, metadata,
    payload, next_attempt_at
  ) values (
    requested_event_key, requested_event_type, requested_event_type,
    'transactional', greatest(1, least(coalesce(requested_priority, 10), 100)),
    requested_user_id, requested_payment_order_id, 'pending', 'pending',
    'unknown', coalesce(requested_payload, '{}'::jsonb),
    coalesce(requested_payload, '{}'::jsonb), now()
  )
  on conflict (event_key) do nothing
  returning id into queued_id;

  if queued_id is not null then
    was_created := true;
  else
    select id into queued_id
    from public.transactional_email_events
    where event_key = requested_event_key;
  end if;

  return jsonb_build_object('id', queued_id, 'created', was_created);
end;
$$;

revoke all on function public.enqueue_transactional_email_event(text, text, uuid, uuid, jsonb, smallint)
from public, anon, authenticated;
grant execute on function public.enqueue_transactional_email_event(text, text, uuid, uuid, jsonb, smallint)
to service_role;

create or replace function public.claim_transactional_email_events(
  requested_lease_token uuid,
  requested_batch_size integer default 20,
  requested_lease_seconds integer default 120
)
returns setof public.transactional_email_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if requested_lease_token is null then
    raise exception 'A lease token is required';
  end if;

  return query
  with candidates as (
    select event.id
    from public.transactional_email_events event
    where event.attempt_count < event.max_attempts
      and (
        (event.dispatch_status in ('pending', 'retrying') and coalesce(event.next_attempt_at, now()) <= now())
        or (event.dispatch_status = 'processing' and event.lease_expires_at <= now())
      )
      and not exists (
        select 1 from public.email_suppressions suppression
        where suppression.active
          and suppression.email = lower(btrim(coalesce(event.recipient_email_used, event.recipient_email, '')))
      )
    order by event.priority asc, coalesce(event.next_attempt_at, event.created_at), event.created_at
    for update skip locked
    limit greatest(1, least(coalesce(requested_batch_size, 20), 50))
  )
  update public.transactional_email_events event
  set dispatch_status = 'processing',
      lease_token = requested_lease_token,
      leased_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(requested_lease_seconds, 120), 600))),
      updated_at = now()
  from candidates
  where event.id = candidates.id
  returning event.*;
end;
$$;

revoke all on function public.claim_transactional_email_events(uuid, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_transactional_email_events(uuid, integer, integer)
to service_role;

create or replace function public.complete_transactional_email_attempt(
  requested_event_id uuid,
  requested_lease_token uuid,
  requested_outcome text,
  requested_recipient_email text,
  requested_started_at timestamptz,
  requested_provider_message_id text default null,
  requested_provider_http_status integer default null,
  requested_retryable boolean default false,
  requested_retry_after_seconds integer default null,
  requested_next_attempt_at timestamptz default null,
  requested_error_code text default null,
  requested_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.transactional_email_events;
  next_attempt_number integer;
  final_dispatch_status text;
  reconciled_delivery_status text;
  reconciled_occurred_at timestamptz;
begin
  select * into target
  from public.transactional_email_events
  where id = requested_event_id
    and dispatch_status = 'processing'
    and lease_token = requested_lease_token
  for update;

  if target.id is null then
    return jsonb_build_object('completed', false, 'reason', 'lease_lost');
  end if;
  if requested_outcome not in ('accepted', 'retry_scheduled', 'permanent_failure', 'suppressed', 'cancelled') then
    raise exception 'Choose a valid email attempt outcome';
  end if;

  next_attempt_number := target.attempt_count + 1;
  final_dispatch_status := case requested_outcome
    when 'accepted' then 'accepted'
    when 'retry_scheduled' then case when next_attempt_number >= target.max_attempts then 'dead' else 'retrying' end
    when 'permanent_failure' then 'dead'
    else 'cancelled'
  end;

  insert into public.transactional_email_attempts (
    email_event_id, attempt_number, lease_token, outcome,
    provider_http_status, provider_message_id, retryable,
    retry_after_seconds, error_code, error_message, started_at
  ) values (
    target.id, next_attempt_number, requested_lease_token,
    case when final_dispatch_status = 'dead' and requested_outcome = 'retry_scheduled'
      then 'permanent_failure' else requested_outcome end,
    requested_provider_http_status, requested_provider_message_id,
    requested_retryable, requested_retry_after_seconds,
    requested_error_code, left(requested_error_message, 500),
    coalesce(requested_started_at, now())
  );

  update public.transactional_email_events
  set recipient_email = coalesce(recipient_email, lower(btrim(requested_recipient_email))),
      recipient_email_used = lower(btrim(requested_recipient_email)),
      provider_message_id = coalesce(requested_provider_message_id, provider_message_id),
      dispatch_status = final_dispatch_status,
      delivery_status = case when requested_outcome = 'suppressed' then 'suppressed' else delivery_status end,
      status = case
        when requested_outcome = 'accepted' then 'sent'
        when requested_outcome in ('suppressed', 'cancelled') then 'skipped'
        else 'failed'
      end,
      attempt_count = next_attempt_number,
      attempted_at = now(),
      sent_at = case when requested_outcome = 'accepted' then now() else sent_at end,
      accepted_at = case when requested_outcome = 'accepted' then now() else accepted_at end,
      next_attempt_at = case when final_dispatch_status = 'retrying'
        then requested_next_attempt_at else null end,
      error_message = case when requested_outcome = 'accepted' then null else left(requested_error_message, 500) end,
      last_error_code = case when requested_outcome = 'accepted' then null else requested_error_code end,
      lease_token = null,
      leased_at = null,
      lease_expires_at = null,
      updated_at = now()
  where id = target.id;

  if requested_outcome = 'accepted' and requested_provider_message_id is not null then
    update public.email_provider_events
    set email_event_id = target.id
    where provider = target.provider
      and provider_message_id = requested_provider_message_id
      and email_event_id is null;

    select provider_event.event_type, provider_event.occurred_at
    into reconciled_delivery_status, reconciled_occurred_at
    from public.email_provider_events provider_event
    where provider_event.email_event_id = target.id
    order by
      case provider_event.event_type
        when 'complained' then 70 when 'suppressed' then 60 when 'bounced' then 50
        when 'failed' then 40 when 'delivered' then 30 when 'delayed' then 20
        when 'sent' then 10 else 0 end desc,
      provider_event.occurred_at desc
    limit 1;

    if reconciled_delivery_status is not null then
      update public.transactional_email_events
      set delivery_status = reconciled_delivery_status,
          delivered_at = case when reconciled_delivery_status = 'delivered'
            then reconciled_occurred_at else delivered_at end,
          last_provider_event_at = reconciled_occurred_at,
          updated_at = now()
      where id = target.id;
    end if;
  end if;

  return jsonb_build_object(
    'completed', true,
    'dispatch_status', final_dispatch_status,
    'attempt_count', next_attempt_number
  );
end;
$$;

revoke all on function public.complete_transactional_email_attempt(uuid, uuid, text, text, timestamptz, text, integer, boolean, integer, timestamptz, text, text)
from public, anon, authenticated;
grant execute on function public.complete_transactional_email_attempt(uuid, uuid, text, text, timestamptz, text, integer, boolean, integer, timestamptz, text, text)
to service_role;

create or replace function public.record_email_provider_event(
  requested_provider text,
  requested_provider_event_id text,
  requested_provider_message_id text,
  requested_event_type text,
  requested_occurred_at timestamptz,
  requested_recipient_email text default null,
  requested_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  provider_event_row public.email_provider_events;
  target_event public.transactional_email_events;
  normalized_type text := lower(btrim(coalesce(requested_event_type, '')));
  normalized_email text := lower(btrim(coalesce(requested_recipient_email, '')));
  current_rank integer;
  incoming_rank integer;
  suppression_reason text;
begin
  if normalized_type not in ('sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed') then
    raise exception 'Unsupported email provider event type';
  end if;

  select * into target_event
  from public.transactional_email_events
  where provider = requested_provider
    and provider_message_id = requested_provider_message_id
  limit 1;

  insert into public.email_provider_events (
    provider, provider_event_id, provider_message_id, email_event_id,
    event_type, occurred_at, metadata
  ) values (
    requested_provider, requested_provider_event_id, requested_provider_message_id,
    target_event.id, normalized_type, requested_occurred_at,
    coalesce(requested_metadata, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into provider_event_row;

  if provider_event_row.id is null then
    return jsonb_build_object('duplicate', true, 'email_event_id', target_event.id);
  end if;

  if target_event.id is not null then
    current_rank := case target_event.delivery_status
      when 'sent' then 10 when 'delayed' then 20 when 'delivered' then 30
      when 'failed' then 40 when 'bounced' then 50 when 'suppressed' then 60
      when 'complained' then 70 else 0 end;
    incoming_rank := case normalized_type
      when 'sent' then 10 when 'delayed' then 20 when 'delivered' then 30
      when 'failed' then 40 when 'bounced' then 50 when 'suppressed' then 60
      when 'complained' then 70 else 0 end;

    if incoming_rank >= current_rank then
      update public.transactional_email_events
      set delivery_status = normalized_type,
          delivered_at = case when normalized_type = 'delivered'
            then coalesce(delivered_at, requested_occurred_at) else delivered_at end,
          last_provider_event_at = greatest(coalesce(last_provider_event_at, '-infinity'::timestamptz), requested_occurred_at),
          updated_at = now()
      where id = target_event.id;
    end if;
  end if;

  suppression_reason := case normalized_type
    when 'bounced' then 'hard_bounce'
    when 'complained' then 'complaint'
    when 'suppressed' then 'provider_suppression'
    else null end;

  if suppression_reason is not null and normalized_email <> '' then
    insert into public.email_suppressions (
      email, reason, source, active, provider_event_id
    ) values (
      normalized_email, suppression_reason, requested_provider, true, provider_event_row.id
    )
    on conflict (email) do update set
      reason = excluded.reason,
      source = excluded.source,
      active = true,
      last_seen_at = now(),
      provider_event_id = excluded.provider_event_id,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'email_event_id', target_event.id,
    'provider_event_id', provider_event_row.id,
    'suppression_created', suppression_reason is not null and normalized_email <> ''
  );
end;
$$;

revoke all on function public.record_email_provider_event(text, text, text, text, timestamptz, text, jsonb)
from public, anon, authenticated;
grant execute on function public.record_email_provider_event(text, text, text, text, timestamptz, text, jsonb)
to service_role;

create or replace function public.admin_retry_transactional_email_event(requested_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.transactional_email_events;
  target_email text;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  select * into target from public.transactional_email_events where id = requested_event_id for update;
  if target.id is null then raise exception 'Email event not found'; end if;
  if target.dispatch_status <> 'dead' then raise exception 'Only dead email events can be retried'; end if;

  select lower(btrim(coalesce(au.email, target.recipient_email_used, target.recipient_email, '')))
  into target_email
  from auth.users au where au.id = target.user_id;

  if exists (select 1 from public.email_suppressions where email = target_email and active) then
    raise exception 'Resolve this recipient suppression before retrying';
  end if;

  update public.transactional_email_events
  set dispatch_status = 'retrying', status = 'pending', next_attempt_at = now(),
      max_attempts = greatest(max_attempts, attempt_count + 1),
      lease_token = null, leased_at = null, lease_expires_at = null,
      error_message = null, last_error_code = null, updated_at = now()
  where id = target.id;

  return jsonb_build_object('id', target.id, 'event_key', target.event_key, 'dispatch_status', 'retrying');
end;
$$;

revoke all on function public.admin_retry_transactional_email_event(uuid)
from public, anon;
grant execute on function public.admin_retry_transactional_email_event(uuid)
to authenticated;

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
  v_status text := lower(btrim(coalesce(requested_status, 'all')));
  v_query text := nullif(btrim(coalesce(requested_query, '')), '');
  v_limit integer := greatest(10, least(coalesce(requested_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(requested_offset, 0));
  v_total integer;
  v_items jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if v_status not in ('all', 'pending', 'processing', 'retrying', 'accepted', 'sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'suppressed', 'dead', 'cancelled') then
    raise exception 'Choose a valid email status';
  end if;
  if char_length(coalesce(v_query, '')) > 120 then raise exception 'Email search is too long'; end if;

  with states as (
    select event.*,
      case when event.delivery_status <> 'unknown' then event.delivery_status else event.dispatch_status end as display_status
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
  ) into v_counts from states;

  with matching as (
    select event.*,
      case when event.delivery_status <> 'unknown' then event.delivery_status else event.dispatch_status end as display_status,
      po.provider_reference, po.purchase_label, p.full_name, p.email as profile_email,
      public.build_payment_order_presentation(event.payment_order_id) as truth
    from public.transactional_email_events event
    left join public.payment_orders po on po.id = event.payment_order_id
    left join public.profiles p on p.id = event.user_id
  ), filtered as (
    select * from matching
    where (v_status = 'all' or display_status = v_status)
      and (v_query is null or concat_ws(
        ' ', event_type, template_key, recipient_email_used, recipient_email,
        provider_message_id, error_message, provider_reference, purchase_label,
        full_name, profile_email, truth ->> 'product_label', truth ->> 'plan_code'
      ) ilike '%' || v_query || '%')
  )
  select count(*)::integer into v_total from filtered;

  with matching as (
    select event.*,
      case when event.delivery_status <> 'unknown' then event.delivery_status else event.dispatch_status end as display_status,
      po.provider_reference, po.purchase_type, po.purchase_label,
      p.full_name as requester_name, p.email as profile_email,
      public.build_payment_order_presentation(event.payment_order_id) as truth
    from public.transactional_email_events event
    left join public.payment_orders po on po.id = event.payment_order_id
    left join public.profiles p on p.id = event.user_id
  ), filtered as (
    select * from matching
    where (v_status = 'all' or display_status = v_status)
      and (v_query is null or concat_ws(
        ' ', event_type, template_key, recipient_email_used, recipient_email,
        provider_message_id, error_message, provider_reference, purchase_label,
        requester_name, profile_email, truth ->> 'product_label', truth ->> 'plan_code'
      ) ilike '%' || v_query || '%')
  )
  select coalesce(jsonb_agg(to_jsonb(email_row)), '[]'::jsonb) into v_items
  from (
    select id, event_key, event_type, template_key, category,
      coalesce(recipient_email_used, recipient_email, profile_email) as recipient_email,
      user_id, requester_name, payment_order_id, provider_reference,
      purchase_type, purchase_label, truth ->> 'product_label' as product_label,
      truth ->> 'purchase_scope' as purchase_scope,
      (truth ->> 'duration_months')::integer as duration_months,
      truth -> 'items' as items,
      case when (truth ->> 'item_count')::integer = 1 then truth #>> '{items,0,subject_name}' end as subject_name,
      provider, provider_message_id, display_status as status,
      dispatch_status, delivery_status, attempt_count, max_attempts,
      error_message, last_error_code, attempted_at, next_attempt_at,
      accepted_at, sent_at, delivered_at, last_provider_event_at,
      created_at, updated_at
    from filtered
    order by created_at desc, id
    limit v_limit offset v_offset
  ) email_row;

  return jsonb_build_object(
    'items', v_items, 'total', v_total, 'counts', v_counts,
    'limit', v_limit, 'offset', v_offset,
    'has_more', v_offset + jsonb_array_length(v_items) < v_total
  );
end;
$$;

revoke all on function public.get_admin_transactional_email_events(text, text, integer, integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_admin_transactional_email_events(text, text, integer, integer)
to authenticated;
