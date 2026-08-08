begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'fa100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'pricing-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'fa100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'pricing-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

update public.profiles set role = 'admin'
where id = 'fa100000-0000-4000-8000-000000000002';

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size,
  pass_mark_percent, lifecycle_status, candidate_availability, practice_type
) values
  ('fb100000-0000-4000-8000-000000000001', 'Pricing Objective One', 'pricing-objective-one', '', 991, true, 20, 70, 'active', 'available', 'objective'),
  ('fb100000-0000-4000-8000-000000000002', 'Pricing Objective Two', 'pricing-objective-two', '', 992, true, 20, 70, 'active', 'available', 'objective'),
  ('fb100000-0000-4000-8000-000000000003', 'Pricing Oral One', 'pricing-oral-one', '', 993, true, 20, 70, 'active', 'available', 'oral');

update public.module_offerings
set is_active = false
where subject_id not in (
  'fb100000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000002',
  'fb100000-0000-4000-8000-000000000003'
);

insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
select fixture.offering_id, ep.id, fixture.subject_id, fixture.price_kobo, 'NGN', true
from (
  values
    ('fc100000-0000-4000-8000-000000000001'::uuid, 'fb100000-0000-4000-8000-000000000001'::uuid, 250000),
    ('fc100000-0000-4000-8000-000000000002'::uuid, 'fb100000-0000-4000-8000-000000000002'::uuid, 250000),
    ('fc100000-0000-4000-8000-000000000003'::uuid, 'fb100000-0000-4000-8000-000000000003'::uuid, 350000)
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
  fixture.set_id,
  ep.id,
  fixture.subject_id,
  1,
  1,
  'published',
  now(),
  fixture.practice_type::public.practice_type
from (
  values
    ('fe100000-0000-4000-8000-000000000001'::uuid, 'fb100000-0000-4000-8000-000000000001'::uuid, 'objective'),
    ('fe100000-0000-4000-8000-000000000002'::uuid, 'fb100000-0000-4000-8000-000000000002'::uuid, 'objective'),
    ('fe100000-0000-4000-8000-000000000003'::uuid, 'fb100000-0000-4000-8000-000000000003'::uuid, 'oral')
) fixture(set_id, subject_id, practice_type)
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
  'Which answer verifies this pricing module?',
  'The published answer', 'Option B', 'Option C', 'Option D',
  'A', 'This published question makes the module purchasable.',
  'published', 1, 1
from public.practice_sets ps
where ps.id in (
  'fe100000-0000-4000-8000-000000000001',
  'fe100000-0000-4000-8000-000000000002'
);

insert into public.oral_questions (
  exam_pack_id, subject_id, practice_set_id, question_text,
  model_answer, key_points, status, batch_position
)
select
  ps.exam_pack_id,
  ps.subject_id,
  ps.id,
  'Explain why pricing should be clear.',
  'Clear pricing helps candidates choose access confidently.',
  array['Clarity', 'Trust'],
  'published',
  1
from public.practice_sets ps
where ps.id = 'fe100000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa100000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select * from public.purchase_plans $$,
  '42501', null,
  'candidates cannot read operational purchase plan rows directly'
);

select throws_ok(
  $$ select * from public.purchase_plan_prices $$,
  '42501', null,
  'candidates cannot read operational plan price rows directly'
);

select is(
  (
    select (duration->>'price_kobo')::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'individual_objective'
      and (duration->>'duration_months')::integer = 1
  ),
  250000,
  'candidate catalog returns the approved one-month objective price'
);

select is(
  (
    select (duration->>'price_kobo')::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'individual_oral'
      and (duration->>'duration_months')::integer = 6
  ),
  1550000,
  'candidate catalog returns the approved six-month oral price'
);

select is(
  (
    select (duration->>'list_price_kobo')::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'three_module_bundle'
      and (duration->>'duration_months')::integer = 3
  ),
  1800000,
  'candidate catalog returns comparison pricing for the three-month bundle'
);

select is(
  (
    select (duration->>'price_kobo')::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'complete_bundle'
      and (duration->>'duration_months')::integer = 1
  ),
  450000,
  'complete bundle one-month price is generated from current available module count'
);

select is(
  (
    select current_available_module_count
    from public.get_purchase_pricing_catalog_v1()
    where plan_code = 'complete_bundle'
  ),
  3,
  'candidate catalog exposes the current complete-bundle module count'
);

select ok(
  (
    select is_available
    from public.get_purchase_pricing_catalog_v1()
    where plan_code = 'three_module_bundle'
  ),
  'three-module bundle is available when three purchasable modules exist'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa100000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$
    select public.admin_save_purchase_plan(
      'three_module_bundle',
      'Pick 3 Modules',
      'Choose three modules for one duration.',
      'A clear admin-managed bundle description.',
      '["Choose 3 modules", "Duration-based access"]'::jsonb,
      'Admin managed saving',
      'Select plan',
      true,
      25,
      true
    )
  $$,
  'admin can edit pricing plan commercial copy'
);

select is(
  (
    select display_name
    from public.get_admin_purchase_plans()
    where plan_code = 'three_module_bundle'
  ),
  'Pick 3 Modules',
  'admin catalog reflects edited plan display name'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('three_module_bundle', 1, 650000, 750000, 'Admin price test', true) $$,
  'admin can edit fixed duration prices through the audited RPC'
);

select throws_ok(
  $$ select public.admin_save_purchase_plan_price('complete_bundle', 1, 1400000, 1400000, '', true) $$,
  'P0001', 'Complete Bundle prices are generated from the active module count',
  'admin cannot manually override generated Complete Bundle prices in this first slice'
);

select throws_ok(
  $$ select public.admin_save_purchase_plan_price('three_module_bundle', 1, 650001, 750000, '', true) $$,
  'P0001', 'Prices should be rounded to the nearest NGN 500',
  'admin price edits enforce clean NGN 500 increments'
);

select is(
  (
    select count(*)::integer
    from public.admin_audit_logs
    where entity_type = 'purchase_plan'
      and action in ('UPDATE_PRICING_PLAN', 'UPDATE_PRICING_PRICE')
  ),
  2,
  'pricing copy and price edits are audited'
);

reset role;

select lives_ok(
  $$
    insert into public.payment_orders (
      id, user_id, exam_pack_id, subject_id, module_offering_id,
      purchase_type, purchase_plan_id, plan_code, duration_months,
      purchase_label, checkout_key, provider_reference, amount_kobo,
      list_price_kobo, pricing_type, currency, status, provider_status,
      fulfillment_status, catalog_module_count, pricing_version, purchase_snapshot
    )
    select
      'fd100000-0000-4000-8000-000000000001',
      'fa100000-0000-4000-8000-000000000001',
      ep.id,
      null,
      null,
      'pricing_plan',
      plan.id,
      plan.code,
      3,
      'Pick 3 Modules - 3 months',
      'plan:test-order',
      'PS-PLAN-TEST',
      1550000,
      1800000,
      'pricing_plan',
      'NGN',
      'pending',
      'initializing',
      'pending',
      3,
      'duration_pricing_v1',
      jsonb_build_object('plan_code', plan.code, 'duration_months', 3)
    from public.purchase_plans plan
    cross join lateral (
      select id from public.exam_packs where is_active = true
      order by active_from desc, created_at desc limit 1
    ) ep
    where plan.code = 'three_module_bundle'
  $$,
  'payment orders can snapshot a valid duration pricing plan checkout'
);

select throws_ok(
  $$
    insert into public.payment_orders (
      id, user_id, exam_pack_id, subject_id, module_offering_id,
      purchase_type, purchase_plan_id, plan_code, duration_months,
      purchase_label, checkout_key, provider_reference, amount_kobo,
      list_price_kobo, pricing_type, currency, status, provider_status,
      fulfillment_status, catalog_module_count, pricing_version, purchase_snapshot
    )
    select
      'fd100000-0000-4000-8000-000000000002',
      'fa100000-0000-4000-8000-000000000001',
      ep.id,
      null,
      null,
      'pricing_plan',
      plan.id,
      plan.code,
      null,
      'Broken plan order',
      'plan:broken-order',
      'PS-PLAN-BROKEN',
      1550000,
      1800000,
      'pricing_plan',
      'NGN',
      'pending',
      'initializing',
      'pending',
      3,
      'duration_pricing_v1',
      jsonb_build_object('plan_code', plan.code)
    from public.purchase_plans plan
    cross join lateral (
      select id from public.exam_packs where is_active = true
      order by active_from desc, created_at desc limit 1
    ) ep
    where plan.code = 'three_module_bundle'
  $$,
  '23514', null,
  'duration pricing plan orders require a supported duration snapshot'
);

select * from finish();
rollback;
