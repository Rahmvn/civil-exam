begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(57);

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

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select is(
  (
    select count(*)::integer
    from public.get_purchase_pricing_catalog_v1()
    where is_available = true
  ),
  4,
  'anonymous visitors can read available pricing plans before sign-in'
);

reset role;
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

select throws_ok(
  $$ select * from public.purchase_durations $$,
  '42501', null,
  'candidates cannot read operational duration rows directly'
);

select throws_ok(
  $$ select * from public.get_admin_purchase_durations() $$,
  'P0001', 'Admin access is required',
  'candidates cannot use duration administration RPCs'
);

select throws_ok(
  $$ select * from public.get_admin_purchase_pricing_guidance() $$,
  'P0001', 'Admin access is required',
  'candidates cannot read advisory Admin pricing guidance'
);

select is(
  (
    select array_agg((duration->>'duration_months')::integer order by (duration->>'duration_months')::integer)
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'individual_objective'
  ),
  array[1, 2, 3],
  'candidate catalog exposes exactly the globally enabled duration set'
);

select is(
  (
    select count(*)::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where (duration->>'duration_months')::integer = 6
  ),
  0,
  'historical six-month duration is absent from future checkout'
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
      and (duration->>'duration_months')::integer = 2
  ),
  650000,
  'candidate catalog returns the approved two-month oral price'
);

select is(
  (
    select array_agg((duration->>'price_kobo')::integer order by (duration->>'duration_months')::integer)
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'individual_objective'
  ),
  array[250000, 450000, 650000],
  'objective checkout exposes the complete approved one-two-three-month price matrix'
);

select is(
  (
    select array_agg((duration->>'price_kobo')::integer order by (duration->>'duration_months')::integer)
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'individual_oral'
  ),
  array[350000, 650000, 900000],
  'oral checkout exposes the complete approved one-two-three-month price matrix'
);

select is(
  (
    select array_agg((duration->>'price_kobo')::integer order by (duration->>'duration_months')::integer)
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'three_module_bundle'
  ),
  array[600000, 1100000, 1550000],
  'Pick 3 checkout exposes the complete approved one-two-three-month price matrix'
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
    select (duration->>'price_kobo')::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where catalog.plan_code = 'complete_bundle'
      and (duration->>'duration_months')::integer = 2
  ),
  850000,
  'complete bundle two-month price uses its configured generic per-module rule'
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

select is(
  (
    select recommended_price_kobo
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'individual_objective' and duration_months = 1
  ),
  250000,
  'one-month guidance recommends the authoritative one-month price without a discount'
);

select is(
  (
    select recommended_price_kobo
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'individual_objective' and duration_months = 3
  ),
  650000,
  'three-month recommendation applies the configured saving with clean NGN rounding'
);

select is(
  (
    select array_agg(distinct recommended_discount_bps order by recommended_discount_bps)
    from public.get_admin_purchase_pricing_guidance()
    where duration_months in (1, 2, 3)
  ),
  array[0, 700, 1400],
  'the one-two-three-month recommendation policy is server-owned'
);

select is(
  (
    select full_monthly_total_kobo
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'individual_objective' and duration_months = 2
  ),
  500000,
  'guidance derives the full duration total from the authoritative one-month price'
);

select is(
  (
    select recommended_price_kobo
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'individual_objective' and duration_months = 2
  ),
  450000,
  'two-month guidance recommends the configured rounded starting price'
);

select is(
  (
    select jsonb_build_array(actual_saving_kobo, actual_saving_percent)
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'individual_objective' and duration_months = 2
  ),
  jsonb_build_array(50000, 10.0),
  'actual savings are derived from the configured selling price rather than recommendation copy'
);

select is(
  (
    select jsonb_build_array(
      current_available_module_count,
      one_month_price_kobo,
      full_monthly_total_kobo,
      recommended_price_kobo,
      actual_price_kobo
    )
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'complete_bundle' and duration_months = 2
  ),
  jsonb_build_array(3, 450000, 900000, 850000, 850000),
  'Complete guidance uses the authoritative current module count and one-month total'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('three_module_bundle', 1, 650000, 750000, 'Admin price test', true) $$,
  'admin can edit fixed duration prices through the audited RPC'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('complete_bundle', 2, 850000, null, '', true) $$,
  'admin can configure a clean current Complete Bundle total through the shared pricing RPC'
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
  3,
  'pricing copy and price edits are audited'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('individual_objective', 2, 500000, null, '', true) $$,
  'admin can override a recommendation through the existing audited selling-price path'
);

select is(
  (
    select jsonb_build_array(recommended_price_kobo, actual_price_kobo)
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'individual_objective' and duration_months = 2
  ),
  jsonb_build_array(450000, 500000),
  'a saved custom selling price remains distinct from its advisory recommendation'
);

set local role service_role;
select is(
  (
    select amount_kobo
    from public.get_purchase_plan_checkout_price('individual_objective', 2, 1)
  ),
  500000,
  'checkout resolves the saved backend selling price and never the recommendation'
);

set local role authenticated;
select lives_ok(
  $$ select public.admin_save_purchase_plan_price('individual_objective', 2, 450000, null, '', true) $$,
  'the approved current selling price can be restored without changing guidance policy'
);

select is(
  (select array_agg(months order by sort_order) from public.get_admin_purchase_durations() where enabled),
  array[1, 2, 3],
  'admin duration catalog starts with one, two, and three months enabled'
);

select is(
  (select array_agg(months order by sort_order) from public.get_admin_purchase_durations() where not enabled),
  array[6],
  'six months remains queryable as disabled historical configuration'
);

select throws_ok(
  $$ select public.admin_create_purchase_duration(2, 25) $$,
  'P0001', 'That access duration already exists',
  'duplicate duration months are rejected'
);

select lives_ok(
  $$ select public.admin_create_purchase_duration(4, 40) $$,
  'admin can create a new disabled positive whole-month duration'
);

select is(
  (
    select jsonb_build_array(recommended_discount_bps, recommended_price_kobo)
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'individual_objective' and duration_months = 4
  ),
  jsonb_build_array(null, null),
  'arbitrary new durations do not receive a fabricated hidden recommendation'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('individual_objective', 4, 800000, null, '', true) $$,
  'admin can configure the new objective duration price'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('individual_oral', 4, 1100000, null, '', true) $$,
  'admin can configure the new oral duration price'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('three_module_bundle', 4, 2000000, null, '', true) $$,
  'admin can configure the new Pick 3 duration price'
);

select lives_ok(
  $$ select public.admin_save_purchase_plan_price('complete_bundle', 4, 1500000, null, '', true) $$,
  'admin can configure the new Complete duration price'
);

select lives_ok(
  $$ select public.admin_update_purchase_duration(4, true, 40) $$,
  'admin can enable a fully configured duration'
);

select is(
  (
    select count(*)::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where (duration->>'duration_months')::integer = 4
  ),
  4,
  'enabled configured duration appears on every candidate plan'
);

select lives_ok(
  $$ select public.admin_update_purchase_duration(4, false, 40) $$,
  'admin can disable a duration without deleting its configuration'
);

select is(
  (
    select count(*)::integer
    from public.get_purchase_pricing_catalog_v1() catalog
    cross join lateral jsonb_array_elements(catalog.durations) duration
    where (duration->>'duration_months')::integer = 4
  ),
  0,
  'disabled duration disappears from future candidate checkout'
);

reset role;

select throws_ok(
  $$ update public.purchase_durations set months = 5 where months = 4 $$,
  'P0001', 'Access duration months cannot be changed after creation',
  'duration month semantics are immutable after creation'
);

set local role service_role;

select is(
  (
    select amount_kobo
    from public.get_purchase_plan_checkout_price('individual_objective', 2, 1)
  ),
  450000,
  'server checkout resolver returns the authoritative enabled two-month price'
);

select throws_ok(
  $$ select * from public.get_purchase_plan_checkout_price('individual_objective', 6, 1) $$,
  'P0001', 'This access duration is not currently available',
  'server checkout rejects disabled historical durations'
);

reset role;

select is(
  (
    select array_agg(amount_kobo order by duration_months)
    from (
      select duration_months, amount_kobo
      from public.get_purchase_plan_checkout_price('complete_bundle', 1, 11)
      union all
      select duration_months, amount_kobo
      from public.get_purchase_plan_checkout_price('complete_bundle', 2, 11)
      union all
      select duration_months, amount_kobo
      from public.get_purchase_plan_checkout_price('complete_bundle', 3, 11)
    ) complete_prices
  ),
  array[1650000, 3100000, 4300000],
  'Complete Bundle resolves clean totals from an authoritative eleven-module input'
);

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
      'fd100000-0000-4000-8000-000000000006',
      'fa100000-0000-4000-8000-000000000001',
      pack.id,
      null,
      null,
      'pricing_plan',
      plan.id,
      plan.code,
      6,
      '3-Module Bundle - 6 months',
      'plan:historical-six-month-order',
      'PS-PLAN-HISTORICAL-SIX',
      2650000,
      3600000,
      'pricing_plan',
      'NGN',
      'pending',
      'initialized',
      'pending',
      3,
      'duration_pricing_v1',
      jsonb_build_object(
        'plan_code', plan.code,
        'duration_months', 6,
        'price_kobo', 2650000
      )
    from public.purchase_plans plan
    cross join lateral (
      select id from public.exam_packs where is_active = true
      order by active_from desc, created_at desc limit 1
    ) pack
    where plan.code = 'three_module_bundle'
  $$,
  'historical six-month pending orders remain valid after the catalog cutover'
);

update public.purchase_plan_prices price
set price_kobo = 2700000
from public.purchase_plans plan
where price.purchase_plan_id = plan.id
  and plan.code = 'three_module_bundle'
  and price.duration_months = 6;

select is(
  (
    select jsonb_build_array(duration_months, amount_kobo, purchase_snapshot->>'price_kobo')
    from public.payment_orders
    where id = 'fd100000-0000-4000-8000-000000000006'
  ),
  jsonb_build_array(6, 2650000, '2650000'),
  'historical order duration and agreed amount remain immutable after catalog price changes'
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

reset role;
update public.subjects
set candidate_availability = 'coming_soon'
where id = 'fb100000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'fa100000-0000-4000-8000-000000000002', true);

select is(
  (
    select jsonb_build_array(
      current_available_module_count,
      recommended_price_kobo,
      actual_price_kobo
    )
    from public.get_admin_purchase_pricing_guidance()
    where plan_code = 'complete_bundle' and duration_months = 2
  ),
  jsonb_build_array(2, 550000, 600000),
  'module-count changes recalculate Complete guidance without replacing the saved custom unit price'
);

reset role;
update public.subjects
set candidate_availability = 'available'
where id = 'fb100000-0000-4000-8000-000000000002';

select * from finish();
rollback;
