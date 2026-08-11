begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(54);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'e3-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"E3 Admin"}', now() - interval '90 days', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'historical@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '40 days', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Historical"}', now() - interval '40 days', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'getting-started@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '3 hours', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Getting Started"}', now() - interval '3 hours', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'never-practised@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '25 hours', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Never Practised"}', now() - interval '25 hours', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'practised-unpaid@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '5 days', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Practised Unpaid"}', now() - interval '5 days', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'checkout@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '10 days', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Checkout"}', now() - interval '10 days', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'expiring@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '30 days', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Expiring"}', now() - interval '30 days', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'suppressed@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '20 minutes', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Suppressed"}', now() - interval '20 minutes', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'opted-out@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '20 minutes', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Opted Out"}', now() - interval '20 minutes', now()),
  ('00000000-0000-0000-0000-000000000000', 'e3000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'recently-contacted@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now() - interval '20 minutes', '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Recently Contacted"}', now() - interval '20 minutes', now());

update public.profiles set role = 'admin' where id = 'e3000000-0000-4000-8000-000000000001';
update public.profiles profile set created_at = auth_user.created_at
from auth.users auth_user where profile.id = auth_user.id and profile.id::text like 'e3000000-%';

insert into public.exam_packs (id, slug, name, description, price_kobo, currency, active_until, is_active)
values ('e3100000-0000-4000-8000-000000000001', 'e3-test-pack', 'E3 Test Pack', 'E3 tests', 250000, 'NGN', current_date + 365, false);
insert into public.subjects (id, name, slug, description, sort_order, is_active)
values
  ('e3200000-0000-4000-8000-000000000001', 'E3 Practised Module', 'e3-practised-module', 'E3 tests', 991, true),
  ('e3200000-0000-4000-8000-000000000002', 'E3 Checkout Module', 'e3-checkout-module', 'E3 tests', 992, true),
  ('e3200000-0000-4000-8000-000000000003', 'E3 Expiring Module', 'e3-expiring-module', 'E3 tests', 993, true);
insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
values
  ('e3300000-0000-4000-8000-000000000001', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001', 250000, 'NGN', true),
  ('e3300000-0000-4000-8000-000000000002', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000002', 250000, 'NGN', true),
  ('e3300000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000003', 250000, 'NGN', true);

insert into public.attempts (
  id, user_id, exam_pack_id, subject_id, mode, started_at, completed_at,
  score, total_questions, passed
) values
(
  'e3400000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000005',
  'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001',
  'practice', now() - interval '26 hours', now() - interval '26 hours', 5, 10, false
),
(
  'e3400000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000005',
  'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000002',
  'practice', now() - interval '25 hours', now() - interval '25 hours', 6, 10, false
);

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id, provider_reference,
  status, amount_kobo, list_price_kobo, currency, provider_status,
  fulfillment_status, paid_at, created_at
) values
  ('e3500000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000006', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000001', 'PS-e3-unrelated-paid', 'active', 250000, 250000, 'NGN', 'success', 'fulfilled', now() - interval '5 days', now() - interval '5 days'),
  ('e3500000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000006', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000002', 'e3300000-0000-4000-8000-000000000002', 'PS-e3-incomplete', 'pending', 250000, 250000, 'NGN', 'initialized', 'pending', null, now() - interval '3 hours'),
  ('e3500000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000007', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000003', 'e3300000-0000-4000-8000-000000000003', 'PS-e3-expiring', 'active', 250000, 250000, 'NGN', 'success', 'fulfilled', now() - interval '23 days', now() - interval '23 days'),
  ('e3500000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000005', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000001', 'PS-e3-practised-paid', 'active', 250000, 250000, 'NGN', 'success', 'fulfilled', now() - interval '2 days', now() - interval '2 days'),
  ('e3500000-0000-4000-8000-000000000005', 'e3000000-0000-4000-8000-000000000003', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000002', 'e3300000-0000-4000-8000-000000000002', 'PS-e3-getting-checkout', 'pending', 250000, 250000, 'NGN', 'initialized', 'pending', null, now() - interval '3 hours'),
  ('e3500000-0000-4000-8000-000000000006', 'e3000000-0000-4000-8000-000000000005', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000003', 'e3300000-0000-4000-8000-000000000003', 'PS-e3-practice-checkout', 'pending', 250000, 250000, 'NGN', 'initialized', 'pending', null, now() - interval '3 hours');
insert into public.payment_order_items (payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo)
values
  ('e3500000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000001', 250000, 250000),
  ('e3500000-0000-4000-8000-000000000002', 'e3200000-0000-4000-8000-000000000002', 'e3300000-0000-4000-8000-000000000002', 250000, 250000),
  ('e3500000-0000-4000-8000-000000000003', 'e3200000-0000-4000-8000-000000000003', 'e3300000-0000-4000-8000-000000000003', 250000, 250000),
  ('e3500000-0000-4000-8000-000000000004', 'e3200000-0000-4000-8000-000000000001', 'e3300000-0000-4000-8000-000000000001', 250000, 250000),
  ('e3500000-0000-4000-8000-000000000005', 'e3200000-0000-4000-8000-000000000002', 'e3300000-0000-4000-8000-000000000002', 250000, 250000),
  ('e3500000-0000-4000-8000-000000000006', 'e3200000-0000-4000-8000-000000000003', 'e3300000-0000-4000-8000-000000000003', 250000, 250000),
  ('e3500000-0000-4000-8000-000000000003', 'e3200000-0000-4000-8000-000000000002', 'e3300000-0000-4000-8000-000000000002', 250000, 250000);
insert into public.module_entitlements (
  id, user_id, exam_pack_id, subject_id, payment_order_id, status,
  starts_at, expires_at, created_at
) values
  ('e3600000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000006', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001', 'e3500000-0000-4000-8000-000000000001', 'active', now() - interval '5 days', now() + interval '25 days', now() - interval '5 days'),
  ('e3600000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000007', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000003', 'e3500000-0000-4000-8000-000000000003', 'active', now() - interval '23 days', date_trunc('day', now()) + interval '6 days 12 hours', now() - interval '23 days'),
  ('e3600000-0000-4000-8000-000000000006', 'e3000000-0000-4000-8000-000000000005', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001', 'e3500000-0000-4000-8000-000000000004', 'active', now() - interval '2 days', now() + interval '28 days', now() - interval '2 days'),
  ('e3600000-0000-4000-8000-000000000007', 'e3000000-0000-4000-8000-000000000007', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000002', 'e3500000-0000-4000-8000-000000000003', 'active', now() - interval '23 days', date_trunc('day', now()) + interval '6 days 12 hours', now() - interval '23 days');

select is((select count(*) from public.email_lifecycle_automations), 5::bigint, 'all five lifecycle automations are seeded');
select is((select lifecycle_min_interval_hours from public.email_runtime_config where singleton), 24, 'lifecycle engagement interval defaults to 24 hours');
select is((select engagement_min_interval_hours from public.email_runtime_config where singleton), 168, 'ordinary engagement interval remains 168 hours');
select is((select count(*) from public.email_lifecycle_automations where not enabled and activated_at is null), 5::bigint, 'all automations are disabled and unactivated by default');
select is(public.evaluate_email_lifecycle_automations(100)->>'queued', '0', 'disabled automations cannot queue historical work');
select is((select count(*) from public.email_lifecycle_instances), 0::bigint, 'disabled evaluation creates no lifecycle instances');
select is((select count(*) from public.transactional_email_events where lifecycle_instance_id is not null), 0::bigint, 'disabled evaluation creates no E1 events');
select set_config('test.e3_getting_template', (select template_id::text from public.email_lifecycle_automations where automation_key = 'getting_started'), true);
select set_config('test.e3_never_template', (select template_id::text from public.email_lifecycle_automations where automation_key = 'never_practised'), true);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000003', true);
select throws_ok($$ select public.get_admin_email_automations() $$, 'P0001', 'Admin access is required', 'candidate cannot inspect lifecycle configuration');
select throws_ok($$ select public.get_admin_email_automation_history() $$, 'P0001', 'Admin access is required', 'candidate cannot inspect lifecycle history');
select throws_ok(format(
  'select public.admin_update_email_automation(%L, true, 10, %L::uuid)',
  'getting_started', current_setting('test.e3_getting_template')
), 'P0001', 'Admin access is required', 'candidate cannot enable a lifecycle automation');

select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.get_admin_email_automations()->'items'), 5, 'admin sees five lifecycle configurations');
select throws_ok(format(
  'select public.admin_update_email_automation(%L, true, 1, %L::uuid)',
  'getting_started', current_setting('test.e3_getting_template')
), 'P0001', 'Choose a timing within the allowed range', 'admin timing is bounded server-side');

reset role;
set local role service_role;
update public.email_lifecycle_automations
set enabled = true, activated_at = now() - interval '2 days'
where automation_key in ('getting_started', 'never_practised', 'practised_unpaid', 'incomplete_checkout', 'access_expiring');
select lives_ok($$ select public.evaluate_email_lifecycle_automations(100) $$, 'enabled lifecycle evaluation completes');

select ok(exists (
  select 1 from public.email_lifecycle_instances
  where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000003' and state = 'queued'
), 'getting started queues after the configured ten-minute delay');
select is((select round(extract(epoch from (due_at - trigger_at)))::integer from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000003'), 600, 'getting started due time is exactly ten minutes after its trigger');
select ok(not exists (
  select 1 from public.email_lifecycle_instances
  where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000002'
), 'activation cutoff excludes historical accounts');
select is((select count(*) from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000003'), 1::bigint, 'getting started has one deterministic instance');
select lives_ok($$ select public.evaluate_email_lifecycle_automations(100) $$, 'repeat evaluation is safe');
select is((select count(*) from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000003'), 1::bigint, 'repeat evaluation does not duplicate lifecycle instances');
select is((select count(*) from public.transactional_email_events event join public.email_lifecycle_instances instance on instance.id = event.lifecycle_instance_id where instance.automation_key = 'getting_started' and instance.user_id = 'e3000000-0000-4000-8000-000000000003'), 1::bigint, 'repeat evaluation does not duplicate E1 events');
select ok(exists (
  select 1 from public.email_lifecycle_instances
  where automation_key = 'never_practised' and user_id = 'e3000000-0000-4000-8000-000000000004' and state = 'queued'
), 'never practised queues after 24 hours when no practice exists');
select ok(exists (
  select 1 from public.email_lifecycle_instances
  where automation_key = 'practised_unpaid' and user_id = 'e3000000-0000-4000-8000-000000000005' and state = 'queued'
    and metadata->>'subject_id' = 'e3200000-0000-4000-8000-000000000002'
), 'practised unpaid selects the first unpaid module even when an earlier practised module is paid');
select is((select round(extract(epoch from (due_at - trigger_at)))::integer from public.email_lifecycle_instances where automation_key = 'practised_unpaid' and user_id = 'e3000000-0000-4000-8000-000000000005'), 86400, 'practised unpaid due time is exactly 24 hours after qualifying practice');
select ok(exists (
  select 1 from public.email_lifecycle_instances
  where automation_key = 'incomplete_checkout' and source_id = 'e3500000-0000-4000-8000-000000000002' and state = 'queued'
), 'purchase-specific incomplete checkout qualifies despite an unrelated fulfilled purchase and entitlement');
select is((select round(extract(epoch from (due_at - trigger_at)))::integer from public.email_lifecycle_instances where automation_key = 'incomplete_checkout' and source_id = 'e3500000-0000-4000-8000-000000000002'), 7200, 'incomplete checkout due time is exactly two hours after order creation');
select ok(exists (
  select 1 from public.email_lifecycle_instances
  where automation_key = 'access_expiring' and user_id = 'e3000000-0000-4000-8000-000000000007' and state = 'queued'
), 'paid access queues seven days before its authoritative expiry');
select is((
  select count(*) from public.email_lifecycle_instances
  where automation_key = 'access_expiring' and user_id = 'e3000000-0000-4000-8000-000000000007'
), 1::bigint, 'same-day module expiries produce one user access-scope reminder');
select is((
  select (metadata->>'module_count')::integer from public.email_lifecycle_instances
  where automation_key = 'access_expiring' and user_id = 'e3000000-0000-4000-8000-000000000007'
), 2, 'the access-scope reminder records both expiring modules');
select is((
  select round(extract(epoch from (trigger_at - due_at)))::integer
  from public.email_lifecycle_instances where automation_key = 'access_expiring' and user_id = 'e3000000-0000-4000-8000-000000000007'
), 0, 'access-expiring trigger and due timestamps represent the configured pre-expiry instant');
select is((
  select round(extract(epoch from ((metadata->>'expires_at')::timestamptz - due_at)))::integer
  from public.email_lifecycle_instances where automation_key = 'access_expiring' and user_id = 'e3000000-0000-4000-8000-000000000007'
), 604800, 'access-expiring due time is exactly seven days before authoritative expiry');
select ok(not exists (
  select 1 from public.email_lifecycle_instances instance
  where instance.user_id = 'e3000000-0000-4000-8000-000000000002'
), 'historical practice, checkout, entitlement, and account sources are not backfilled');

update public.transactional_email_events event
set status = 'sent', dispatch_status = 'accepted', delivery_status = 'sent', accepted_at = now() - interval '23 hours'
from public.email_lifecycle_instances instance
where event.lifecycle_instance_id = instance.id and instance.automation_key = 'getting_started'
  and instance.user_id = 'e3000000-0000-4000-8000-000000000004';
select is(public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances
  where automation_key = 'never_practised' and user_id = 'e3000000-0000-4000-8000-000000000004'
))->>'reason', 'recently_contacted', 'getting started defers never-practised inside the 24-hour lifecycle interval');
update public.transactional_email_events event
set accepted_at = now() - interval '25 hours'
from public.email_lifecycle_instances instance
where event.lifecycle_instance_id = instance.id and instance.automation_key = 'getting_started'
  and instance.user_id = 'e3000000-0000-4000-8000-000000000004';
select is((public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances
  where automation_key = 'never_practised' and user_id = 'e3000000-0000-4000-8000-000000000004'
))->>'allowed')::boolean, true, 'never-practised may send after the lifecycle interval has elapsed');
reset role;
select is((
  select exclusion_reason from private.e2_audience_rows(
    'individual', array['e3000000-0000-4000-8000-000000000004'::uuid], null, '{}'::jsonb, 'engagement'
  )
), 'recently_contacted', 'a prior lifecycle email still applies the 168-hour interval to a later manual engagement');
set local role service_role;

update public.transactional_email_events event
set status = 'sent', dispatch_status = 'accepted', delivery_status = 'sent', accepted_at = now() - interval '23 hours'
from public.email_lifecycle_instances instance
where event.lifecycle_instance_id = instance.id and instance.automation_key = 'getting_started'
  and instance.user_id = 'e3000000-0000-4000-8000-000000000003';
select is(public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances
  where automation_key = 'incomplete_checkout' and source_id = 'e3500000-0000-4000-8000-000000000005'
))->>'reason', 'recently_contacted', 'getting started defers incomplete checkout inside the lifecycle interval');

update public.transactional_email_events event
set status = 'sent', dispatch_status = 'accepted', delivery_status = 'sent', accepted_at = now() - interval '23 hours'
from public.email_lifecycle_instances instance
where event.lifecycle_instance_id = instance.id and instance.automation_key = 'practised_unpaid'
  and instance.user_id = 'e3000000-0000-4000-8000-000000000005';
select is(public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances
  where automation_key = 'incomplete_checkout' and source_id = 'e3500000-0000-4000-8000-000000000006'
))->>'reason', 'recently_contacted', 'practised-unpaid defers incomplete checkout inside the lifecycle interval');

insert into public.attempts (id, user_id, exam_pack_id, subject_id, mode, started_at, completed_at, score, total_questions, passed)
values ('e3400000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000004', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000001', 'practice', now(), now(), 1, 10, false);
select is(public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances where automation_key = 'never_practised' and user_id = 'e3000000-0000-4000-8000-000000000004'
))->>'reason', 'practice_started', 'send-time validation cancels never-practised after practice begins');

insert into public.module_entitlements (id, user_id, exam_pack_id, subject_id, status, starts_at, expires_at)
values ('e3600000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000005', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000002', 'active', now(), now() + interval '30 days');
select is(public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances where automation_key = 'practised_unpaid' and user_id = 'e3000000-0000-4000-8000-000000000005'
))->>'reason', 'relevant_access_obtained', 'send-time validation cancels practised-unpaid after relevant access is obtained');

insert into public.module_entitlements (id, user_id, exam_pack_id, subject_id, status, starts_at, expires_at, created_at)
values ('e3600000-0000-4000-8000-000000000004', 'e3000000-0000-4000-8000-000000000006', 'e3100000-0000-4000-8000-000000000001', 'e3200000-0000-4000-8000-000000000002', 'active', now(), now() + interval '30 days', now());
select is(public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances where automation_key = 'incomplete_checkout' and source_id = 'e3500000-0000-4000-8000-000000000002'
))->>'reason', 'checkout_satisfied', 'send-time validation cancels checkout after intended access is obtained');

update public.module_entitlements
set expires_at = now() + interval '40 days'
where user_id = 'e3000000-0000-4000-8000-000000000007';
select is(public.system_validate_e3_lifecycle_event((
  select transactional_email_event_id from public.email_lifecycle_instances where automation_key = 'access_expiring' and user_id = 'e3000000-0000-4000-8000-000000000007'
))->>'reason', 'access_renewed_or_replaced', 'send-time validation cancels an expiry reminder after renewal or replacement');

insert into public.email_preferences (user_id, marketing_opted_out, opted_out_at, opt_out_source)
values ('e3000000-0000-4000-8000-000000000009', true, now(), 'test');
insert into public.email_suppressions (email, reason, source, active)
values ('suppressed@example.test', 'manual', 'e3_test', true);
select is((
  select public.system_validate_e3_lifecycle_event(transactional_email_event_id)->>'reason'
  from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000009'
), 'opted_out', 'engagement opt-out is revalidated before dispatch');
select is((
  select public.system_validate_e3_lifecycle_event(transactional_email_event_id)->>'reason'
  from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000008'
), 'suppressed', 'technical suppression is independently revalidated before dispatch');

insert into public.transactional_email_events (
  event_key, event_type, template_key, category, user_id, status, dispatch_status,
  delivery_status, accepted_at
) values (
  'e3-recent-engagement', 'admin_campaign', 'admin_campaign', 'engagement',
  'e3000000-0000-4000-8000-000000000010', 'sent', 'accepted', 'sent', now() - interval '1 hour'
);
select is((
  select public.system_validate_e3_lifecycle_event(transactional_email_event_id)->>'reason'
  from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000010'
), 'recently_contacted', 'engagement frequency protection defers a recently contacted candidate');
select is((
  select public.system_validate_e3_lifecycle_event(transactional_email_event_id)->>'disposition'
  from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000010'
), 'defer', 'recent engagement produces a resumable defer disposition');
update public.transactional_email_events
set accepted_at = now() - interval '25 hours'
where event_key = 'e3-recent-engagement';
select is((
  select (public.system_validate_e3_lifecycle_event(transactional_email_event_id)->>'allowed')::boolean
  from public.email_lifecycle_instances where automation_key = 'getting_started' and user_id = 'e3000000-0000-4000-8000-000000000010'
), true, 'a lifecycle email may send 24 hours after a prior manual engagement');

select is((
  select category from public.transactional_email_events where lifecycle_instance_id is not null limit 1
), 'engagement', 'lifecycle events use the E1 engagement category and its daily claim cap');
select is((
  select template_key from public.transactional_email_events where lifecycle_instance_id is not null limit 1
), 'admin_campaign', 'lifecycle events reuse the E1 structured campaign renderer');
select ok((
  select event_key = 'lifecycle:' || instance.automation_key || ':' || instance.source_key
  from public.email_lifecycle_instances instance
  join public.transactional_email_events event on event.id = instance.transactional_email_event_id
  where instance.automation_key = 'incomplete_checkout' limit 1
), 'E1 lifecycle event keys are deterministic from automation and source');
select set_config('test.e3_getting_count', (select count(*)::text from public.email_lifecycle_instances where automation_key = 'getting_started'), true);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);
select is((public.get_admin_email_automation_history('getting_started', 'all', null, 50, 0)->>'total')::integer,
  current_setting('test.e3_getting_count')::integer,
  'admin lifecycle history returns authoritative instance totals');
select ok((public.get_admin_email_automations() #>> '{items,0,name}') is not null, 'admin configuration projection remains readable after evaluation');
select is((public.admin_update_email_automation(
  'never_practised', false, 1440, current_setting('test.e3_never_template')::uuid
)->>'enabled')::boolean, false, 'admin can disable an automation');
reset role;
set local role service_role;
select is((select state from public.email_lifecycle_instances where automation_key = 'never_practised' and user_id = 'e3000000-0000-4000-8000-000000000004'), 'cancelled', 'disabling cancels queued work before dispatch');
select is((select dispatch_status from public.transactional_email_events event join public.email_lifecycle_instances instance on instance.id = event.lifecycle_instance_id where instance.automation_key = 'never_practised' and instance.user_id = 'e3000000-0000-4000-8000-000000000004'), 'cancelled', 'disabling cancels the corresponding pending E1 event');
select ok((select activated_at is null from public.email_lifecycle_automations where automation_key = 'never_practised'), 'disabled automation clears its activation cutoff');

select * from finish();
rollback;
