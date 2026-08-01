-- Bundle offers and immutable multi-module payment orders.
-- Existing single-module orders remain valid and are backfilled with one item.

create table public.purchase_offers (
  id uuid primary key default gen_random_uuid(),
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  offer_type text not null check (offer_type in ('pick_n_modules', 'full_bundle')),
  selection_count integer,
  price_kobo integer not null check (price_kobo > 0),
  currency text not null default 'NGN'
    check (currency = upper(currency) and char_length(currency) = 3),
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (offer_type = 'pick_n_modules' and selection_count between 2 and 10)
    or (offer_type = 'full_bundle' and selection_count is null)
  ),
  check ((starts_at is null and ends_at is null) or starts_at is not null),
  check (ends_at is null or ends_at > starts_at)
);

create index purchase_offers_pack_active_idx
  on public.purchase_offers (exam_pack_id, starts_at, ends_at)
  where enabled = true;

create trigger purchase_offers_touch_updated_at
before update on public.purchase_offers
for each row execute function public.touch_updated_at();

alter table public.purchase_offers enable row level security;
revoke all on table public.purchase_offers from public, anon, authenticated;
grant select, insert, update, delete on table public.purchase_offers to service_role;

alter table public.payment_orders
  add column purchase_type text not null default 'single_module',
  add column purchase_offer_id uuid references public.purchase_offers(id),
  add column purchase_label text,
  add column checkout_key text;

update public.payment_orders
set checkout_key = 'legacy:' || provider_reference,
    purchase_label = coalesce(purchase_label, 'Module access')
where checkout_key is null or purchase_label is null;

alter table public.payment_orders
  alter column checkout_key set default ('legacy:' || gen_random_uuid()::text),
  alter column checkout_key set not null,
  alter column subject_id drop not null,
  alter column module_offering_id drop not null,
  drop constraint if exists payment_orders_pricing_type_check,
  drop constraint if exists payment_orders_launch_price_context_check,
  drop constraint if exists payment_orders_purchase_type_check,
  drop constraint if exists payment_orders_purchase_context_check;

alter table public.payment_orders
  add constraint payment_orders_pricing_type_check
    check (pricing_type in ('regular', 'launch_offer', 'bundle_offer')),
  add constraint payment_orders_launch_price_context_check
    check (
      (pricing_type in ('regular', 'bundle_offer') and launch_offer_ends_at is null)
      or (pricing_type = 'launch_offer' and launch_offer_ends_at is not null)
    ),
  add constraint payment_orders_purchase_type_check
    check (purchase_type in ('single_module', 'bundle_offer')),
  add constraint payment_orders_purchase_context_check
    check (
      (purchase_type = 'single_module'
        and subject_id is not null
        and module_offering_id is not null
        and purchase_offer_id is null)
      or
      (purchase_type = 'bundle_offer'
        and subject_id is null
        and module_offering_id is null
        and purchase_offer_id is not null)
    );

drop index if exists public.payment_orders_one_live_checkout;
create unique index payment_orders_one_live_checkout
  on public.payment_orders (user_id, exam_pack_id, checkout_key)
  where status = 'pending'
    and provider_status in ('initializing', 'initialized');

create index payment_orders_purchase_offer_idx
  on public.payment_orders (purchase_offer_id)
  where purchase_offer_id is not null;

create table public.payment_order_items (
  id bigint generated always as identity primary key,
  payment_order_id uuid not null references public.payment_orders(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  module_offering_id uuid not null references public.module_offerings(id),
  list_price_kobo integer not null check (list_price_kobo > 0),
  allocated_amount_kobo integer not null check (allocated_amount_kobo >= 0),
  created_at timestamptz not null default now(),
  unique (payment_order_id, subject_id)
);

create index payment_order_items_subject_idx
  on public.payment_order_items (subject_id);
create index payment_order_items_offering_idx
  on public.payment_order_items (module_offering_id);

insert into public.payment_order_items (
  payment_order_id,
  subject_id,
  module_offering_id,
  list_price_kobo,
  allocated_amount_kobo
)
select
  po.id,
  po.subject_id,
  po.module_offering_id,
  coalesce(po.list_price_kobo, po.amount_kobo),
  po.amount_kobo
from public.payment_orders po
where po.subject_id is not null
  and po.module_offering_id is not null
on conflict (payment_order_id, subject_id) do nothing;

alter table public.payment_order_items enable row level security;
revoke all on table public.payment_order_items from public, anon, authenticated;
grant select, insert on table public.payment_order_items to service_role;

alter table public.module_entitlements
  drop constraint if exists module_entitlements_payment_order_id_key;

create unique index if not exists module_entitlements_order_subject_idx
  on public.module_entitlements (payment_order_id, subject_id)
  where payment_order_id is not null;

create or replace function public.get_bundle_offer_catalog()
returns table (
  offer_id uuid,
  offer_name text,
  offer_type text,
  selection_count integer,
  price_kobo integer,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  available_module_count integer,
  list_price_kobo integer,
  modules jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  return query
  with catalog as (
    select c.*
    from public.get_module_access_catalog_v2() c
    where c.can_purchase = true
  ),
  access_totals as (
    select count(*) filter (where c.has_module_access)::integer as owned_count
    from catalog c
  ),
  available as (
    select c.*
    from catalog c
    where c.has_module_access = false
  ),
  available_summary as (
    select
      count(*)::integer as module_count,
      coalesce(sum(a.price_kobo), 0)::integer as total_price_kobo,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'subject_id', a.subject_id,
            'subject_name', a.subject_name,
            'subject_slug', a.subject_slug,
            'price_kobo', a.price_kobo,
            'regular_price_kobo', a.regular_price_kobo,
            'currency', a.currency
          ) order by a.subject_name
        ),
        '[]'::jsonb
      ) as modules
    from available a
  )
  select
    po.id,
    po.name,
    po.offer_type,
    po.selection_count,
    po.price_kobo,
    po.currency,
    po.starts_at,
    po.ends_at,
    summary.module_count,
    case when po.offer_type = 'full_bundle' then summary.total_price_kobo else null end,
    summary.modules
  from public.purchase_offers po
  join public.exam_packs ep on ep.id = po.exam_pack_id and ep.is_active = true
  cross join available_summary summary
  cross join access_totals totals
  where po.enabled = true
    and (po.starts_at is null or now() >= po.starts_at)
    and (po.ends_at is null or now() < po.ends_at)
    and po.currency = 'NGN'
    and (
      (po.offer_type = 'pick_n_modules'
        and summary.module_count >= po.selection_count
        and po.price_kobo < (
          select sum(cheapest.price_kobo)
          from (
            select a.price_kobo
            from available a
            order by a.price_kobo, a.subject_id
            limit po.selection_count
          ) cheapest
        ))
      or
      (po.offer_type = 'full_bundle'
        and totals.owned_count = 0
        and summary.module_count > 0
        and po.price_kobo < summary.total_price_kobo)
    )
  order by case po.offer_type when 'pick_n_modules' then 1 else 2 end, po.price_kobo;
end;
$$;

create or replace function public.get_admin_purchase_offers()
returns table (
  offer_id uuid,
  offer_name text,
  offer_type text,
  selection_count integer,
  price_kobo integer,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean,
  status text,
  eligible_module_count integer,
  minimum_comparison_price_kobo integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  return query
  with active_modules as (
    select mo.exam_pack_id, mo.price_kobo,
      row_number() over (partition by mo.exam_pack_id order by mo.price_kobo, mo.id) as price_rank
    from public.module_offerings mo
    join public.subjects s on s.id = mo.subject_id
    where mo.is_active = true
      and mo.currency = 'NGN'
      and s.is_active = true
      and s.lifecycle_status = 'active'
      and s.candidate_availability = 'available'
      and exists (
        select 1
        from public.practice_sets ps
        where ps.exam_pack_id = mo.exam_pack_id
          and ps.subject_id = mo.subject_id
          and ps.status = 'published'
          and (
            exists (select 1 from public.questions q where q.practice_set_id = ps.id and q.status = 'published')
            or exists (select 1 from public.oral_questions oq where oq.practice_set_id = ps.id and oq.status = 'published')
          )
      )
  ),
  module_totals as (
    select
      am.exam_pack_id,
      count(*)::integer as module_count,
      sum(am.price_kobo)::integer as full_price_kobo
    from active_modules am
    group by am.exam_pack_id
  )
  select
    po.id,
    po.name,
    po.offer_type,
    po.selection_count,
    po.price_kobo,
    po.currency,
    po.starts_at,
    po.ends_at,
    po.enabled,
    case
      when not po.enabled then 'inactive'
      when po.starts_at is not null and now() < po.starts_at then 'scheduled'
      when po.ends_at is not null and now() >= po.ends_at then 'ended'
      else 'live'
    end,
    coalesce(mt.module_count, 0),
    case
      when po.offer_type = 'full_bundle' then mt.full_price_kobo
      else (
        select sum(priced.price_kobo)::integer
        from (
          select am.price_kobo
          from active_modules am
          where am.exam_pack_id = po.exam_pack_id
          order by am.price_kobo
          limit po.selection_count
        ) priced
      )
    end,
    po.updated_at
  from public.purchase_offers po
  join public.exam_packs ep on ep.id = po.exam_pack_id and ep.is_active = true
  left join module_totals mt on mt.exam_pack_id = po.exam_pack_id
  order by po.created_at;
end;
$$;

create or replace function public.admin_save_purchase_offer(
  requested_offer_id uuid,
  requested_name text,
  requested_offer_type text,
  requested_selection_count integer,
  requested_price_kobo integer,
  requested_starts_at timestamptz,
  requested_ends_at timestamptz,
  requested_enabled boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_pack_id uuid;
  saved_offer_id uuid;
  eligible_count integer;
  comparison_price integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if char_length(btrim(coalesce(requested_name, ''))) not between 2 and 80 then
    raise exception 'Offer name must be between 2 and 80 characters';
  end if;
  if requested_offer_type not in ('pick_n_modules', 'full_bundle') then
    raise exception 'Choose a supported bundle type';
  end if;
  if requested_offer_type = 'pick_n_modules'
    and (requested_selection_count is null or requested_selection_count not between 2 and 10) then
    raise exception 'Choose between 2 and 10 modules for a pick-your-own bundle';
  end if;
  if requested_offer_type = 'full_bundle' and requested_selection_count is not null then
    raise exception 'A full bundle cannot have a module limit';
  end if;
  if requested_price_kobo is null or requested_price_kobo <= 0 then
    raise exception 'Enter a valid bundle price';
  end if;
  if requested_ends_at is not null
    and (requested_starts_at is null or requested_ends_at <= requested_starts_at) then
    raise exception 'Offer end must be after its start';
  end if;

  select ep.id into active_pack_id
  from public.exam_packs ep
  where ep.is_active = true
  order by ep.active_from desc, ep.created_at desc
  limit 1;

  if active_pack_id is null then
    raise exception 'No active exam pack is configured';
  end if;

  with eligible as (
    select
      mo.price_kobo,
      row_number() over (order by mo.price_kobo, mo.id) as price_rank
    from public.module_offerings mo
    join public.subjects s on s.id = mo.subject_id
    where mo.exam_pack_id = active_pack_id
      and mo.is_active = true
      and mo.currency = 'NGN'
      and s.is_active = true
      and s.lifecycle_status = 'active'
      and s.candidate_availability = 'available'
      and exists (
        select 1
        from public.practice_sets ps
        where ps.exam_pack_id = mo.exam_pack_id
          and ps.subject_id = mo.subject_id
          and ps.status = 'published'
          and (
            exists (select 1 from public.questions q where q.practice_set_id = ps.id and q.status = 'published')
            or exists (select 1 from public.oral_questions oq where oq.practice_set_id = ps.id and oq.status = 'published')
          )
      )
    order by mo.price_kobo
  )
  select
    count(*)::integer,
    case
      when requested_offer_type = 'full_bundle' then sum(price_kobo)::integer
      else sum(price_kobo) filter (where price_rank <= requested_selection_count)::integer
    end
  into eligible_count, comparison_price
  from eligible;

  if eligible_count < coalesce(requested_selection_count, 1) then
    raise exception 'There are not enough eligible modules for this bundle';
  end if;
  if comparison_price is null or requested_price_kobo >= comparison_price then
    raise exception 'The bundle price must be lower than buying the included modules separately';
  end if;

  if requested_offer_id is null then
    insert into public.purchase_offers (
      exam_pack_id, name, offer_type, selection_count, price_kobo,
      currency, starts_at, ends_at, enabled, created_by
    ) values (
      active_pack_id, btrim(requested_name), requested_offer_type,
      case when requested_offer_type = 'pick_n_modules' then requested_selection_count else null end,
      requested_price_kobo, 'NGN', requested_starts_at, requested_ends_at,
      coalesce(requested_enabled, false), (select auth.uid())
    ) returning id into saved_offer_id;
  else
    update public.purchase_offers po
    set name = btrim(requested_name),
        offer_type = requested_offer_type,
        selection_count = case when requested_offer_type = 'pick_n_modules' then requested_selection_count else null end,
        price_kobo = requested_price_kobo,
        starts_at = requested_starts_at,
        ends_at = requested_ends_at,
        enabled = coalesce(requested_enabled, false)
    where po.id = requested_offer_id
      and po.exam_pack_id = active_pack_id
    returning po.id into saved_offer_id;

    if saved_offer_id is null then
      raise exception 'Bundle offer was not found';
    end if;
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when requested_offer_id is null then 'CREATE' else 'UPDATE' end,
    'purchase_offer',
    saved_offer_id,
    jsonb_build_object(
      'name', btrim(requested_name),
      'offer_type', requested_offer_type,
      'selection_count', requested_selection_count,
      'price_kobo', requested_price_kobo,
      'enabled', coalesce(requested_enabled, false)
    )
  );

  return saved_offer_id;
end;
$$;

create or replace function public.admin_set_purchase_offer_enabled(
  requested_offer_id uuid,
  requested_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  update public.purchase_offers po
  set enabled = coalesce(requested_enabled, false)
  where po.id = requested_offer_id;

  if not found then
    raise exception 'Bundle offer was not found';
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when coalesce(requested_enabled, false) then 'ENABLE' else 'DISABLE' end,
    'purchase_offer',
    requested_offer_id,
    jsonb_build_object('enabled', coalesce(requested_enabled, false))
  );
end;
$$;

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
  v_item_expires_at timestamptz;
  v_already_active boolean;
  v_item_count integer;
begin
  select po.* into v_order
  from public.payment_orders po
  where po.provider_reference = requested_reference
  for update;

  if v_order.id is null then
    raise exception 'Payment order was not found';
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
      max(me.expires_at),
      po.created_at,
      po.paid_at,
      case when po.purchase_type = 'single_module' then po.subject_id else null end,
      case when po.purchase_type = 'single_module' then max(s.name) else null end,
      case when po.purchase_type = 'single_module' then max(s.slug) else null end,
      false,
      coalesce(po.provider_status, case when po.status = 'active' then 'success' end),
      case
        when count(me.id) filter (where me.status = 'active') > 0 and po.fulfillment_status = 'fulfilled'
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

revoke all on function public.get_bundle_offer_catalog() from public, anon;
revoke all on function public.get_admin_purchase_offers() from public, anon;
revoke all on function public.admin_save_purchase_offer(uuid, text, text, integer, integer, timestamptz, timestamptz, boolean) from public, anon;
revoke all on function public.admin_set_purchase_offer_enabled(uuid, boolean) from public, anon;
revoke all on function public.activate_module_purchase(text, jsonb) from public, anon, authenticated;
revoke all on function public.get_payment_history(integer) from public, anon;

grant execute on function public.get_bundle_offer_catalog() to authenticated;
grant execute on function public.get_admin_purchase_offers() to authenticated;
grant execute on function public.admin_save_purchase_offer(uuid, text, text, integer, integer, timestamptz, timestamptz, boolean) to authenticated;
grant execute on function public.admin_set_purchase_offer_enabled(uuid, boolean) to authenticated;
grant execute on function public.activate_module_purchase(text, jsonb) to service_role;
grant execute on function public.get_payment_history(integer) to authenticated;

create or replace function public.get_admin_payment_attention(requested_limit integer default 100)
returns table (
  payment_order_id uuid,
  user_id uuid,
  requester_name text,
  requester_email text,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  provider_reference text,
  amount_kobo integer,
  currency text,
  paid_at timestamptz,
  created_at timestamptz,
  provider_status text,
  fulfillment_status text,
  fulfillment_error text,
  review_status text,
  attention_type text,
  entitlement_status public.payment_status,
  access_expires_at timestamptz,
  support_request_id uuid,
  support_request_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  return query
  select
    po.id,
    po.user_id,
    p.full_name,
    p.email,
    po.subject_id,
    coalesce(s.name, po.purchase_label),
    s.slug,
    po.provider_reference,
    po.amount_kobo,
    po.currency,
    po.paid_at,
    po.created_at,
    po.provider_status,
    po.fulfillment_status,
    po.fulfillment_error,
    po.review_status,
    case
      when po.review_status = 'disputed' then 'dispute'
      when po.review_status = 'refund_pending' then 'refund_pending'
      when po.provider_status = 'success'
        and po.review_status = 'clear'
        and po.fulfillment_status <> 'fulfilled' then 'access_issue'
      else 'processing_delayed'
    end,
    me.status,
    me.expires_at,
    sr.id,
    sr.status
  from public.payment_orders po
  join public.profiles p on p.id = po.user_id
  left join public.subjects s on s.id = po.subject_id
  left join lateral (
    select candidate_entitlement.status, candidate_entitlement.expires_at
    from public.module_entitlements candidate_entitlement
    where candidate_entitlement.payment_order_id = po.id
    order by candidate_entitlement.created_at desc
    limit 1
  ) me on true
  left join lateral (
    select candidate_request.id, candidate_request.status
    from public.support_requests candidate_request
    where candidate_request.user_id = po.user_id
      and candidate_request.payment_reference = po.provider_reference
    order by
      case candidate_request.status when 'received' then 1 when 'in_review' then 2 else 3 end,
      candidate_request.created_at desc
    limit 1
  ) sr on true
  where
    po.review_status in ('refund_pending', 'disputed')
    or (
      po.provider_status = 'success'
      and po.review_status = 'clear'
      and po.fulfillment_status <> 'fulfilled'
    )
    or (
      po.provider_status in ('ongoing', 'pending', 'processing', 'queued')
      and po.created_at < now() - interval '15 minutes'
    )
  order by
    case
      when po.provider_status = 'success' and po.review_status = 'clear' then 1
      when po.review_status = 'disputed' then 2
      when po.review_status = 'refund_pending' then 3
      else 4
    end,
    coalesce(po.paid_at, po.created_at) asc
  limit greatest(1, least(coalesce(requested_limit, 100), 200));
end;
$$;

revoke all on function public.get_admin_payment_attention(integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_admin_payment_attention(integer) to authenticated;
