begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(40);

select is(
  timestamptz '2025-01-31 10:00:00+00' + make_interval(months => 1),
  timestamptz '2025-02-28 10:00:00+00',
  'one calendar month from January 31 lands on February month end'
);

select is(
  timestamptz '2025-01-31 10:00:00+00' + make_interval(months => 2),
  timestamptz '2025-03-31 10:00:00+00',
  'two calendar months are added as one calendar operation rather than sixty days'
);

select is(
  timestamptz '2024-01-31 10:00:00+00' + make_interval(months => 1),
  timestamptz '2024-02-29 10:00:00+00',
  'calendar-month access respects leap-year February'
);

select is(
  timestamptz '2025-08-31 10:00:00+00' + make_interval(months => 1),
  timestamptz '2025-09-30 10:00:00+00',
  'calendar-month access handles a shorter following month'
);

select is(
  timestamptz '2025-08-31 10:00:00+00' + make_interval(months => 3),
  timestamptz '2025-11-30 10:00:00+00',
  'three-month duration uses calendar-month arithmetic'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'fa110000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'duration-activation-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
  '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
), (
  '00000000-0000-0000-0000-000000000000',
  'fa110000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
  'legacy-single-module-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
  '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size,
  pass_mark_percent, lifecycle_status, candidate_availability, practice_type
) values (
  'fb110000-0000-4000-8000-000000000001',
  'Duration Pricing Objective',
  'duration-pricing-objective',
  '',
  997,
  true,
  20,
  70,
  'active',
  'available',
  'objective'
);

insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
select
  'fc110000-0000-4000-8000-000000000001',
  ep.id,
  'fb110000-0000-4000-8000-000000000001',
  250000,
  'NGN',
  true
from public.exam_packs ep
where ep.is_active = true
order by ep.active_from desc, ep.created_at desc
limit 1;

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id,
  purchase_type, purchase_plan_id, plan_code, duration_months,
  purchase_label, checkout_key, provider_reference, amount_kobo,
  list_price_kobo, pricing_type, currency, status, provider_status,
  fulfillment_status, catalog_module_count, pricing_version, purchase_snapshot
)
select
  'fd110000-0000-4000-8000-000000000001',
  'fa110000-0000-4000-8000-000000000001',
  mo.exam_pack_id,
  null,
  null,
  'pricing_plan',
  plan.id,
  plan.code,
  1,
  'Objective Module - 1 month',
  'plan:objective:1:duration-pricing-objective',
  'PS-DURATION-FIRST',
  250000,
  250000,
  'pricing_plan',
  'NGN',
  'pending',
  'success',
  'pending',
  1,
  'duration_pricing_v1',
  jsonb_build_object('plan_code', plan.code, 'duration_months', 1)
from public.purchase_plans plan
cross join public.module_offerings mo
where plan.code = 'individual_objective'
  and mo.id = 'fc110000-0000-4000-8000-000000000001';

insert into public.payment_order_items (
  payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
) values (
  'fd110000-0000-4000-8000-000000000001',
  'fb110000-0000-4000-8000-000000000001',
  'fc110000-0000-4000-8000-000000000001',
  250000,
  250000
);

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-DURATION-FIRST', '{}'::jsonb)),
  1,
  'first duration pricing activation returns the purchased module'
);

select is(
  (select count(*)::integer from public.module_entitlements where payment_order_id = 'fd110000-0000-4000-8000-000000000001'),
  1,
  'first duration pricing activation creates one entitlement'
);

select ok(
  (
    select expires_at between now() + interval '29 days' and now() + interval '32 days'
    from public.module_entitlements
    where user_id = 'fa110000-0000-4000-8000-000000000001'
      and subject_id = 'fb110000-0000-4000-8000-000000000001'
  ),
  'one-month duration expiry is based on the payment activation time'
);

select is(
  (select fulfillment_status from public.payment_orders where id = 'fd110000-0000-4000-8000-000000000001'),
  'fulfilled',
  'duration pricing order is fulfilled after activation'
);

select is(
  public.build_payment_order_presentation('fd110000-0000-4000-8000-000000000001') ->> 'product_label',
  'Duration Pricing Objective',
  'single-module presentation uses the purchased module identity'
);

select is(
  (public.build_payment_order_presentation('fd110000-0000-4000-8000-000000000001') ->> 'duration_months')::integer,
  1,
  'single-module presentation exposes the purchased duration'
);

select is(
  public.build_payment_order_presentation('fd110000-0000-4000-8000-000000000001') ->> 'access_result_kind',
  'exact',
  'single-module presentation labels its persisted expiry as exact'
);

create temp table first_duration_expiry as
select expires_at
from public.module_entitlements
where user_id = 'fa110000-0000-4000-8000-000000000001'
  and subject_id = 'fb110000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-DURATION-FIRST', '{}'::jsonb)),
  1,
  'repeated duration pricing activation still reports the module'
);

select is(
  (
    select me.expires_at
    from public.module_entitlements me
    where me.user_id = 'fa110000-0000-4000-8000-000000000001'
      and me.subject_id = 'fb110000-0000-4000-8000-000000000001'
  ),
  (select expires_at from first_duration_expiry),
  'repeated activation does not extend the same paid order twice'
);

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id,
  purchase_type, purchase_plan_id, plan_code, duration_months,
  purchase_label, checkout_key, provider_reference, amount_kobo,
  list_price_kobo, pricing_type, currency, status, provider_status,
  fulfillment_status, catalog_module_count, pricing_version, purchase_snapshot
)
select
  'fd110000-0000-4000-8000-000000000002',
  'fa110000-0000-4000-8000-000000000001',
  mo.exam_pack_id,
  null,
  null,
  'pricing_plan',
  plan.id,
  plan.code,
  2,
  'Objective Module - 2 months renewal',
  'plan:objective:2:duration-pricing-objective',
  'PS-DURATION-RENEWAL',
  450000,
  500000,
  'pricing_plan',
  'NGN',
  'pending',
  'success',
  'pending',
  1,
  'duration_pricing_v1',
  jsonb_build_object('plan_code', plan.code, 'duration_months', 2)
from public.purchase_plans plan
cross join public.module_offerings mo
where plan.code = 'individual_objective'
  and mo.id = 'fc110000-0000-4000-8000-000000000001';

insert into public.payment_order_items (
  payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
) values (
  'fd110000-0000-4000-8000-000000000002',
  'fb110000-0000-4000-8000-000000000001',
  'fc110000-0000-4000-8000-000000000001',
  500000,
  450000
);

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-DURATION-RENEWAL', '{}'::jsonb)),
  1,
  'renewal activation returns the renewed module'
);

select ok(
  (
    select me.expires_at between fd.expires_at + interval '58 days' and fd.expires_at + interval '63 days'
    from public.module_entitlements me
    cross join first_duration_expiry fd
    where me.user_id = 'fa110000-0000-4000-8000-000000000001'
      and me.subject_id = 'fb110000-0000-4000-8000-000000000001'
  ),
  'early renewal extends from the current active expiry'
);

select is(
  (
    select count(*)::integer
    from public.module_entitlements
    where user_id = 'fa110000-0000-4000-8000-000000000001'
      and subject_id = 'fb110000-0000-4000-8000-000000000001'
      and status = 'active'
  ),
  1,
  'renewal extends the existing active entitlement instead of creating a duplicate'
);

select is(
  (
    select po.access_expires_at
    from public.payment_orders po
    where po.id = 'fd110000-0000-4000-8000-000000000002'
  ),
  (
    select me.expires_at
    from public.module_entitlements me
    where me.user_id = 'fa110000-0000-4000-8000-000000000001'
      and me.subject_id = 'fb110000-0000-4000-8000-000000000001'
  ),
  'renewal order stores the resulting access expiry on the order snapshot'
);

select is(
  public.build_payment_order_presentation('fd110000-0000-4000-8000-000000000002') ->> 'purchase_intent',
  'extension',
  'renewal presentation is identified as an extension even though entitlement ownership remains on the original order'
);

select is(
  (public.build_payment_order_presentation('fd110000-0000-4000-8000-000000000002') ->> 'duration_months')::integer,
  2,
  'renewal presentation exposes its purchased duration'
);

select is(
  (public.build_payment_order_presentation('fd110000-0000-4000-8000-000000000002') ->> 'access_expires_at')::timestamptz,
  (select access_expires_at from public.payment_orders where id = 'fd110000-0000-4000-8000-000000000002'),
  'renewal presentation uses the order-persisted resulting expiry'
);

create temp table renewal_order_expiry as
select access_expires_at
from public.payment_orders
where id = 'fd110000-0000-4000-8000-000000000002';

select is(
  (select count(*)::integer from public.payment_order_item_access_outcomes
   where payment_order_id in ('fd110000-0000-4000-8000-000000000001', 'fd110000-0000-4000-8000-000000000002')),
  2,
  'each duration order item has one durable access outcome'
);

select is(
  (select activation_kind from public.payment_order_item_access_outcomes
   where payment_order_id = 'fd110000-0000-4000-8000-000000000001'),
  'new',
  'first duration purchase records new activation'
);

select is(
  (select activation_kind from public.payment_order_item_access_outcomes
   where payment_order_id = 'fd110000-0000-4000-8000-000000000002'),
  'extension',
  'renewal records extension activation'
);

select is(
  (select before_expires_at from public.payment_order_item_access_outcomes
   where payment_order_id = 'fd110000-0000-4000-8000-000000000002'),
  (select expires_at from first_duration_expiry),
  'extension outcome preserves the access expiry immediately before activation'
);

select is(
  (select after_expires_at from public.payment_order_item_access_outcomes
   where payment_order_id = 'fd110000-0000-4000-8000-000000000002'),
  (select access_expires_at from renewal_order_expiry),
  'extension outcome preserves its original resulting expiry'
);

select is(
  (select effect_state from public.payment_order_item_access_outcomes
   where payment_order_id = 'fd110000-0000-4000-8000-000000000002'),
  'effective',
  'new outcomes start effective'
);

select is(
  (select expires_at from public.activate_module_purchase('PS-DURATION-FIRST', '{}'::jsonb)),
  (select access_expires_at from public.payment_orders where id = 'fd110000-0000-4000-8000-000000000001'),
  'old-order replay returns the immutable original result after a later extension'
);

select is(
  (select count(*)::integer from public.payment_order_item_access_outcomes
   where payment_order_id = 'fd110000-0000-4000-8000-000000000001'),
  1,
  'old-order replay does not duplicate its contribution'
);

grant select on renewal_order_expiry to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-8000-000000000001', true);

select is(
  (select access_expires_at from public.get_payment_history(20) where id = 'fd110000-0000-4000-8000-000000000002'),
  (select access_expires_at from renewal_order_expiry),
  'payment history shows the expiry for renewal orders even when entitlement ownership was extended in place'
);

reset role;

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id,
  purchase_type, purchase_label, checkout_key, provider_reference,
  amount_kobo, list_price_kobo, pricing_type, currency, status,
  provider_status, fulfillment_status, purchase_snapshot
)
select
  'fd110000-0000-4000-8000-000000000003',
  'fa110000-0000-4000-8000-000000000002',
  mo.exam_pack_id,
  'fb110000-0000-4000-8000-000000000001',
  'fc110000-0000-4000-8000-000000000001',
  'single_module',
  'Duration Pricing Objective',
  'legacy:duration-pricing-objective',
  'PS-LEGACY-SINGLE',
  250000,
  250000,
  'regular',
  'NGN',
  'pending',
  'success',
  'pending',
  jsonb_build_object('purchase_type', 'single_module')
from public.module_offerings mo
where mo.id = 'fc110000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-LEGACY-SINGLE', '{}'::jsonb)),
  1,
  'legacy single-module activation still fulfils after duration pricing rollout'
);

select is(
  (
    select me.expires_at
    from public.module_entitlements me
    where me.payment_order_id = 'fd110000-0000-4000-8000-000000000003'
  ),
  (
    select (ep.active_until::text || ' 23:59:59.999+00')::timestamptz
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  'legacy single-module entitlement keeps the old active-pack expiry model'
);

select is(
  (
    select po.access_expires_at
    from public.payment_orders po
    where po.id = 'fd110000-0000-4000-8000-000000000003'
  ),
  null,
  'legacy single-module orders are not rewritten with duration access snapshots'
);

select is(
  public.build_payment_order_presentation('fd110000-0000-4000-8000-000000000003') ->> 'product_label',
  'Duration Pricing Objective',
  'legacy single-module presentation falls back to the linked historical module identity'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa110000-0000-4000-8000-000000000002', true);

select ok(
  (
    select has_module_access
    from public.get_module_access_catalog_v2()
    where subject_id = 'fb110000-0000-4000-8000-000000000001'
  ),
  'legacy paid users still see module access through the candidate catalog'
);

reset role;

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size,
  pass_mark_percent, lifecycle_status, candidate_availability, practice_type
) values
  ('fb110000-0000-4000-8000-000000000002', 'Duration Bundle Two', 'duration-bundle-two', '', 998, true, 20, 70, 'active', 'available', 'objective'),
  ('fb110000-0000-4000-8000-000000000003', 'Duration Bundle Three', 'duration-bundle-three', '', 999, true, 20, 70, 'active', 'available', 'objective');

insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
select fixture.offering_id, pack.id, fixture.subject_id, 250000, 'NGN', true
from (
  values
    ('fc110000-0000-4000-8000-000000000002'::uuid, 'fb110000-0000-4000-8000-000000000002'::uuid),
    ('fc110000-0000-4000-8000-000000000003'::uuid, 'fb110000-0000-4000-8000-000000000003'::uuid)
) fixture(offering_id, subject_id)
cross join lateral (
  select id from public.exam_packs where is_active = true
  order by active_from desc, created_at desc limit 1
) pack;

insert into public.module_entitlements (
  user_id, exam_pack_id, subject_id, status, starts_at, expires_at, metadata
)
select
  'fa110000-0000-4000-8000-000000000001',
  offering.exam_pack_id,
  offering.subject_id,
  'active',
  now(),
  now() + make_interval(days => fixture.days_remaining),
  '{}'::jsonb
from (
  values
    ('fc110000-0000-4000-8000-000000000002'::uuid, 10),
    ('fc110000-0000-4000-8000-000000000003'::uuid, 25)
) fixture(offering_id, days_remaining)
join public.module_offerings offering on offering.id = fixture.offering_id;

create temp table before_bundle_expiry as
select entitlement.subject_id, entitlement.expires_at
from public.module_entitlements entitlement
where entitlement.user_id = 'fa110000-0000-4000-8000-000000000001'
  and entitlement.subject_id in (
    'fb110000-0000-4000-8000-000000000001',
    'fb110000-0000-4000-8000-000000000002',
    'fb110000-0000-4000-8000-000000000003'
  )
  and entitlement.status = 'active';

insert into public.payment_orders (
  id, user_id, exam_pack_id, purchase_type, purchase_plan_id, plan_code,
  duration_months, purchase_label, checkout_key, provider_reference,
  amount_kobo, list_price_kobo, pricing_type, currency, status,
  provider_status, fulfillment_status, catalog_module_count, pricing_version,
  purchase_snapshot
)
select
  'fd110000-0000-4000-8000-000000000004',
  'fa110000-0000-4000-8000-000000000001',
  offering.exam_pack_id,
  'pricing_plan',
  plan.id,
  plan.code,
  2,
  '3-Module Bundle - 2 months',
  'plan:bundle-different-expiries',
  'PS-DURATION-BUNDLE',
  1100000,
  1200000,
  'pricing_plan',
  'NGN',
  'pending',
  'success',
  'pending',
  3,
  'duration_pricing_v2',
  jsonb_build_object('plan_code', plan.code, 'duration_months', 2)
from public.purchase_plans plan
cross join lateral (
  select exam_pack_id from public.module_offerings
  where id = 'fc110000-0000-4000-8000-000000000001'
) offering
where plan.code = 'three_module_bundle';

insert into public.payment_order_items (
  payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
)
select
  'fd110000-0000-4000-8000-000000000004',
  offering.subject_id,
  offering.id,
  400000,
  case when row_number() over (order by offering.id) = 1 then 366668 else 366666 end
from public.module_offerings offering
where offering.id in (
  'fc110000-0000-4000-8000-000000000001',
  'fc110000-0000-4000-8000-000000000002',
  'fc110000-0000-4000-8000-000000000003'
);

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-DURATION-BUNDLE', '{}'::jsonb)),
  3,
  'bundle fulfillment processes each snapshotted module'
);

select is(
  (
    select count(*)::integer
    from public.module_entitlements entitlement
    join before_bundle_expiry before_expiry on before_expiry.subject_id = entitlement.subject_id
    where entitlement.user_id = 'fa110000-0000-4000-8000-000000000001'
      and entitlement.status = 'active'
      and entitlement.expires_at = before_expiry.expires_at + make_interval(months => 2)
  ),
  3,
  'bundle modules with different active expiries each extend from their own current expiry'
);

create temp table before_historical_six_month_expiry as
select expires_at
from public.module_entitlements
where user_id = 'fa110000-0000-4000-8000-000000000001'
  and subject_id = 'fb110000-0000-4000-8000-000000000001'
  and status = 'active';

insert into public.payment_orders (
  id, user_id, exam_pack_id, purchase_type, purchase_plan_id, plan_code,
  duration_months, purchase_label, checkout_key, provider_reference,
  amount_kobo, list_price_kobo, pricing_type, currency, status,
  provider_status, fulfillment_status, catalog_module_count, pricing_version,
  purchase_snapshot
)
select
  'fd110000-0000-4000-8000-000000000006',
  'fa110000-0000-4000-8000-000000000001',
  offering.exam_pack_id,
  'pricing_plan',
  plan.id,
  plan.code,
  6,
  'Objective Module - 6 months',
  'plan:historical-six-month-fulfillment',
  'PS-DURATION-HISTORICAL-SIX',
  1100000,
  1500000,
  'pricing_plan',
  'NGN',
  'pending',
  'success',
  'pending',
  1,
  'duration_pricing_v1',
  jsonb_build_object(
    'plan_code', plan.code,
    'duration_months', 6,
    'price_kobo', 1100000,
    'subject_slugs', jsonb_build_array('duration-pricing-objective')
  )
from public.purchase_plans plan
cross join lateral (
  select exam_pack_id
  from public.module_offerings
  where id = 'fc110000-0000-4000-8000-000000000001'
) offering
where plan.code = 'individual_objective';

insert into public.payment_order_items (
  payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
) values (
  'fd110000-0000-4000-8000-000000000006',
  'fb110000-0000-4000-8000-000000000001',
  'fc110000-0000-4000-8000-000000000001',
  1500000,
  1100000
);

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-DURATION-HISTORICAL-SIX', '{}'::jsonb)),
  1,
  'a pending historical six-month snapshot remains fulfillable after six months is disabled'
);

select is(
  (
    select entitlement.expires_at
    from public.module_entitlements entitlement
    where entitlement.user_id = 'fa110000-0000-4000-8000-000000000001'
      and entitlement.subject_id = 'fb110000-0000-4000-8000-000000000001'
      and entitlement.status = 'active'
  ),
  (select expires_at + make_interval(months => 6) from before_historical_six_month_expiry),
  'historical fulfillment uses the snapshotted six calendar months without consulting the active catalog'
);

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-DURATION-HISTORICAL-SIX', '{}'::jsonb)),
  1,
  'historical six-month fulfillment remains idempotent on replay'
);

select * from finish();
rollback;
