alter table public.payment_orders
  add column if not exists provider_status text,
  add column if not exists provider_message text,
  add column if not exists gateway_response_code text,
  add column if not exists provider_checked_at timestamptz,
  add column if not exists fulfillment_status text not null default 'not_started',
  add column if not exists fulfillment_error text;

alter table public.payment_orders
  drop constraint if exists payment_orders_fulfillment_status_check;

alter table public.payment_orders
  add constraint payment_orders_fulfillment_status_check
  check (fulfillment_status in ('not_started', 'pending', 'fulfilled', 'failed', 'revoked'));

-- Existing active orders have already been verified and fulfilled. For other
-- orders, only copy a recognized transaction status from the saved provider
-- response; the top-level Paystack API status is not a transaction status.
update public.payment_orders as po
set provider_status = case
      when po.status = 'active' then 'success'
      when lower(coalesce(
        po.provider_payload #>> '{data,status}',
        po.provider_payload ->> 'status'
      )) in ('abandoned', 'failed', 'ongoing', 'pending', 'processing', 'queued', 'reversed', 'success')
        then lower(coalesce(
          po.provider_payload #>> '{data,status}',
          po.provider_payload ->> 'status'
        ))
      else null
    end,
    provider_message = nullif(coalesce(
      po.provider_payload #>> '{data,gateway_response}',
      po.provider_payload #>> '{data,message}',
      po.provider_payload ->> 'message'
    ), ''),
    gateway_response_code = nullif(coalesce(
      po.provider_payload #>> '{data,gateway_response_code}',
      po.provider_payload ->> 'gateway_response_code'
    ), ''),
    provider_checked_at = case
      when po.status = 'active' or po.provider_payload <> '{}'::jsonb then po.updated_at
      else null
    end,
    fulfillment_status = case
      when po.status = 'active' or exists (
        select 1
        from public.module_entitlements as me
        where me.payment_order_id = po.id
          and me.status = 'active'
      ) then 'fulfilled'
      else 'not_started'
    end;

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
  record_type text
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
        when coalesce(po.provider_status, case when po.status = 'active' then 'success' end)
          in ('ongoing', 'pending', 'processing', 'queued') then 'attention'
        when coalesce(po.provider_status, case when po.status = 'active' then 'success' end) = 'success'
          and not (po.fulfillment_status = 'fulfilled' or (me.id is not null and me.status = 'active')) then 'attention'
        else 'history'
      end
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
      'history'
    from public.entitlements as e
    where e.user_id = auth.uid()
      and e.status = 'active'
  ) as visible_payments
  order by visible_payments.created_at desc
  limit greatest(coalesce(requested_limit, 20), 1);
$$;

grant execute on function public.get_payment_history(integer) to authenticated;

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
set search_path = public
as $$
declare
  v_order public.payment_orders;
  v_pack public.exam_packs;
  v_subject public.subjects;
  v_existing public.module_entitlements;
  v_expires_at timestamptz;
  v_already_active boolean := false;
begin
  select po.* into v_order
  from public.payment_orders as po
  where po.provider_reference = requested_reference
  for update;

  if v_order.id is null then
    raise exception 'Payment order was not found';
  end if;

  select ep.* into v_pack from public.exam_packs as ep where ep.id = v_order.exam_pack_id;
  select s.* into v_subject from public.subjects as s where s.id = v_order.subject_id;

  if v_pack.id is null or v_subject.id is null then
    raise exception 'Payment order is not linked to an available module';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_order.user_id::text || ':' || v_order.exam_pack_id::text || ':' || v_order.subject_id::text,
      0
    )
  );

  v_expires_at := (v_pack.active_until::text || ' 23:59:59.999+00')::timestamptz;

  select me.* into v_existing
  from public.module_entitlements as me
  where me.user_id = v_order.user_id
    and me.exam_pack_id = v_order.exam_pack_id
    and me.subject_id = v_order.subject_id
    and me.status = 'active'
    and me.expires_at > now()
  order by me.expires_at desc
  limit 1;

  v_already_active := v_existing.id is not null;

  update public.payment_orders as po
  set status = 'active',
      paid_at = coalesce(po.paid_at, now()),
      provider_status = 'success',
      provider_payload = coalesce(payment_payload, '{}'::jsonb),
      provider_checked_at = coalesce(po.provider_checked_at, now()),
      fulfillment_status = 'fulfilled',
      fulfillment_error = null,
      updated_at = now()
  where po.id = v_order.id;

  if not v_already_active then
    insert into public.module_entitlements (
      user_id,
      exam_pack_id,
      subject_id,
      payment_order_id,
      status,
      starts_at,
      expires_at,
      metadata
    ) values (
      v_order.user_id,
      v_order.exam_pack_id,
      v_order.subject_id,
      v_order.id,
      'active',
      now(),
      v_expires_at,
      jsonb_build_object('provider', v_order.provider, 'reference', v_order.provider_reference)
    );
  else
    v_expires_at := v_existing.expires_at;
  end if;

  return query select
    v_order.id,
    v_subject.id,
    v_subject.name,
    v_subject.slug,
    v_expires_at,
    v_already_active;
end;
$$;

grant execute on function public.activate_module_purchase(text, jsonb) to service_role;
