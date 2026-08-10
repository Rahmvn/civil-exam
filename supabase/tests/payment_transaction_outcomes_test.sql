begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(49);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'fa220000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'p2-chain@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa220000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'p2-bundle@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa220000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'p2-stale@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size,
  pass_mark_percent, lifecycle_status, candidate_availability, practice_type
) values
  ('fb220000-0000-4000-8000-000000000001', 'P2 Module One', 'p2-module-one', '', 970, true, 20, 70, 'active', 'available', 'objective'),
  ('fb220000-0000-4000-8000-000000000002', 'P2 Module Two', 'p2-module-two', '', 971, true, 20, 70, 'active', 'available', 'objective'),
  ('fb220000-0000-4000-8000-000000000003', 'P2 Module Three', 'p2-module-three', '', 972, true, 20, 70, 'active', 'available', 'objective');

insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
select fixture.offering_id, pack.id, fixture.subject_id, 250000, 'NGN', true
from (values
  ('fc220000-0000-4000-8000-000000000001'::uuid, 'fb220000-0000-4000-8000-000000000001'::uuid),
  ('fc220000-0000-4000-8000-000000000002'::uuid, 'fb220000-0000-4000-8000-000000000002'::uuid),
  ('fc220000-0000-4000-8000-000000000003'::uuid, 'fb220000-0000-4000-8000-000000000003'::uuid)
) fixture(offering_id, subject_id)
cross join lateral (
  select id from public.exam_packs where is_active = true
  order by active_from desc, created_at desc limit 1
) pack;

create function pg_temp.create_pricing_order(
  order_id uuid,
  candidate_id uuid,
  reference text,
  plan_code text,
  months integer,
  subject_ids uuid[],
  amount integer
) returns void language plpgsql as $$
declare
  pack_id uuid;
  plan_id uuid;
  v_subject_id uuid;
  item_count integer := cardinality(subject_ids);
begin
  select id into pack_id from public.exam_packs where is_active = true
  order by active_from desc, created_at desc limit 1;
  select id into plan_id from public.purchase_plans where code = plan_code;

  insert into public.payment_orders (
    id, user_id, exam_pack_id, purchase_type, purchase_plan_id, plan_code,
    duration_months, purchase_label, checkout_key, provider_reference,
    amount_kobo, list_price_kobo, pricing_type, currency, status,
    provider_status, fulfillment_status, catalog_module_count,
    pricing_version, purchase_snapshot
  ) values (
    order_id, candidate_id, pack_id, 'pricing_plan', plan_id, plan_code,
    months, 'P2 test purchase', 'p2:' || order_id::text, reference,
    amount, amount, 'pricing_plan', 'NGN', 'pending', 'success', 'pending',
    item_count, 'duration_pricing_v1',
    jsonb_build_object('plan_code', plan_code, 'duration_months', months)
  );

  foreach v_subject_id in array subject_ids loop
    insert into public.payment_order_items (
      payment_order_id, subject_id, module_offering_id,
      list_price_kobo, allocated_amount_kobo
    ) select order_id, v_subject_id, offering.id, 250000, amount / item_count
      from public.module_offerings offering
      where offering.subject_id = v_subject_id and offering.exam_pack_id = pack_id;
  end loop;
end;
$$;

select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000001', 'fa220000-0000-4000-8000-000000000001',
  'P2-CHAIN-ONE', 'individual_objective', 1,
  array['fb220000-0000-4000-8000-000000000001'::uuid], 250000
);
select is((select count(*)::integer from public.activate_module_purchase('P2-CHAIN-ONE')), 1,
  'first chain order activates');

select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000002', 'fa220000-0000-4000-8000-000000000001',
  'P2-CHAIN-TWO', 'individual_objective', 3,
  array['fb220000-0000-4000-8000-000000000001'::uuid], 650000
);
select is((select count(*)::integer from public.activate_module_purchase('P2-CHAIN-TWO')), 1,
  'middle extension activates');

select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000003', 'fa220000-0000-4000-8000-000000000001',
  'P2-CHAIN-THREE', 'individual_objective', 3,
  array['fb220000-0000-4000-8000-000000000001'::uuid], 650000
);
select is((select count(*)::integer from public.activate_module_purchase('P2-CHAIN-THREE')), 1,
  'later extension activates');

select is(
  (select string_agg(activation_kind, ',' order by activated_at, id)
   from public.payment_order_item_access_outcomes
   where user_id = 'fa220000-0000-4000-8000-000000000001'),
  'new,extension,extension', 'chain records stable activation kinds');

create temp table chain_dates as
select
  max(after_expires_at) filter (where payment_order_id = 'fd220000-0000-4000-8000-000000000001') as first_expiry,
  max(after_expires_at) filter (where payment_order_id = 'fd220000-0000-4000-8000-000000000002') as second_expiry,
  max(after_expires_at) filter (where payment_order_id = 'fd220000-0000-4000-8000-000000000003') as third_expiry
from public.payment_order_item_access_outcomes;

select is(
  (select expires_at from public.activate_module_purchase('P2-CHAIN-TWO')),
  (select second_expiry from chain_dates),
  'old extension replay returns its immutable historical result');
select is((select access_expires_at from public.payment_orders where provider_reference = 'P2-CHAIN-ONE'),
  (select first_expiry from chain_dates), 'first order receipt result remains immutable');
select is((select access_expires_at from public.payment_orders where provider_reference = 'P2-CHAIN-TWO'),
  (select second_expiry from chain_dates), 'middle order receipt result remains immutable');

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('a', 64), jsonb_build_object('event', 'refund.processed', 'data', jsonb_build_object(
      'transaction_reference', 'P2-CHAIN-TWO', 'status', 'processed',
      'currency', 'NGN', 'refund_reference', 'P2-R-MIDDLE', 'amount', 650000)))),
  'refunded', 'full refund reverses a prospective middle extension');
select is((select effect_state from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000002'),
  'reversed', 'middle contribution is marked reversed');
select is((select expires_at from public.module_entitlements
  where user_id = 'fa220000-0000-4000-8000-000000000001' and status = 'active'),
  (select first_expiry + interval '3 months' from chain_dates),
  'later valid extension is reapplied to the surviving earlier contribution');
select is((select access_expires_at from public.payment_orders where provider_reference = 'P2-CHAIN-TWO'),
  (select second_expiry from chain_dates), 'refund does not rewrite historical order result');

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('6', 64), jsonb_build_object('event', 'charge.dispute.create', 'data', jsonb_build_object(
      'id', 'P2-D-REFUNDED', 'status', 'pending',
      'transaction', jsonb_build_object('reference', 'P2-CHAIN-TWO', 'currency', 'NGN', 'amount', 650000))))),
  'refunded', 'out-of-order dispute does not reopen a fully refunded order');
select is((select effect_state from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000002'),
  'reversed', 'out-of-order dispute cannot resurrect a reversed contribution');

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('b', 64), jsonb_build_object('event', 'charge.dispute.create', 'data', jsonb_build_object(
      'id', 'P2-D-THREE', 'status', 'pending',
      'transaction', jsonb_build_object('reference', 'P2-CHAIN-THREE', 'currency', 'NGN', 'amount', 650000))))),
  'disputed', 'opening a dispute holds the transaction contribution');
select is((select effect_state from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000003'),
  'held', 'disputed contribution is held');
select is((select expires_at from public.module_entitlements
  where user_id = 'fa220000-0000-4000-8000-000000000001' and status = 'active'),
  (select first_expiry from chain_dates), 'earlier legitimate access remains during dispute');
select throws_ok(
  $$select public.assert_modules_not_under_payment_review(
    'fa220000-0000-4000-8000-000000000001',
    (select exam_pack_id from public.payment_orders where provider_reference = 'P2-CHAIN-THREE'),
    array['fb220000-0000-4000-8000-000000000001'::uuid])$$,
  'P0001', 'Access for this module is currently under payment review.',
  'held module is rejected by the checkout guard');

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('c', 64), jsonb_build_object('event', 'charge.dispute.resolve', 'data', jsonb_build_object(
      'id', 'P2-D-THREE', 'status', 'resolved', 'resolution', 'declined',
      'transaction', jsonb_build_object('reference', 'P2-CHAIN-THREE', 'currency', 'NGN', 'amount', 650000))))),
  'dispute_resolved', 'merchant-win dispute resolution restores contribution');
select is((select effect_state from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000003'),
  'effective', 'declined dispute restores effective state');
select is((select expires_at from public.module_entitlements
  where user_id = 'fa220000-0000-4000-8000-000000000001' and status = 'active'),
  (select first_expiry + interval '3 months' from chain_dates),
  'restored contribution re-enters the deterministic chain');

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('d', 64), jsonb_build_object('event', 'refund.processed', 'data', jsonb_build_object(
      'transaction_reference', 'P2-CHAIN-ONE', 'status', 'processed',
      'currency', 'NGN', 'refund_reference', 'P2-R-PARTIAL', 'amount', 100000)))),
  'partially_refunded', 'partial refund records financial truth');
select is((select effect_state from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000001'),
  'effective', 'partial refund does not invent an access reduction');

select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000010', 'fa220000-0000-4000-8000-000000000002',
  'P2-BUNDLE', 'three_module_bundle', 1,
  array[
    'fb220000-0000-4000-8000-000000000001'::uuid,
    'fb220000-0000-4000-8000-000000000002'::uuid,
    'fb220000-0000-4000-8000-000000000003'::uuid
  ], 600000
);
select is((select count(*)::integer from public.activate_module_purchase('P2-BUNDLE')), 3,
  'Pick 3 prospective activation applies all items');
select is((select count(*)::integer from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000010'), 3,
  'Pick 3 creates one outcome for every item');
select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('e', 64), jsonb_build_object('event', 'charge.dispute.create', 'data', jsonb_build_object(
      'id', 'P2-D-BUNDLE', 'status', 'pending',
      'transaction', jsonb_build_object('reference', 'P2-BUNDLE', 'currency', 'NGN', 'amount', 600000))))),
  'disputed', 'bundle dispute is applied transaction-wide');
select is((select count(*)::integer from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000010' and effect_state = 'held'),
  3, 'bundle dispute holds every item rather than one arbitrary module');
select is((select count(*)::integer from public.module_entitlements
  where user_id = 'fa220000-0000-4000-8000-000000000002' and status = 'active'),
  0, 'all-new disputed bundle has no usable contribution');

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('f', 64), jsonb_build_object('event', 'charge.dispute.resolve', 'data', jsonb_build_object(
      'id', 'P2-D-BUNDLE', 'status', 'resolved', 'resolution', 'merchant-accepted',
      'transaction', jsonb_build_object('reference', 'P2-BUNDLE', 'currency', 'NGN', 'amount', 600000))))),
  'dispute_resolved', 'customer-win bundle dispute resolves transaction-wide');
select is((select count(*)::integer from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000010' and effect_state = 'reversed'),
  3, 'customer-win bundle dispute reverses every item');
select is((select access_expires_at from public.payment_orders where provider_reference = 'P2-BUNDLE'),
  (select max(after_expires_at) from public.payment_order_item_access_outcomes
   where payment_order_id = 'fd220000-0000-4000-8000-000000000010'),
  'bundle lifecycle change preserves its historical activation result');

insert into public.module_entitlements (
  user_id, exam_pack_id, subject_id, payment_order_id, status, starts_at, expires_at
) select 'fa220000-0000-4000-8000-000000000003', exam_pack_id,
  'fb220000-0000-4000-8000-000000000001', null, 'active', now() - interval '2 months', now() - interval '1 day'
from public.payment_orders where provider_reference = 'P2-CHAIN-ONE';
select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000020', 'fa220000-0000-4000-8000-000000000003',
  'P2-REACTIVATE', 'individual_objective', 1,
  array['fb220000-0000-4000-8000-000000000001'::uuid], 250000
);
select lives_ok($$select * from public.activate_module_purchase('P2-REACTIVATE')$$,
  'stale active-but-expired row no longer blocks paid reactivation');
select is((select activation_kind from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000020'),
  'reactivation', 'paid access after actual expiry is classified as reactivation');
select is((select count(*)::integer from public.module_entitlements
  where user_id = 'fa220000-0000-4000-8000-000000000003' and status = 'expired'),
  1, 'stale historical entitlement is preserved as expired');
select is((select count(*)::integer from public.module_entitlements
  where user_id = 'fa220000-0000-4000-8000-000000000003' and status = 'active'),
  1, 'reactivation creates one current active entitlement');

select is(
  (select event_applied from public.apply_paystack_post_payment_event(
    repeat('a', 64), jsonb_build_object('event', 'refund.processed', 'data', jsonb_build_object(
      'transaction_reference', 'P2-CHAIN-TWO', 'status', 'processed',
      'currency', 'NGN', 'refund_reference', 'P2-R-MIDDLE', 'amount', 650000)))),
  false, 'provider lifecycle fingerprint replay remains idempotent');

create temp table before_partial_dispute as
select expires_at from public.module_entitlements
where user_id = 'fa220000-0000-4000-8000-000000000001' and status = 'active';
select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('9', 64), jsonb_build_object('event', 'charge.dispute.create', 'data', jsonb_build_object(
      'id', 'P2-D-PARTIAL', 'status', 'pending',
      'transaction', jsonb_build_object('reference', 'P2-CHAIN-ONE', 'currency', 'NGN', 'amount', 100000))))),
  'access_review', 'partial monetary dispute is routed to access review');
select is((select effect_state from public.payment_order_item_access_outcomes
  where payment_order_id = 'fd220000-0000-4000-8000-000000000001'),
  'effective', 'partial dispute does not guess an access reduction');
select is((select expires_at from public.module_entitlements
  where user_id = 'fa220000-0000-4000-8000-000000000001' and status = 'active'),
  (select expires_at from before_partial_dispute), 'partial dispute leaves access unchanged');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'fa220000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'p2-history-ambiguous@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'fa220000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'p2-history-safe@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());

select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000030', 'fa220000-0000-4000-8000-000000000004',
  'P2-HIST-AMB', 'individual_objective', 1,
  array['fb220000-0000-4000-8000-000000000002'::uuid], 250000
);
update public.payment_orders set status = 'active', fulfillment_status = 'fulfilled',
  access_starts_at = now(), access_expires_at = now() + interval '1 month'
where provider_reference = 'P2-HIST-AMB';
insert into public.module_entitlements (
  user_id, exam_pack_id, subject_id, payment_order_id, status, starts_at, expires_at, metadata
) select user_id, exam_pack_id, 'fb220000-0000-4000-8000-000000000002', id,
  'active', access_starts_at, access_expires_at,
  jsonb_build_object('pricing_plan_order_ids', jsonb_build_array(id::text, gen_random_uuid()::text))
from public.payment_orders where provider_reference = 'P2-HIST-AMB';

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('7', 64), jsonb_build_object('event', 'refund.processed', 'data', jsonb_build_object(
      'transaction_reference', 'P2-HIST-AMB', 'status', 'processed',
      'currency', 'NGN', 'refund_reference', 'P2-HIST-R-AMB', 'amount', 250000)))),
  'access_review', 'ambiguous historical reversal is withheld for manual review');
select is((select status from public.module_entitlements
  where payment_order_id = 'fd220000-0000-4000-8000-000000000030'),
  'active'::public.payment_status, 'ambiguous historical access is preserved');
select is(public.build_payment_order_presentation('fd220000-0000-4000-8000-000000000030') ->> 'record_type',
  'attention', 'canonical payment truth exposes historical access review');

select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000031', 'fa220000-0000-4000-8000-000000000005',
  'P2-HIST-SAFE', 'individual_objective', 1,
  array['fb220000-0000-4000-8000-000000000003'::uuid], 250000
);
update public.payment_orders set status = 'active', fulfillment_status = 'fulfilled',
  access_starts_at = now(), access_expires_at = now() + interval '1 month'
where provider_reference = 'P2-HIST-SAFE';
insert into public.module_entitlements (
  user_id, exam_pack_id, subject_id, payment_order_id, status, starts_at, expires_at, metadata
) select user_id, exam_pack_id, 'fb220000-0000-4000-8000-000000000003', id,
  'active', access_starts_at, access_expires_at,
  jsonb_build_object('pricing_plan_order_ids', jsonb_build_array(id::text))
from public.payment_orders where provider_reference = 'P2-HIST-SAFE';

select is(
  (select resulting_review_status from public.apply_paystack_post_payment_event(
    repeat('8', 64), jsonb_build_object('event', 'refund.processed', 'data', jsonb_build_object(
      'transaction_reference', 'P2-HIST-SAFE', 'status', 'processed',
      'currency', 'NGN', 'refund_reference', 'P2-HIST-R-SAFE', 'amount', 250000)))),
  'refunded', 'provably safe historical direct-new purchase may be reversed');
select is((select status from public.module_entitlements
  where payment_order_id = 'fd220000-0000-4000-8000-000000000031'),
  'expired'::public.payment_status, 'safe historical reversal expires only its direct access');
select is((select count(*)::integer from public.payment_order_item_access_outcomes
  where payment_order_id in (
    'fd220000-0000-4000-8000-000000000030',
    'fd220000-0000-4000-8000-000000000031')),
  0, 'historical compatibility does not invent outcome rows');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa220000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.payment_order_item_access_outcomes$$,
  '42501', null, 'candidate cannot read raw access outcomes');
select throws_ok($$update public.payment_order_item_access_outcomes set effect_state = 'reversed'$$,
  '42501', null, 'candidate cannot modify access effects');
select throws_ok($$select public.set_payment_order_access_effect(
  'fd220000-0000-4000-8000-000000000001', 'reversed', null)$$,
  '42501', null, 'candidate cannot invoke lifecycle effect mutation');
reset role;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', 'fa220000-0000-4000-8000-000000000006',
  'authenticated', 'authenticated', 'p2-month-boundary@example.test',
  crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '',
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000040', 'fa220000-0000-4000-8000-000000000006',
  'P2-MONTH-ONE', 'individual_objective', 1,
  array['fb220000-0000-4000-8000-000000000001'::uuid], 250000
);
select pg_temp.create_pricing_order(
  'fd220000-0000-4000-8000-000000000041', 'fa220000-0000-4000-8000-000000000006',
  'P2-MONTH-TWO', 'individual_objective', 3,
  array['fb220000-0000-4000-8000-000000000001'::uuid], 650000
);
insert into public.module_entitlements (
  id, user_id, exam_pack_id, subject_id, payment_order_id,
  status, starts_at, expires_at
) select 'fe220000-0000-4000-8000-000000000040', user_id, exam_pack_id,
  'fb220000-0000-4000-8000-000000000001', id, 'active',
  '2027-01-31 12:00:00+00', '2027-05-28 12:00:00+00'
from public.payment_orders where id = 'fd220000-0000-4000-8000-000000000040';
insert into public.payment_order_item_access_outcomes (
  payment_order_item_id, payment_order_id, user_id, exam_pack_id, subject_id,
  entitlement_id, activation_kind, activated_at, duration_months,
  before_status, before_starts_at, before_expires_at,
  after_status, after_starts_at, after_expires_at
)
select poi.id, po.id, po.user_id, po.exam_pack_id, poi.subject_id,
  'fe220000-0000-4000-8000-000000000040'::uuid, 'new',
  '2027-01-31 12:00:00+00'::timestamptz, 1,
  null::public.payment_status, null::timestamptz, null::timestamptz,
  'active'::public.payment_status,
  '2027-01-31 12:00:00+00'::timestamptz, '2027-02-28 12:00:00+00'::timestamptz
from public.payment_orders po join public.payment_order_items poi on poi.payment_order_id = po.id
where po.id = 'fd220000-0000-4000-8000-000000000040'
union all
select poi.id, po.id, po.user_id, po.exam_pack_id, poi.subject_id,
  'fe220000-0000-4000-8000-000000000040'::uuid, 'extension',
  '2027-02-15 12:00:00+00', 3, 'active',
  '2027-01-31 12:00:00+00', '2027-02-28 12:00:00+00',
  'active', '2027-01-31 12:00:00+00', '2027-05-28 12:00:00+00'
from public.payment_orders po join public.payment_order_items poi on poi.payment_order_id = po.id
where po.id = 'fd220000-0000-4000-8000-000000000041';

select is(
  (select expires_at from public.recompute_module_access_from_outcomes(
    'fa220000-0000-4000-8000-000000000006',
    (select exam_pack_id from public.payment_orders where id = 'fd220000-0000-4000-8000-000000000040'),
    'fb220000-0000-4000-8000-000000000001')),
  '2027-05-28 12:00:00+00'::timestamptz,
  'calendar-month chain preserves January month-end arithmetic');
update public.payment_order_item_access_outcomes set effect_state = 'reversed'
where payment_order_id = 'fd220000-0000-4000-8000-000000000040';
select is(
  (select expires_at from public.recompute_module_access_from_outcomes(
    'fa220000-0000-4000-8000-000000000006',
    (select exam_pack_id from public.payment_orders where id = 'fd220000-0000-4000-8000-000000000040'),
    'fb220000-0000-4000-8000-000000000001')),
  '2027-05-15 12:00:00+00'::timestamptz,
  'surviving extension reapplies from its original activation time, not review time');

select * from finish();
rollback;
