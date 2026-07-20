alter table public.payment_orders
  add column if not exists review_status text not null default 'clear',
  add column if not exists refunded_amount_kobo integer not null default 0;

alter table public.payment_orders
  drop constraint if exists payment_orders_review_status_check,
  drop constraint if exists payment_orders_refunded_amount_check;

alter table public.payment_orders
  add constraint payment_orders_review_status_check
    check (review_status in (
      'clear', 'refund_pending', 'partially_refunded', 'refunded',
      'disputed', 'dispute_resolved'
    )),
  add constraint payment_orders_refunded_amount_check
    check (refunded_amount_kobo between 0 and amount_kobo);

create table public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.payment_orders(id) on delete cascade,
  provider text not null default 'paystack',
  event_key text not null unique,
  event_type text not null,
  provider_object_key text,
  event_status text,
  resolution text,
  amount_kobo integer,
  currency text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  check (amount_kobo is null or amount_kobo > 0)
);

create unique index payment_provider_events_provider_object
on public.payment_provider_events (payment_order_id, event_type, provider_object_key)
where provider_object_key is not null;

create index payment_provider_events_order_received
on public.payment_provider_events (payment_order_id, received_at desc);

alter table public.payment_provider_events enable row level security;

revoke all on table public.payment_provider_events from public, anon, authenticated;
grant select, insert on table public.payment_provider_events to service_role;

create or replace function public.apply_paystack_post_payment_event(
  requested_event_key text,
  requested_payload jsonb
)
returns table (
  payment_order_id uuid,
  event_applied boolean,
  resulting_review_status text,
  resulting_access_status public.payment_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type text := lower(trim(coalesce(requested_payload ->> 'event', '')));
  event_data jsonb := coalesce(requested_payload -> 'data', '{}'::jsonb);
  transaction_data jsonb;
  transaction_reference text;
  event_status text;
  event_resolution text;
  event_currency text;
  event_amount integer;
  provider_object_key text;
  target_order public.payment_orders%rowtype;
  target_entitlement public.module_entitlements%rowtype;
  inserted_event_id uuid;
  processed_refund_total integer;
  next_review_status text;
  next_access_status public.payment_status;
begin
  if requested_event_key is null or requested_event_key !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid Paystack event fingerprint is required';
  end if;

  if event_type like 'refund.%' then
    transaction_reference := nullif(trim(event_data ->> 'transaction_reference'), '');
    event_status := lower(trim(coalesce(event_data ->> 'status', split_part(event_type, '.', 2))));
    event_currency := upper(trim(coalesce(event_data ->> 'currency', '')));
    provider_object_key := nullif(trim(coalesce(event_data ->> 'refund_reference', event_data ->> 'id')), '');
    if coalesce(event_data ->> 'amount', '') !~ '^\d+$' then
      raise exception 'Refund amount must be a positive integer';
    end if;
    event_amount := (event_data ->> 'amount')::integer;
  elsif event_type in ('charge.dispute.create', 'charge.dispute.remind', 'charge.dispute.resolve') then
    transaction_data := coalesce(event_data -> 'transaction', '{}'::jsonb);
    transaction_reference := nullif(trim(transaction_data ->> 'reference'), '');
    event_status := lower(trim(coalesce(event_data ->> 'status', '')));
    event_resolution := lower(trim(coalesce(event_data ->> 'resolution', '')));
    event_currency := upper(trim(coalesce(transaction_data ->> 'currency', event_data ->> 'currency', '')));
    provider_object_key := nullif(trim(coalesce(event_data ->> 'id', event_data ->> 'dispute_code')), '');
    if coalesce(transaction_data ->> 'amount', '') ~ '^\d+$' then
      event_amount := (transaction_data ->> 'amount')::integer;
    end if;
  else
    raise exception 'Unsupported Paystack post-payment event';
  end if;

  if transaction_reference is null then
    raise exception 'Paystack event does not identify a transaction reference';
  end if;

  select * into target_order
  from public.payment_orders
  where provider = 'paystack' and provider_reference = transaction_reference
  for update;

  if not found then
    return query select null::uuid, false, null::text, null::public.payment_status;
    return;
  end if;

  if event_currency <> target_order.currency then
    raise exception 'Paystack event currency does not match the payment order';
  end if;
  if event_amount is not null and (event_amount <= 0 or event_amount > target_order.amount_kobo) then
    raise exception 'Paystack event amount is outside the payment order amount';
  end if;

  insert into public.payment_provider_events (
    payment_order_id, event_key, event_type, provider_object_key,
    event_status, resolution, amount_kobo, currency, payload
  ) values (
    target_order.id, requested_event_key, event_type, provider_object_key,
    nullif(event_status, ''), nullif(event_resolution, ''), event_amount,
    event_currency, requested_payload
  )
  on conflict do nothing
  returning id into inserted_event_id;

  select * into target_entitlement
  from public.module_entitlements as entitlement
  where entitlement.payment_order_id = target_order.id
  for update;

  if inserted_event_id is null then
    return query select target_order.id, false, target_order.review_status, target_entitlement.status;
    return;
  end if;

  select least(target_order.amount_kobo::bigint, coalesce(sum(amount_kobo), 0))::integer
  into processed_refund_total
  from public.payment_provider_events
  where payment_provider_events.payment_order_id = target_order.id
    and payment_provider_events.event_type = 'refund.processed';

  next_review_status := target_order.review_status;
  next_access_status := target_entitlement.status;

  if event_type = 'refund.processed' then
    if processed_refund_total >= target_order.amount_kobo then
      next_review_status := 'refunded';
      next_access_status := 'expired';
      update public.module_entitlements
      set status = 'expired', updated_at = now()
      where module_entitlements.payment_order_id = target_order.id and status in ('active', 'pending');
      update public.payment_orders
      set status = 'expired', provider_status = 'reversed',
          provider_message = 'Payment fully refunded',
          fulfillment_status = 'revoked', review_status = next_review_status,
          refunded_amount_kobo = processed_refund_total,
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    else
      next_review_status := 'partially_refunded';
      update public.payment_orders
      set review_status = next_review_status,
          refunded_amount_kobo = processed_refund_total,
          provider_message = 'Payment partially refunded',
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    end if;
  elsif event_type in ('refund.pending', 'refund.processing', 'refund.needs-attention') then
    next_review_status := 'refund_pending';
    update public.payment_orders
    set review_status = next_review_status,
        provider_message = case
          when event_type = 'refund.needs-attention' then 'Refund needs attention'
          else 'Refund is being processed'
        end,
        provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type = 'refund.failed' then
    next_review_status := case
      when processed_refund_total > 0 then 'partially_refunded'
      else 'clear'
    end;
    update public.payment_orders
    set review_status = next_review_status,
        refunded_amount_kobo = processed_refund_total,
        provider_message = 'Refund failed; payment remains successful',
        provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type in ('charge.dispute.create', 'charge.dispute.remind') then
    next_review_status := 'disputed';
    if target_entitlement.id is not null and target_entitlement.status = 'active' then
      update public.module_entitlements
      set status = 'pending', updated_at = now()
      where id = target_entitlement.id;
      next_access_status := 'pending';
    end if;
    update public.payment_orders
    set review_status = next_review_status,
        provider_message = 'Payment is under dispute',
        provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type = 'charge.dispute.resolve' then
    if event_resolution = 'merchant-accepted' then
      next_review_status := 'dispute_resolved';
      next_access_status := 'expired';
      update public.module_entitlements
      set status = 'expired', updated_at = now()
      where module_entitlements.payment_order_id = target_order.id and status in ('active', 'pending');
      update public.payment_orders
      set status = 'expired', fulfillment_status = 'revoked',
          review_status = next_review_status,
          provider_message = 'Dispute accepted; access revoked',
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    elsif event_resolution = 'declined' and target_order.review_status <> 'refunded' then
      next_review_status := 'dispute_resolved';
      if target_entitlement.id is not null and target_entitlement.expires_at > now() then
        if not exists (
          select 1 from public.module_entitlements other
          where other.id <> target_entitlement.id
            and other.user_id = target_entitlement.user_id
            and other.exam_pack_id = target_entitlement.exam_pack_id
            and other.subject_id = target_entitlement.subject_id
            and other.status = 'active'
        ) then
          update public.module_entitlements
          set status = 'active', updated_at = now()
          where id = target_entitlement.id and status = 'pending';
          next_access_status := 'active';
        else
          update public.module_entitlements
          set status = 'expired', updated_at = now()
          where id = target_entitlement.id and status = 'pending';
          next_access_status := 'expired';
        end if;
      end if;
      update public.payment_orders
      set review_status = next_review_status,
          provider_message = 'Dispute resolved without refund',
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    end if;
  end if;

  return query select target_order.id, true, next_review_status, next_access_status;
end;
$$;

revoke all on function public.apply_paystack_post_payment_event(text, jsonb)
from public, anon, authenticated;
grant execute on function public.apply_paystack_post_payment_event(text, jsonb)
to service_role;

drop function if exists public.get_payment_history(integer);

create or replace function public.get_payment_history(requested_limit integer default 20)
returns table (
  id uuid,
  provider_reference text,
  status public.payment_status,
  amount_kobo integer,
  currency text,
  access_expires_at timestamptz,
  created_at timestamptz,
  paid_at timestamptz,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  is_legacy_full_access boolean,
  provider_status text,
  fulfillment_status text,
  record_type text,
  review_status text,
  refunded_amount_kobo integer
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from (
    select
      po.id,
      po.provider_reference,
      po.status,
      po.amount_kobo,
      po.currency,
      me.expires_at,
      po.created_at,
      po.paid_at,
      po.subject_id,
      s.name,
      s.slug,
      false,
      coalesce(po.provider_status, case when po.status = 'active' then 'success' end),
      case when me.id is not null and me.status = 'active' then 'fulfilled' else po.fulfillment_status end,
      case
        when po.review_status in ('refund_pending', 'disputed') then 'attention'
        when coalesce(po.provider_status, case when po.status = 'active' then 'success' end)
          in ('ongoing', 'pending', 'processing', 'queued') then 'attention'
        when coalesce(po.provider_status, case when po.status = 'active' then 'success' end) = 'success'
          and po.review_status = 'clear'
          and not (po.fulfillment_status = 'fulfilled' or (me.id is not null and me.status = 'active')) then 'attention'
        else 'history'
      end,
      po.review_status,
      po.refunded_amount_kobo
    from public.payment_orders as po
    join public.subjects as s on s.id = po.subject_id
    left join public.module_entitlements as me on me.payment_order_id = po.id
    where po.user_id = auth.uid()
      and coalesce(po.provider_status, case when po.status = 'active' then 'success' end)
        in ('success', 'ongoing', 'pending', 'processing', 'queued', 'reversed')

    union all

    select
      e.id,
      e.paystack_reference,
      e.status,
      e.amount_kobo,
      e.currency,
      e.expires_at,
      e.created_at,
      case when e.status = 'active' then e.updated_at else null end,
      null::uuid,
      null::text,
      null::text,
      true,
      'success',
      'fulfilled',
      'history',
      'clear',
      0
    from public.entitlements as e
    where e.user_id = auth.uid()
      and e.status = 'active'
  ) as visible_payments
  order by visible_payments.created_at desc
  limit greatest(coalesce(requested_limit, 20), 1);
$$;

revoke all on function public.get_payment_history(integer) from public, anon;
grant execute on function public.get_payment_history(integer) to authenticated;
