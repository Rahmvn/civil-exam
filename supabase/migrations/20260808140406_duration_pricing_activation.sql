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

  select ep.* into v_pack
  from public.exam_packs ep
  where ep.id = v_order.exam_pack_id;

  -- Keep historical/support-created single-module orders fulfilable even when
  -- they predate the order-item writer used by the current Edge Function.
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
          v_item_expires_at := v_existing.expires_at;
        else
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
        end if;
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
      v_order.id,
      v_item.subject_id,
      v_item.name,
      v_item.slug,
      v_item_expires_at,
      v_already_active;
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

drop function if exists public.get_payment_history(integer);
create function public.get_payment_history(requested_limit integer default 20)
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
  refunded_amount_kobo integer,
  purchase_type text,
  purchase_label text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
  from (
    select
      po.id,
      po.provider_reference,
      po.status,
      po.amount_kobo,
      po.currency,
      greatest(coalesce(max(me.expires_at), po.access_expires_at), po.access_expires_at),
      po.created_at,
      po.paid_at,
      case when po.purchase_type = 'single_module' then po.subject_id else null end,
      case when po.purchase_type = 'single_module' then max(s.name) else null end,
      case when po.purchase_type = 'single_module' then max(s.slug) else null end,
      false,
      coalesce(po.provider_status, case when po.status = 'active' then 'success' end),
      case
        when (
          count(me.id) filter (where me.status = 'active') > 0
          or po.access_expires_at is not null
        ) and po.fulfillment_status = 'fulfilled'
          then 'fulfilled'
        else po.fulfillment_status
      end,
      case
        when po.review_status in ('refund_pending', 'disputed') then 'attention'
        when coalesce(po.provider_status, case when po.status = 'active' then 'success' end)
          in ('ongoing', 'pending', 'processing', 'queued') then 'attention'
        when coalesce(po.provider_status, case when po.status = 'active' then 'success' end) = 'success'
          and po.fulfillment_status <> 'fulfilled' then 'attention'
        else 'history'
      end,
      po.review_status,
      po.refunded_amount_kobo,
      po.purchase_type,
      po.purchase_label
    from public.payment_orders po
    left join public.payment_order_items poi on poi.payment_order_id = po.id
    left join public.subjects s on s.id = poi.subject_id
    left join public.module_entitlements me
      on me.payment_order_id = po.id and me.subject_id = poi.subject_id
    where po.user_id = auth.uid()
      and coalesce(po.provider_status, case when po.status = 'active' then 'success' end)
        in ('success', 'ongoing', 'pending', 'processing', 'queued', 'reversed')
    group by po.id

    union all

    select
      e.id, e.paystack_reference, e.status, e.amount_kobo, e.currency,
      e.expires_at, e.created_at,
      case when e.status = 'active' then e.updated_at else null end,
      null::uuid, null::text, null::text, true,
      'success', 'fulfilled', 'history', 'clear', 0,
      'legacy_full_access', 'Legacy full access'
    from public.entitlements e
    where e.user_id = auth.uid() and e.status = 'active'
  ) visible_payments
  order by visible_payments.created_at desc
  limit greatest(coalesce(requested_limit, 20), 1);
$$;

revoke all on function public.activate_module_purchase(text, jsonb) from public, anon, authenticated;
revoke all on function public.get_payment_history(integer) from public, anon;

grant execute on function public.activate_module_purchase(text, jsonb) to service_role;
grant execute on function public.get_payment_history(integer) to authenticated;
