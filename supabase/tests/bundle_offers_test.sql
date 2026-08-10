begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'bundle-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'bundle-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

update public.profiles set role = 'admin'
where id = 'fa000000-0000-4000-8000-000000000002';

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size,
  pass_mark_percent, lifecycle_status, candidate_availability, practice_type
) values
  ('fb000000-0000-4000-8000-000000000001', 'Bundle Module One', 'bundle-module-one', '', 981, true, 20, 70, 'active', 'available', 'objective'),
  ('fb000000-0000-4000-8000-000000000002', 'Bundle Module Two', 'bundle-module-two', '', 982, true, 20, 70, 'active', 'available', 'objective'),
  ('fb000000-0000-4000-8000-000000000003', 'Bundle Module Three', 'bundle-module-three', '', 983, true, 20, 70, 'active', 'available', 'objective');

update public.module_offerings
set is_active = false
where subject_id not in (
  'fb000000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000002',
  'fb000000-0000-4000-8000-000000000003'
);

insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
select fixture.offering_id, ep.id, fixture.subject_id, fixture.price_kobo, 'NGN', true
from (
  values
    ('fc000000-0000-4000-8000-000000000001'::uuid, 'fb000000-0000-4000-8000-000000000001'::uuid, 700000),
    ('fc000000-0000-4000-8000-000000000002'::uuid, 'fb000000-0000-4000-8000-000000000002'::uuid, 700000),
    ('fc000000-0000-4000-8000-000000000003'::uuid, 'fb000000-0000-4000-8000-000000000003'::uuid, 900000)
) fixture(offering_id, subject_id, price_kobo)
cross join lateral (
  select id from public.exam_packs where is_active = true
  order by active_from desc, created_at desc limit 1
) ep;

insert into public.practice_sets (
  id, exam_pack_id, subject_id, set_number, expected_question_count,
  status, published_at, practice_type
)
select
  ('fe000000-0000-4000-8000-00000000000' || fixture.position)::uuid,
  ep.id,
  fixture.subject_id,
  1,
  1,
  'published',
  now(),
  'objective'
from (
  values
    (1, 'fb000000-0000-4000-8000-000000000001'::uuid),
    (2, 'fb000000-0000-4000-8000-000000000002'::uuid),
    (3, 'fb000000-0000-4000-8000-000000000003'::uuid)
) fixture(position, subject_id)
cross join lateral (
  select id from public.exam_packs where is_active = true
  order by active_from desc, created_at desc limit 1
) ep;

insert into public.questions (
  exam_pack_id, subject_id, practice_set_id, question_text,
  option_a, option_b, option_c, option_d, correct_option, explanation,
  status, batch_number, batch_position
)
select
  ps.exam_pack_id,
  ps.subject_id,
  ps.id,
  'Which answer verifies this bundle module?',
  'The published answer', 'Option B', 'Option C', 'Option D',
  'A', 'This published question makes the module purchasable.',
  'published', 1, 1
from public.practice_sets ps
where ps.id in (
  'fe000000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000002',
  'fe000000-0000-4000-8000-000000000003'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select * from public.purchase_offers $$,
  '42501', null,
  'candidates cannot read operational offer rows directly'
);

select throws_ok(
  $$ select public.admin_save_purchase_offer(null, 'Bundle Test Any 3', 'pick_n_modules', 3, 1000000, null, null, true) $$,
  'P0001', 'Admin access is required',
  'candidates cannot create bundle offers'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$ select public.admin_save_purchase_offer(null, 'Bundle Test Any 3', 'pick_n_modules', 3, 1000000, null, null, true) $$,
  'an admin can create an enabled choose-three offer'
);

select throws_ok(
  $$ select public.admin_save_purchase_offer(null, 'Bad bundle', 'pick_n_modules', 3, 2300000, null, null, true) $$,
  'P0001', 'The bundle price must be lower than buying the included modules separately',
  'a bundle must be a genuine discount against the exact cheapest module count'
);

select is(
  (select count(*)::integer from public.get_admin_purchase_offers() where offer_name = 'Bundle Test Any 3'),
  1,
  'the admin offer catalogue returns the saved offer'
);

reset role;

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id,
  purchase_type, purchase_offer_id, purchase_label, checkout_key,
  provider_reference, amount_kobo, list_price_kobo, pricing_type,
  currency, status, provider_status, fulfillment_status
)
select
  'fd000000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001',
  po.exam_pack_id,
  null,
  null,
  'bundle_offer',
  po.id,
  po.name,
  'bundle:test-order',
  'PS-BUNDLE-TEST',
  1000000,
  2300000,
  'bundle_offer',
  'NGN',
  'pending',
  'success',
  'pending'
from public.purchase_offers po
where po.name = 'Bundle Test Any 3';

insert into public.payment_order_items (
  payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
)
values
  ('fd000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 700000, 333334),
  ('fd000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000002', 700000, 333333),
  ('fd000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000003', 900000, 333333);

select is(
  (select sum(allocated_amount_kobo)::integer from public.payment_order_items where payment_order_id = 'fd000000-0000-4000-8000-000000000001'),
  1000000,
  'bundle item allocations preserve the exact paid total'
);

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-BUNDLE-TEST', '{}'::jsonb)),
  3,
  'fulfilment returns every module in the bundle'
);

select is(
  (select count(*)::integer from public.module_entitlements where payment_order_id = 'fd000000-0000-4000-8000-000000000001'),
  3,
  'one successful bundle payment creates three module entitlements'
);

select is(
  public.build_payment_order_presentation('fd000000-0000-4000-8000-000000000001') ->> 'product_label',
  'Bundle Test Any 3',
  'bundle presentation preserves the administrator-configured purchase name'
);

select is(
  (public.build_payment_order_presentation('fd000000-0000-4000-8000-000000000001') ->> 'item_count')::integer,
  3,
  'bundle presentation includes every purchased module'
);

select is(
  jsonb_array_length(public.build_payment_order_presentation('fd000000-0000-4000-8000-000000000001') -> 'items'),
  3,
  'bundle receipt items are not summarized from an arbitrary entitlement'
);

select ok(
  (public.build_payment_order_presentation('fd000000-0000-4000-8000-000000000001') ->> 'receipt_eligible')::boolean,
  'fulfilled bundle is eligible for a receipt'
);

select is(
  (select fulfillment_status from public.payment_orders where id = 'fd000000-0000-4000-8000-000000000001'),
  'fulfilled',
  'the order is fulfilled only after all items are activated'
);

select is(
  (select count(*)::integer from public.activate_module_purchase('PS-BUNDLE-TEST', '{}'::jsonb)),
  3,
  'repeated fulfilment is idempotent and still reports every item'
);

select is(
  (select count(*)::integer from public.module_entitlements where payment_order_id = 'fd000000-0000-4000-8000-000000000001'),
  3,
  'repeated fulfilment does not duplicate entitlements'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);

select is(
  (select purchase_label from public.get_payment_history(20) where id = 'fd000000-0000-4000-8000-000000000001'),
  'Bundle Test Any 3',
  'candidate payment history shows the bundle as one purchase'
);

select is(
  (select purchase_type from public.get_payment_history(20) where id = 'fd000000-0000-4000-8000-000000000001'),
  'bundle_offer',
  'candidate payment history identifies a bundle purchase'
);

select is(
  (select review_status from public.get_payment_history(20) where id = 'fd000000-0000-4000-8000-000000000001'),
  'clear',
  'bundle payment history preserves refund and dispute state fields'
);

select throws_ok(
  $$ select * from public.payment_order_items $$,
  '42501', null,
  'candidates cannot read immutable order items directly'
);

reset role;

update public.payment_orders
set fulfillment_status = 'failed', fulfillment_error = 'Bundle attention fixture'
where id = 'fd000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000002', true);

select is(
  (select subject_name from public.get_admin_payment_attention(100) where payment_order_id = 'fd000000-0000-4000-8000-000000000001'),
  'Bundle Test Any 3',
  'bundle fulfilment failures appear in the admin attention queue with their purchase label'
);

select lives_ok(
  $$ select public.admin_set_purchase_offer_enabled((select offer_id from public.get_admin_purchase_offers() where offer_name = 'Bundle Test Any 3'), false) $$,
  'an admin can disable a bundle without deleting its history'
);

select is(
  (select status from public.get_admin_purchase_offers() where offer_name = 'Bundle Test Any 3'),
  'inactive',
  'disabled bundles remain available to admins as inactive records'
);

select * from finish();
rollback;
