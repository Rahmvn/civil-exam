-- Phase P2A: contain historical replay and lifecycle mutations before the
-- prospective transaction-impact ledger is introduced.

alter table public.payment_orders
  drop constraint if exists payment_orders_review_status_check;

alter table public.payment_orders
  add constraint payment_orders_review_status_check
    check (review_status in (
      'clear', 'refund_pending', 'partially_refunded', 'refunded',
      'disputed', 'dispute_resolved', 'access_review'
    ));

create or replace function public.is_historical_order_access_mutation_safe(
  requested_order_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with order_items as (
    select poi.subject_id
    from public.payment_order_items poi
    where poi.payment_order_id = requested_order_id
  ), direct_entitlements as (
    select me.*
    from public.module_entitlements me
    join order_items item on item.subject_id = me.subject_id
    where me.payment_order_id = requested_order_id
  )
  select
    exists (select 1 from order_items)
    and (select count(*) from direct_entitlements) = (select count(*) from order_items)
    and not exists (
      select 1
      from direct_entitlements me
      cross join lateral jsonb_array_elements_text(
        coalesce(
          me.metadata -> 'pricing_plan_order_ids',
          me.metadata -> 'pricing_plan_extension_order_ids',
          '[]'::jsonb
        )
      ) linked(order_id)
      where linked.order_id <> requested_order_id::text
    )
    and not exists (
      select 1
      from public.module_entitlements me
      join order_items item on item.subject_id = me.subject_id
      join public.payment_orders later_order
        on later_order.user_id = me.user_id
       and later_order.exam_pack_id = me.exam_pack_id
       and later_order.id <> requested_order_id
       and later_order.fulfillment_status = 'fulfilled'
      join public.payment_order_items later_item
        on later_item.payment_order_id = later_order.id
       and later_item.subject_id = item.subject_id
      where me.payment_order_id = requested_order_id
        and later_order.created_at > (
          select created_at from public.payment_orders where id = requested_order_id
        )
    );
$$;

revoke all on function public.is_historical_order_access_mutation_safe(uuid)
from public, anon, authenticated;
grant execute on function public.is_historical_order_access_mutation_safe(uuid)
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
  v_pack_expires_at timestamptz;
  v_base_expires_at timestamptz;
  v_item_expires_at timestamptz;
  v_already_active boolean;
  v_order_was_applied boolean;
  v_item_count integer;
  v_order_access_starts_at timestamptz;
  v_order_access_expires_at timestamptz;
  v_extension_order_ids jsonb;
begin
  select po.* into v_order
  from public.payment_orders po
  where po.provider_reference = requested_reference
  for update;

  if v_order.id is null then
    raise exception 'Payment order was not found';
  end if;

  if v_order.purchase_type = 'pricing_plan'
    and (v_order.purchase_plan_id is null
      or v_order.plan_code is null
      or v_order.duration_months not in (1, 3, 6)) then
    raise exception 'Duration pricing order is missing its plan or duration snapshot';
  end if;

  if v_order.fulfillment_status = 'fulfilled' then
    return query
    select
      v_order.id,
      poi.subject_id,
      s.name,
      s.slug,
      v_order.access_expires_at,
      true
    from public.payment_order_items poi
    join public.subjects s on s.id = poi.subject_id
    where poi.payment_order_id = v_order.id
    order by s.sort_order, s.name;
    return;
  end if;

  select ep.* into v_pack
  from public.exam_packs ep
  where ep.id = v_order.exam_pack_id;

  if v_order.purchase_type = 'single_module'
    and v_order.subject_id is not null
    and v_order.module_offering_id is not null then
    insert into public.payment_order_items (
      payment_order_id, subject_id, module_offering_id,
      list_price_kobo, allocated_amount_kobo
    ) values (
      v_order.id, v_order.subject_id, v_order.module_offering_id,
      v_order.list_price_kobo, v_order.amount_kobo
    )
    on conflict on constraint payment_order_items_payment_order_id_subject_id_key do nothing;
  end if;

  select count(*) into v_item_count
  from public.payment_order_items poi
  where poi.payment_order_id = v_order.id;

  if v_pack.id is null or v_item_count = 0 then
    raise exception 'Payment order is not linked to available modules';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment-order:' || v_order.id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended(v_order.user_id::text || ':' || v_order.exam_pack_id::text || ':' || locked.subject_id::text, 0)
  )
  from (
    select poi.subject_id
    from public.payment_order_items poi
    where poi.payment_order_id = v_order.id
    order by poi.subject_id
  ) locked;

  update public.module_entitlements me
  set status = 'expired', updated_at = now()
  where me.user_id = v_order.user_id
    and me.exam_pack_id = v_order.exam_pack_id
    and me.subject_id in (
      select poi.subject_id from public.payment_order_items poi
      where poi.payment_order_id = v_order.id
    )
    and me.status = 'active'
    and me.expires_at <= now();

  v_pack_expires_at := (v_pack.active_until::text || ' 23:59:59.999+00')::timestamptz;
  v_order_access_starts_at := coalesce(v_order.access_starts_at, now());

  for v_item in
    select poi.subject_id, s.name, s.slug
    from public.payment_order_items poi
    join public.subjects s on s.id = poi.subject_id
    where poi.payment_order_id = v_order.id
    order by s.sort_order, s.name
  loop
    v_existing := null;
    select me.* into v_existing
    from public.module_entitlements me
    where me.user_id = v_order.user_id
      and me.exam_pack_id = v_order.exam_pack_id
      and me.subject_id = v_item.subject_id
      and me.status = 'active'
      and me.expires_at > now()
    order by me.expires_at desc
    limit 1;

    v_already_active := v_existing.id is not null;
    v_order_was_applied := false;

    if v_order.purchase_type = 'pricing_plan' then
      if v_existing.id is not null then
        v_extension_order_ids := coalesce(
          v_existing.metadata->'pricing_plan_order_ids',
          v_existing.metadata->'pricing_plan_extension_order_ids',
          '[]'::jsonb
        );
        v_order_was_applied :=
          v_existing.payment_order_id = v_order.id
          or v_extension_order_ids ? v_order.id::text;

        if v_order_was_applied then
          raise exception 'Previously applied order is missing fulfilled state';
        end if;

        v_base_expires_at := greatest(now(), v_existing.expires_at);
        v_item_expires_at := v_base_expires_at + make_interval(months => v_order.duration_months);

        update public.module_entitlements me
        set expires_at = v_item_expires_at,
            metadata = coalesce(me.metadata, '{}'::jsonb)
              || jsonb_build_object(
                'provider', v_order.provider,
                'reference', v_order.provider_reference,
                'purchase_type', v_order.purchase_type,
                'purchase_plan_id', v_order.purchase_plan_id,
                'plan_code', v_order.plan_code,
                'duration_months', v_order.duration_months,
                'last_extension_order_id', v_order.id,
                'last_extended_at', now(),
                'pricing_plan_order_ids',
                  coalesce(me.metadata->'pricing_plan_order_ids', '[]'::jsonb) || to_jsonb(v_order.id::text)
              ),
            updated_at = now()
        where me.id = v_existing.id;
      else
        v_base_expires_at := now();
        v_item_expires_at := v_base_expires_at + make_interval(months => v_order.duration_months);

        insert into public.module_entitlements (
          user_id, exam_pack_id, subject_id, payment_order_id,
          status, starts_at, expires_at, metadata
        ) values (
          v_order.user_id, v_order.exam_pack_id, v_item.subject_id, v_order.id,
          'active', v_base_expires_at, v_item_expires_at,
          jsonb_build_object(
            'provider', v_order.provider,
            'reference', v_order.provider_reference,
            'purchase_type', v_order.purchase_type,
            'purchase_plan_id', v_order.purchase_plan_id,
            'plan_code', v_order.plan_code,
            'duration_months', v_order.duration_months,
            'pricing_plan_order_ids', jsonb_build_array(v_order.id::text)
          )
        );
      end if;
    else
      v_item_expires_at := coalesce(v_existing.expires_at, v_pack_expires_at);
      if not v_already_active then
        insert into public.module_entitlements (
          user_id, exam_pack_id, subject_id, payment_order_id,
          status, starts_at, expires_at, metadata
        ) values (
          v_order.user_id, v_order.exam_pack_id, v_item.subject_id, v_order.id,
          'active', now(), v_item_expires_at,
          jsonb_build_object(
            'provider', v_order.provider,
            'reference', v_order.provider_reference,
            'purchase_type', v_order.purchase_type,
            'purchase_offer_id', v_order.purchase_offer_id
          )
        );
      end if;
    end if;

    v_order_access_expires_at := greatest(
      coalesce(v_order_access_expires_at, v_item_expires_at),
      v_item_expires_at
    );

    return query select
      v_order.id, v_item.subject_id, v_item.name, v_item.slug,
      v_item_expires_at, v_already_active;
  end loop;

  update public.payment_orders po
  set status = 'active',
      paid_at = coalesce(po.paid_at, now()),
      provider_status = 'success',
      provider_payload = coalesce(payment_payload, '{}'::jsonb),
      provider_checked_at = coalesce(po.provider_checked_at, now()),
      fulfillment_status = 'fulfilled',
      fulfillment_error = null,
      access_starts_at = case
        when po.purchase_type = 'pricing_plan' then coalesce(po.access_starts_at, v_order_access_starts_at)
        else po.access_starts_at
      end,
      access_expires_at = case
        when po.purchase_type = 'pricing_plan' then v_order_access_expires_at
        else po.access_expires_at
      end,
      updated_at = now()
  where po.id = v_order.id;
end;
$$;

revoke all on function public.activate_module_purchase(text, jsonb)
from public, anon, authenticated;
grant execute on function public.activate_module_purchase(text, jsonb)
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
  access_mutation_safe boolean;
  is_partial_dispute boolean;
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

  if inserted_event_id is null then
    return query select target_order.id, false, target_order.review_status,
      (select me.status from public.module_entitlements me
       join public.payment_order_items poi on poi.subject_id = me.subject_id
       where poi.payment_order_id = target_order.id
         and me.user_id = target_order.user_id
         and me.exam_pack_id = target_order.exam_pack_id
       order by me.updated_at desc limit 1);
    return;
  end if;

  select least(target_order.amount_kobo::bigint, coalesce(sum(amount_kobo), 0))::integer
  into processed_refund_total
  from public.payment_provider_events
  where payment_provider_events.payment_order_id = target_order.id
    and payment_provider_events.event_type = 'refund.processed';

  access_mutation_safe := public.is_historical_order_access_mutation_safe(target_order.id);
  is_partial_dispute := event_type like 'charge.dispute.%'
    and event_amount is not null and event_amount < target_order.amount_kobo;
  next_review_status := target_order.review_status;
  next_access_status := null;

  if event_type = 'refund.processed' then
    if processed_refund_total >= target_order.amount_kobo then
      if access_mutation_safe then
        update public.module_entitlements me
        set status = 'expired', updated_at = now()
        where me.payment_order_id = target_order.id and me.status in ('active', 'pending');
        next_review_status := 'refunded';
        next_access_status := 'expired';
      else
        next_review_status := 'access_review';
      end if;
      update public.payment_orders
      set status = 'expired', provider_status = 'reversed',
          provider_message = case when access_mutation_safe
            then 'Payment fully refunded'
            else 'Payment fully refunded; access adjustment requires review' end,
          fulfillment_status = case when access_mutation_safe then 'revoked' else fulfillment_status end,
          review_status = next_review_status,
          refunded_amount_kobo = processed_refund_total,
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    else
      next_review_status := 'partially_refunded';
      update public.payment_orders
      set review_status = next_review_status,
          refunded_amount_kobo = processed_refund_total,
          provider_message = 'Payment partially refunded; access is unchanged',
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    end if;
  elsif event_type in ('refund.pending', 'refund.processing', 'refund.needs-attention') then
    next_review_status := 'refund_pending';
    update public.payment_orders
    set review_status = next_review_status,
        provider_message = case when event_type = 'refund.needs-attention'
          then 'Refund needs attention' else 'Refund is being processed' end,
        provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type = 'refund.failed' then
    next_review_status := case when processed_refund_total > 0
      then 'partially_refunded' else 'clear' end;
    update public.payment_orders
    set review_status = next_review_status,
        refunded_amount_kobo = processed_refund_total,
        provider_message = 'Refund failed; payment remains successful',
        provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type in ('charge.dispute.create', 'charge.dispute.remind') then
    if access_mutation_safe and not is_partial_dispute then
      update public.module_entitlements me
      set status = 'pending', updated_at = now()
      where me.payment_order_id = target_order.id and me.status = 'active';
      next_review_status := 'disputed';
      next_access_status := 'pending';
    else
      next_review_status := 'access_review';
    end if;
    update public.payment_orders
    set review_status = next_review_status,
        provider_message = case when next_review_status = 'access_review'
          then 'Payment dispute requires access review'
          else 'Payment is under dispute' end,
        provider_checked_at = now(), updated_at = now()
    where id = target_order.id and review_status <> 'refunded';
  elsif event_type = 'charge.dispute.resolve' then
    if is_partial_dispute or not access_mutation_safe then
      next_review_status := 'access_review';
      update public.payment_orders
      set review_status = next_review_status,
          provider_message = 'Dispute resolution requires access review',
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    elsif event_resolution = 'merchant-accepted' then
      next_review_status := 'dispute_resolved';
      next_access_status := 'expired';
      update public.module_entitlements me
      set status = 'expired', updated_at = now()
      where me.payment_order_id = target_order.id and me.status in ('active', 'pending');
      update public.payment_orders
      set status = 'expired', fulfillment_status = 'revoked',
          review_status = next_review_status,
          provider_message = 'Dispute accepted; transaction access removed',
          provider_checked_at = now(), updated_at = now()
      where id = target_order.id;
    elsif event_resolution = 'declined' then
      next_review_status := 'dispute_resolved';
      update public.module_entitlements me
      set status = case when me.expires_at > now() then 'active'::public.payment_status
                        else 'expired'::public.payment_status end,
          updated_at = now()
      where me.payment_order_id = target_order.id and me.status = 'pending';
      next_access_status := case when exists (
        select 1 from public.module_entitlements me
        where me.payment_order_id = target_order.id and me.status = 'active'
      ) then 'active'::public.payment_status else 'expired'::public.payment_status end;
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
