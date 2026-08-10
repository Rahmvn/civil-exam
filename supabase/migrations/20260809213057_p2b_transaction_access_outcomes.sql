-- Phase P2B: prospective, per-item transaction impact for duration purchases.

create table public.payment_order_item_access_outcomes (
  id bigint generated always as identity primary key,
  payment_order_item_id bigint not null unique
    references public.payment_order_items(id) on delete restrict,
  payment_order_id uuid not null references public.payment_orders(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  exam_pack_id uuid not null references public.exam_packs(id) on delete restrict,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  entitlement_id uuid not null references public.module_entitlements(id) on delete restrict,
  activation_kind text not null check (activation_kind in ('new', 'extension', 'reactivation')),
  activated_at timestamptz not null,
  duration_months integer not null check (duration_months > 0),
  before_status public.payment_status,
  before_starts_at timestamptz,
  before_expires_at timestamptz,
  after_status public.payment_status not null,
  after_starts_at timestamptz not null,
  after_expires_at timestamptz not null,
  effect_state text not null default 'effective'
    check (effect_state in ('effective', 'held', 'reversed')),
  effect_state_changed_at timestamptz not null default now(),
  last_effect_provider_event_id uuid
    references public.payment_provider_events(id) on delete set null,
  created_at timestamptz not null default now(),
  check (before_expires_at is null or before_starts_at is not null),
  check (after_expires_at > after_starts_at)
);

create index payment_item_access_outcomes_order_idx
  on public.payment_order_item_access_outcomes (payment_order_id, id);
create index payment_item_access_outcomes_module_chain_idx
  on public.payment_order_item_access_outcomes
    (user_id, exam_pack_id, subject_id, activated_at, id);
create index payment_item_access_outcomes_held_idx
  on public.payment_order_item_access_outcomes
    (user_id, exam_pack_id, subject_id)
  where effect_state = 'held';

alter table public.payment_order_item_access_outcomes enable row level security;
revoke all on table public.payment_order_item_access_outcomes
from public, anon, authenticated;
grant select on table public.payment_order_item_access_outcomes to service_role;

create or replace function public.assert_modules_not_under_payment_review(
  requested_user_id uuid,
  requested_exam_pack_id uuid,
  requested_subject_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if requested_user_id is null or requested_exam_pack_id is null
    or coalesce(cardinality(requested_subject_ids), 0) = 0 then
    raise exception using
      errcode = '22023',
      message = 'Purchase modules are required';
  end if;

  if exists (
    select 1
    from public.payment_order_item_access_outcomes outcome
    where outcome.user_id = requested_user_id
      and outcome.exam_pack_id = requested_exam_pack_id
      and outcome.subject_id = any(requested_subject_ids)
      and outcome.effect_state = 'held'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Access for this module is currently under payment review.',
      detail = 'MODULE_ACCESS_UNDER_REVIEW';
  end if;
end;
$$;

revoke all on function public.assert_modules_not_under_payment_review(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.assert_modules_not_under_payment_review(uuid, uuid, uuid[])
to service_role;

create or replace function public.recompute_module_access_from_outcomes(
  requested_user_id uuid,
  requested_exam_pack_id uuid,
  requested_subject_id uuid
)
returns table (
  entitlement_id uuid,
  status public.payment_status,
  starts_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_first public.payment_order_item_access_outcomes;
  v_outcome public.payment_order_item_access_outcomes;
  v_projection_entitlement_id uuid;
  v_status public.payment_status;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_base timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    requested_user_id::text || ':' || requested_exam_pack_id::text || ':' || requested_subject_id::text,
    0
  ));

  select outcome.* into v_first
  from public.payment_order_item_access_outcomes outcome
  where outcome.user_id = requested_user_id
    and outcome.exam_pack_id = requested_exam_pack_id
    and outcome.subject_id = requested_subject_id
  order by outcome.activated_at, outcome.id
  limit 1;

  if v_first.id is null then
    raise exception 'No transaction access outcomes exist for this module';
  end if;

  v_status := v_first.before_status;
  v_starts_at := v_first.before_starts_at;
  v_expires_at := v_first.before_expires_at;
  if v_status = 'active' and v_expires_at is not null then
    v_projection_entitlement_id := v_first.entitlement_id;
  end if;

  for v_outcome in
    select outcome.*
    from public.payment_order_item_access_outcomes outcome
    where outcome.user_id = requested_user_id
      and outcome.exam_pack_id = requested_exam_pack_id
      and outcome.subject_id = requested_subject_id
    order by outcome.activated_at, outcome.id
  loop
    if v_outcome.effect_state <> 'effective' then
      continue;
    end if;

    if v_status = 'active'
      and v_expires_at is not null
      and v_expires_at > v_outcome.activated_at then
      v_base := v_expires_at;
    else
      v_base := v_outcome.activated_at;
      v_starts_at := v_outcome.activated_at;
    end if;

    v_expires_at := v_base + make_interval(months => v_outcome.duration_months);
    v_status := 'active';
    v_projection_entitlement_id := v_outcome.entitlement_id;
  end loop;

  update public.module_entitlements me
  set status = 'expired', updated_at = now()
  where me.id in (
    select distinct outcome.entitlement_id
    from public.payment_order_item_access_outcomes outcome
    where outcome.user_id = requested_user_id
      and outcome.exam_pack_id = requested_exam_pack_id
      and outcome.subject_id = requested_subject_id
  )
    and me.status in ('active', 'pending');

  if v_projection_entitlement_id is not null and v_expires_at is not null then
    v_status := case when v_expires_at > now()
      then 'active'::public.payment_status else 'expired'::public.payment_status end;
    update public.module_entitlements me
    set status = v_status,
        starts_at = v_starts_at,
        expires_at = v_expires_at,
        metadata = coalesce(me.metadata, '{}'::jsonb) || jsonb_build_object(
          'access_projection', 'payment_order_item_access_outcomes',
          'access_projection_recomputed_at', now()
        ),
        updated_at = now()
    where me.id = v_projection_entitlement_id;
  else
    v_status := 'expired';
    v_starts_at := null;
    v_expires_at := null;
  end if;

  return query select v_projection_entitlement_id, v_status, v_starts_at, v_expires_at;
end;
$$;

revoke all on function public.recompute_module_access_from_outcomes(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.recompute_module_access_from_outcomes(uuid, uuid, uuid)
to service_role;

create or replace function public.activate_module_purchase(
  requested_reference text,
  payment_payload jsonb default '{}'::jsonb
)
returns table (
  order_id uuid,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  expires_at timestamptz,
  already_active boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders;
  v_pack public.exam_packs;
  v_item record;
  v_existing public.module_entitlements;
  v_historical public.module_entitlements;
  v_entitlement_id uuid;
  v_pack_expires_at timestamptz;
  v_base_expires_at timestamptz;
  v_item_expires_at timestamptz;
  v_item_starts_at timestamptz;
  v_already_active boolean;
  v_item_count integer;
  v_order_access_starts_at timestamptz;
  v_order_access_expires_at timestamptz;
  v_activated_at timestamptz := clock_timestamp();
  v_activation_kind text;
  v_outcome public.payment_order_item_access_outcomes;
begin
  select po.* into v_order
  from public.payment_orders po
  where po.provider_reference = requested_reference
  for update;

  if v_order.id is null then raise exception 'Payment order was not found'; end if;
  if v_order.purchase_type = 'pricing_plan'
    and (v_order.purchase_plan_id is null or v_order.plan_code is null
      or v_order.duration_months not in (1, 3, 6)) then
    raise exception 'Duration pricing order is missing its plan or duration snapshot';
  end if;

  if v_order.fulfillment_status = 'fulfilled' then
    return query
    select v_order.id, poi.subject_id, s.name, s.slug,
      coalesce(outcome.after_expires_at, v_order.access_expires_at), true
    from public.payment_order_items poi
    join public.subjects s on s.id = poi.subject_id
    left join public.payment_order_item_access_outcomes outcome
      on outcome.payment_order_item_id = poi.id
    where poi.payment_order_id = v_order.id
    order by s.sort_order, s.name;
    return;
  end if;

  select ep.* into v_pack from public.exam_packs ep where ep.id = v_order.exam_pack_id;
  if v_order.purchase_type = 'single_module'
    and v_order.subject_id is not null and v_order.module_offering_id is not null then
    insert into public.payment_order_items (
      payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
    ) values (
      v_order.id, v_order.subject_id, v_order.module_offering_id,
      v_order.list_price_kobo, v_order.amount_kobo
    ) on conflict on constraint payment_order_items_payment_order_id_subject_id_key do nothing;
  end if;

  select count(*) into v_item_count from public.payment_order_items poi
  where poi.payment_order_id = v_order.id;
  if v_pack.id is null or v_item_count = 0 then
    raise exception 'Payment order is not linked to available modules';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment-order:' || v_order.id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    v_order.user_id::text || ':' || v_order.exam_pack_id::text || ':' || locked.subject_id::text, 0
  ))
  from (
    select poi.subject_id from public.payment_order_items poi
    where poi.payment_order_id = v_order.id order by poi.subject_id
  ) locked;

  perform public.assert_modules_not_under_payment_review(
    v_order.user_id,
    v_order.exam_pack_id,
    array(select poi.subject_id from public.payment_order_items poi
      where poi.payment_order_id = v_order.id order by poi.subject_id)
  );

  update public.module_entitlements me
  set status = 'expired', updated_at = now()
  where me.user_id = v_order.user_id and me.exam_pack_id = v_order.exam_pack_id
    and me.subject_id in (select poi.subject_id from public.payment_order_items poi
      where poi.payment_order_id = v_order.id)
    and me.status = 'active' and me.expires_at <= now();

  v_pack_expires_at := (v_pack.active_until::text || ' 23:59:59.999+00')::timestamptz;
  v_order_access_starts_at := coalesce(v_order.access_starts_at, v_activated_at);

  for v_item in
    select poi.id as item_id, poi.subject_id, s.name, s.slug
    from public.payment_order_items poi join public.subjects s on s.id = poi.subject_id
    where poi.payment_order_id = v_order.id order by s.sort_order, s.name, poi.id
  loop
    select outcome.* into v_outcome
    from public.payment_order_item_access_outcomes outcome
    where outcome.payment_order_item_id = v_item.item_id;
    if v_outcome.id is not null then
      return query select v_order.id, v_item.subject_id, v_item.name, v_item.slug,
        v_outcome.after_expires_at, v_outcome.activation_kind = 'extension';
      v_order_access_expires_at := greatest(
        coalesce(v_order_access_expires_at, v_outcome.after_expires_at),
        v_outcome.after_expires_at
      );
      continue;
    end if;

    v_existing := null;
    select me.* into v_existing from public.module_entitlements me
    where me.user_id = v_order.user_id and me.exam_pack_id = v_order.exam_pack_id
      and me.subject_id = v_item.subject_id and me.status = 'active'
      and me.expires_at > v_activated_at
    order by me.expires_at desc limit 1 for update;
    v_already_active := v_existing.id is not null;

    if v_order.purchase_type = 'pricing_plan' then
      if v_existing.id is not null then
        v_activation_kind := 'extension';
        v_entitlement_id := v_existing.id;
        v_base_expires_at := v_existing.expires_at;
        v_item_starts_at := v_existing.starts_at;
        v_item_expires_at := v_base_expires_at + make_interval(months => v_order.duration_months);
        update public.module_entitlements me
        set expires_at = v_item_expires_at,
            metadata = coalesce(me.metadata, '{}'::jsonb) || jsonb_build_object(
              'provider', v_order.provider, 'reference', v_order.provider_reference,
              'purchase_type', v_order.purchase_type, 'purchase_plan_id', v_order.purchase_plan_id,
              'plan_code', v_order.plan_code, 'duration_months', v_order.duration_months,
              'last_extension_order_id', v_order.id, 'last_extended_at', v_activated_at,
              'pricing_plan_order_ids', coalesce(me.metadata->'pricing_plan_order_ids', '[]'::jsonb)
                || to_jsonb(v_order.id::text)
            ), updated_at = now()
        where me.id = v_entitlement_id;
      else
        v_historical := null;
        select me.* into v_historical from public.module_entitlements me
        where me.user_id = v_order.user_id and me.exam_pack_id = v_order.exam_pack_id
          and me.subject_id = v_item.subject_id
        order by me.expires_at desc, me.created_at desc limit 1;
        v_activation_kind := case when v_historical.id is null then 'new' else 'reactivation' end;
        v_base_expires_at := v_activated_at;
        v_item_starts_at := v_activated_at;
        v_item_expires_at := v_base_expires_at + make_interval(months => v_order.duration_months);
        insert into public.module_entitlements (
          user_id, exam_pack_id, subject_id, payment_order_id, status, starts_at, expires_at, metadata
        ) values (
          v_order.user_id, v_order.exam_pack_id, v_item.subject_id, v_order.id,
          'active', v_item_starts_at, v_item_expires_at,
          jsonb_build_object(
            'provider', v_order.provider, 'reference', v_order.provider_reference,
            'purchase_type', v_order.purchase_type, 'purchase_plan_id', v_order.purchase_plan_id,
            'plan_code', v_order.plan_code, 'duration_months', v_order.duration_months,
            'pricing_plan_order_ids', jsonb_build_array(v_order.id::text)
          )
        ) returning id into v_entitlement_id;
      end if;

      insert into public.payment_order_item_access_outcomes (
        payment_order_item_id, payment_order_id, user_id, exam_pack_id, subject_id,
        entitlement_id, activation_kind, activated_at, duration_months,
        before_status, before_starts_at, before_expires_at,
        after_status, after_starts_at, after_expires_at
      ) values (
        v_item.item_id, v_order.id, v_order.user_id, v_order.exam_pack_id, v_item.subject_id,
        v_entitlement_id, v_activation_kind, v_activated_at, v_order.duration_months,
        v_existing.status, v_existing.starts_at, v_existing.expires_at,
        'active', v_item_starts_at, v_item_expires_at
      );
    else
      v_item_expires_at := coalesce(v_existing.expires_at, v_pack_expires_at);
      if not v_already_active then
        insert into public.module_entitlements (
          user_id, exam_pack_id, subject_id, payment_order_id, status, starts_at, expires_at, metadata
        ) values (
          v_order.user_id, v_order.exam_pack_id, v_item.subject_id, v_order.id,
          'active', v_activated_at, v_item_expires_at,
          jsonb_build_object('provider', v_order.provider, 'reference', v_order.provider_reference,
            'purchase_type', v_order.purchase_type, 'purchase_offer_id', v_order.purchase_offer_id)
        );
      end if;
    end if;

    v_order_access_expires_at := greatest(
      coalesce(v_order_access_expires_at, v_item_expires_at), v_item_expires_at
    );
    return query select v_order.id, v_item.subject_id, v_item.name, v_item.slug,
      v_item_expires_at, v_already_active;
  end loop;

  update public.payment_orders po
  set status = 'active', paid_at = coalesce(po.paid_at, v_activated_at),
      provider_status = 'success', provider_payload = coalesce(payment_payload, '{}'::jsonb),
      provider_checked_at = coalesce(po.provider_checked_at, now()),
      fulfillment_status = 'fulfilled', fulfillment_error = null,
      access_starts_at = case when po.purchase_type = 'pricing_plan'
        then coalesce(po.access_starts_at, v_order_access_starts_at) else po.access_starts_at end,
      access_expires_at = case when po.purchase_type = 'pricing_plan'
        then v_order_access_expires_at else po.access_expires_at end,
      updated_at = now()
  where po.id = v_order.id;
end;
$$;

revoke all on function public.activate_module_purchase(text, jsonb)
from public, anon, authenticated;
grant execute on function public.activate_module_purchase(text, jsonb) to service_role;

create or replace function public.set_payment_order_access_effect(
  requested_order_id uuid,
  requested_effect_state text,
  requested_provider_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders;
  v_item_count integer;
  v_outcome_count integer;
  v_subject_id uuid;
begin
  if requested_effect_state not in ('effective', 'held', 'reversed') then
    raise exception 'Unsupported transaction access effect state';
  end if;

  select po.* into v_order from public.payment_orders po
  where po.id = requested_order_id for update;
  if v_order.id is null then return false; end if;

  select count(*) into v_item_count from public.payment_order_items poi
  where poi.payment_order_id = v_order.id;
  select count(*) into v_outcome_count
  from public.payment_order_item_access_outcomes outcome
  where outcome.payment_order_id = v_order.id;

  if v_item_count = 0 or v_outcome_count <> v_item_count then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_order.user_id::text || ':' || v_order.exam_pack_id::text || ':' || locked.subject_id::text, 0
  ))
  from (
    select distinct outcome.subject_id
    from public.payment_order_item_access_outcomes outcome
    where outcome.payment_order_id = v_order.id
    order by outcome.subject_id
  ) locked;

  update public.payment_order_item_access_outcomes outcome
  set effect_state = requested_effect_state,
      effect_state_changed_at = now(),
      last_effect_provider_event_id = requested_provider_event_id
  where outcome.payment_order_id = v_order.id
    and (
      (requested_effect_state = 'held' and outcome.effect_state = 'effective')
      or (requested_effect_state = 'effective' and outcome.effect_state = 'held')
      or (requested_effect_state = 'reversed' and outcome.effect_state in ('effective', 'held'))
    );

  for v_subject_id in
    select distinct outcome.subject_id
    from public.payment_order_item_access_outcomes outcome
    where outcome.payment_order_id = v_order.id
    order by outcome.subject_id
  loop
    perform public.recompute_module_access_from_outcomes(
      v_order.user_id, v_order.exam_pack_id, v_subject_id
    );
  end loop;

  return true;
end;
$$;

revoke all on function public.set_payment_order_access_effect(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function public.set_payment_order_access_effect(uuid, text, uuid)
to service_role;

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
set search_path = public, pg_temp
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
  inserted_event_id uuid;
  processed_refund_total integer;
  next_review_status text;
  next_access_status public.payment_status;
  prospective_effects boolean;
  historical_safe boolean;
  partial_dispute boolean;
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

  select * into target_order from public.payment_orders
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
  ) on conflict do nothing returning id into inserted_event_id;

  if inserted_event_id is null then
    return query select target_order.id, false, target_order.review_status,
      (select me.status from public.module_entitlements me
       join public.payment_order_items poi on poi.subject_id = me.subject_id
       where poi.payment_order_id = target_order.id
         and me.user_id = target_order.user_id and me.exam_pack_id = target_order.exam_pack_id
       order by me.updated_at desc limit 1);
    return;
  end if;

  select least(target_order.amount_kobo::bigint, coalesce(sum(amount_kobo), 0))::integer
  into processed_refund_total
  from public.payment_provider_events provider_event
  where provider_event.payment_order_id = target_order.id
    and provider_event.event_type = 'refund.processed';

  prospective_effects := (
    select count(*) > 0 and count(*) = (
      select count(*) from public.payment_order_items poi where poi.payment_order_id = target_order.id
    )
    from public.payment_order_item_access_outcomes outcome
    where outcome.payment_order_id = target_order.id
  );
  historical_safe := not prospective_effects
    and public.is_historical_order_access_mutation_safe(target_order.id);
  partial_dispute := event_type like 'charge.dispute.%'
    and event_amount is not null and event_amount < target_order.amount_kobo;
  next_review_status := target_order.review_status;
  next_access_status := null;

  if event_type = 'refund.processed' then
    if processed_refund_total < target_order.amount_kobo then
      next_review_status := 'partially_refunded';
      update public.payment_orders set review_status = next_review_status,
        refunded_amount_kobo = processed_refund_total,
        provider_message = 'Payment partially refunded; access is unchanged',
        provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    elsif prospective_effects then
      perform public.set_payment_order_access_effect(target_order.id, 'reversed', inserted_event_id);
      next_review_status := 'refunded'; next_access_status := 'expired';
      update public.payment_orders set status = 'expired', provider_status = 'reversed',
        provider_message = 'Payment fully refunded', fulfillment_status = 'revoked',
        review_status = next_review_status, refunded_amount_kobo = processed_refund_total,
        provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    elsif historical_safe then
      update public.module_entitlements entitlement
      set status = 'expired', updated_at = now()
      where entitlement.payment_order_id = target_order.id
        and entitlement.status in ('active', 'pending');
      next_review_status := 'refunded'; next_access_status := 'expired';
      update public.payment_orders set status = 'expired', provider_status = 'reversed',
        provider_message = 'Payment fully refunded', fulfillment_status = 'revoked',
        review_status = next_review_status, refunded_amount_kobo = processed_refund_total,
        provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    else
      next_review_status := 'access_review';
      update public.payment_orders set status = 'expired', provider_status = 'reversed',
        provider_message = 'Payment fully refunded; access adjustment requires review',
        review_status = next_review_status, refunded_amount_kobo = processed_refund_total,
        provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    end if;
  elsif event_type in ('refund.pending', 'refund.processing', 'refund.needs-attention') then
    next_review_status := 'refund_pending';
    update public.payment_orders set review_status = next_review_status,
      provider_message = case when event_type = 'refund.needs-attention'
        then 'Refund needs attention' else 'Refund is being processed' end,
      provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type = 'refund.failed' then
    next_review_status := case when processed_refund_total > 0
      then 'partially_refunded' else 'clear' end;
    update public.payment_orders set review_status = next_review_status,
      refunded_amount_kobo = processed_refund_total,
      provider_message = 'Refund failed; payment remains successful',
      provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type in ('charge.dispute.create', 'charge.dispute.remind') then
    if target_order.review_status = 'refunded' then
      next_review_status := 'refunded';
    elsif partial_dispute then
      next_review_status := 'access_review';
    elsif prospective_effects then
      perform public.set_payment_order_access_effect(target_order.id, 'held', inserted_event_id);
      next_review_status := 'disputed'; next_access_status := 'pending';
    elsif historical_safe then
      update public.module_entitlements entitlement
      set status = 'pending', updated_at = now()
      where entitlement.payment_order_id = target_order.id
        and entitlement.status = 'active';
      next_review_status := 'disputed'; next_access_status := 'pending';
    else
      next_review_status := 'access_review';
    end if;
    update public.payment_orders set review_status = next_review_status,
      provider_message = case when next_review_status = 'access_review'
        then 'Payment dispute requires access review' else 'Payment is under dispute' end,
      provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type = 'charge.dispute.resolve' then
    if target_order.review_status = 'refunded' then
      next_review_status := 'refunded';
    elsif partial_dispute then
      next_review_status := 'access_review';
    elsif event_resolution = 'declined' and prospective_effects then
      perform public.set_payment_order_access_effect(target_order.id, 'effective', inserted_event_id);
      next_review_status := 'dispute_resolved'; next_access_status := 'active';
    elsif event_resolution = 'merchant-accepted' and prospective_effects then
      perform public.set_payment_order_access_effect(target_order.id, 'reversed', inserted_event_id);
      next_review_status := 'dispute_resolved'; next_access_status := 'expired';
      update public.payment_orders set status = 'expired', fulfillment_status = 'revoked'
      where id = target_order.id;
    elsif event_resolution = 'declined' and historical_safe then
      update public.module_entitlements entitlement
      set status = case when expires_at > now() then 'active'::public.payment_status
                        else 'expired'::public.payment_status end,
          updated_at = now()
      where entitlement.payment_order_id = target_order.id
        and entitlement.status = 'pending';
      next_review_status := 'dispute_resolved'; next_access_status := 'active';
    elsif event_resolution = 'merchant-accepted' and historical_safe then
      update public.module_entitlements entitlement
      set status = 'expired', updated_at = now()
      where entitlement.payment_order_id = target_order.id
        and entitlement.status in ('active', 'pending');
      update public.payment_orders set status = 'expired', fulfillment_status = 'revoked'
      where id = target_order.id;
      next_review_status := 'dispute_resolved'; next_access_status := 'expired';
    else
      next_review_status := 'access_review';
    end if;

    update public.payment_orders set review_status = next_review_status,
      provider_message = case
        when next_review_status = 'access_review' then 'Dispute resolution requires access review'
        when event_resolution = 'declined' then 'Dispute resolved without refund'
        else 'Dispute accepted; transaction access removed' end,
      provider_checked_at = now(), updated_at = now()
    where id = target_order.id;
  end if;

  return query select target_order.id, true, next_review_status, next_access_status;
end;
$$;

revoke all on function public.apply_paystack_post_payment_event(text, jsonb)
from public, anon, authenticated;
grant execute on function public.apply_paystack_post_payment_event(text, jsonb)
to service_role;
