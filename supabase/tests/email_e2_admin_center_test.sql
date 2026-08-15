begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(76);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'e2-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"E2 Admin"}', now() - interval '60 days', now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'recent-unpaid@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Recent Unpaid"}', now() - interval '3 days', now()),
  ('00000000-0000-0000-0000-000000000000', 'e2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'paid-active@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Paid Active"}', now() - interval '40 days', now()),
  ('00000000-0000-0000-8000-000000000004', 'e2000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'expired-practice@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Expired Practice"}', now() - interval '20 days', now()),
  ('00000000-0000-0000-8000-000000000005', 'e2000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'checkout@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Checkout Candidate"}', now() - interval '10 days', now()),
  ('00000000-0000-0000-8000-000000000006', 'e2000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'unconfirmed@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), null, '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Unconfirmed Candidate"}', now() - interval '2 days', now());

update public.profiles set role = 'admin' where id = 'e2000000-0000-4000-8000-000000000001';
update public.profiles set created_at = now() - interval '3 days' where id = 'e2000000-0000-4000-8000-000000000002';
update public.profiles set created_at = now() - interval '40 days' where id = 'e2000000-0000-4000-8000-000000000003';
update public.profiles set created_at = now() - interval '20 days' where id = 'e2000000-0000-4000-8000-000000000004';
update public.profiles set created_at = now() - interval '10 days' where id = 'e2000000-0000-4000-8000-000000000005';

insert into public.exam_packs (id, slug, name, description, price_kobo, currency, active_until, is_active)
values ('e2100000-0000-4000-8000-000000000001', 'e2-test-pack', 'E2 Test Pack', 'E2 tests', 250000, 'NGN', current_date + 365, false);
insert into public.subjects (id, name, slug, description, sort_order, is_active)
values
  ('e2200000-0000-4000-8000-000000000001', 'E2 Test Module', 'e2-test-module', 'E2 tests', 997, true),
  ('e2200000-0000-4000-8000-000000000002', 'E2 Later Module', 'e2-later-module', 'E2 tests', 998, true),
  ('e2200000-0000-4000-8000-000000000003', 'E2 Superset Module', 'e2-superset-module', 'E2 tests', 999, true);
insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
values
  ('e2300000-0000-4000-8000-000000000001', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 250000, 'NGN', true),
  ('e2300000-0000-4000-8000-000000000002', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000002', 250000, 'NGN', true),
  ('e2300000-0000-4000-8000-000000000003', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000003', 250000, 'NGN', true);

insert into public.purchase_offers (
  id, exam_pack_id, name, offer_type, selection_count, price_kobo, currency, enabled
) values (
  'e2350000-0000-4000-8000-000000000001', 'e2100000-0000-4000-8000-000000000001',
  'E2 Superset Offer', 'full_bundle', null, 400000, 'NGN', true
);

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id, provider_reference,
  status, amount_kobo, list_price_kobo, currency, provider_status, fulfillment_status, paid_at, created_at
) values
  ('e2400000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000003', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 'e2300000-0000-4000-8000-000000000001', 'PS-e2-paid', 'active', 250000, 250000, 'NGN', 'success', 'fulfilled', now(), now() - interval '10 days'),
  ('e2400000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000005', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 'e2300000-0000-4000-8000-000000000001', 'PS-e2-checkout', 'pending', 250000, 250000, 'NGN', 'initialized', 'pending', null, now() - interval '2 hours'),
  ('e2400000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000003', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000002', 'e2300000-0000-4000-8000-000000000002', 'PS-e2-later-checkout', 'pending', 250000, 250000, 'NGN', 'initialized', 'pending', null, now() - interval '2 hours');

insert into public.payment_order_items (
  payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
) values
  ('e2400000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 'e2300000-0000-4000-8000-000000000001', 250000, 250000),
  ('e2400000-0000-4000-8000-000000000002', 'e2200000-0000-4000-8000-000000000001', 'e2300000-0000-4000-8000-000000000001', 250000, 250000),
  ('e2400000-0000-4000-8000-000000000003', 'e2200000-0000-4000-8000-000000000002', 'e2300000-0000-4000-8000-000000000002', 250000, 250000);

insert into public.module_entitlements (id, user_id, exam_pack_id, subject_id, payment_order_id, status, starts_at, expires_at)
values
  ('e2500000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000003', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 'e2400000-0000-4000-8000-000000000001', 'active', now() - interval '10 days', now() + interval '20 days'),
  ('e2500000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000004', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', null, 'active', now() - interval '60 days', now() - interval '1 day');

insert into public.attempts (id, user_id, exam_pack_id, subject_id, mode, started_at, completed_at, score, total_questions, passed)
values
  ('e2600000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000004', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 'practice', now() - interval '3 days', now() - interval '3 days', 2, 10, false),
  ('e2600000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000003', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 'practice', now() - interval '2 days', now() - interval '2 days', 8, 10, true);

select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'paid'), 'fulfilled payment qualifies as paid');
select ok(not private.e2_segment_matches('e2000000-0000-4000-8000-000000000002', 'paid'), 'unpaid user does not qualify as paid');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000002', 'unpaid'), 'no fulfilled payment qualifies as unpaid');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'active_access'), 'unexpired entitlement qualifies as active access');
select ok(not private.e2_segment_matches('e2000000-0000-4000-8000-000000000004', 'active_access'), 'expired entitlement is not active access');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000004', 'expired_access'), 'prior expired entitlement qualifies as expired access');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000004', 'started_practice'), 'attempt qualifies as started practice');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000002', 'never_practised'), 'no attempt qualifies as never practised');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000004', 'practised_unpaid'), 'practice without current paid truth qualifies');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000005', 'incomplete_checkout'), 'mature pending checkout qualifies');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'incomplete_checkout'), 'a prior fulfilled purchase and unrelated active module do not hide a later incomplete checkout');

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id, purchase_type,
  purchase_offer_id, purchase_label, checkout_key, pricing_type, provider_reference,
  status, amount_kobo, list_price_kobo, currency, provider_status,
  fulfillment_status, paid_at, created_at
) values (
  'e2400000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000003',
  'e2100000-0000-4000-8000-000000000001', null, null, 'bundle_offer',
  'e2350000-0000-4000-8000-000000000001', 'E2 Superset Offer', 'e2-superset-fulfilled',
  'bundle_offer', 'PS-e2-superset-fulfilled', 'active', 400000, 500000, 'NGN',
  'success', 'fulfilled', now() - interval '1 hour', now() - interval '1 hour'
);
insert into public.payment_order_items (
  payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo
) values
  ('e2400000-0000-4000-8000-000000000004', 'e2200000-0000-4000-8000-000000000002', 'e2300000-0000-4000-8000-000000000002', 250000, 200000),
  ('e2400000-0000-4000-8000-000000000004', 'e2200000-0000-4000-8000-000000000003', 'e2300000-0000-4000-8000-000000000003', 250000, 200000);
select ok(not private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'incomplete_checkout'), 'a later fulfilled superset containing the intended module satisfies the abandoned checkout');

insert into public.module_entitlements (
  id, user_id, exam_pack_id, subject_id, payment_order_id, status, starts_at, expires_at, created_at
) values (
  'e2500000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000005',
  'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001',
  null, 'active', now() - interval '30 minutes', now() + interval '30 days', now() - interval '30 minutes'
);
select ok(not private.e2_segment_matches('e2000000-0000-4000-8000-000000000005', 'incomplete_checkout'), 'access granted after checkout satisfies the matching abandoned module');
delete from public.module_entitlements where id = 'e2500000-0000-4000-8000-000000000003';
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'active_module_access', '{"module_id":"e2200000-0000-4000-8000-000000000001"}'), 'module access uses the requested module');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000002', 'joined_last_7_days'), 'recent user qualifies for seven-day segment');
select ok(not private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'joined_last_30_days'), 'old user does not qualify for thirty-day segment');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'latest_objective_passed'), 'latest stored passed truth is used');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000004', 'latest_objective_needs_retry'), 'latest stored failed truth is used');
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000002', 'engagement_subscribers'), 'default consent qualifies for the engagement subscriber segment');

insert into public.attempts (id, user_id, exam_pack_id, subject_id, mode, started_at, completed_at, score, total_questions, passed)
values ('e2600000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000004', 'e2100000-0000-4000-8000-000000000001', 'e2200000-0000-4000-8000-000000000001', 'practice', now() - interval '1 hour', now() - interval '1 hour', 9, 10, true);
select ok(private.e2_segment_matches('e2000000-0000-4000-8000-000000000004', 'latest_objective_passed'), 'a later attempt supersedes earlier result');
select throws_ok($$ select private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'active_module_access', '{}') $$, 'P0001', 'Choose a valid module', 'module segment requires a module');
select throws_ok($$ select private.e2_segment_matches('e2000000-0000-4000-8000-000000000003', 'invented') $$, 'P0001', 'Choose a valid audience segment', 'unknown segment is rejected');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
select throws_ok($$ select public.admin_preview_email_audience('segment', '{}', 'paid') $$, 'P0001', 'Admin access is required', 'candidate cannot preview an audience');
select throws_ok($$ select public.get_admin_user_application_email_history('e2000000-0000-4000-8000-000000000003') $$, 'P0001', 'Admin access is required', 'candidate cannot inspect another user email history');
select throws_ok($$ select public.get_admin_user_detail('e2000000-0000-4000-8000-000000000003') $$, 'P0001', 'Admin access is required', 'candidate cannot inspect another operational user profile');
select throws_ok($$ select public.get_admin_user_directory_v2() $$, 'P0001', 'Admin access is required', 'candidate cannot retrieve the enriched user directory');
select is(public.get_my_email_preferences()->>'engagement_enabled', 'true', 'candidate starts opted in without a preference row');
select is(public.set_my_engagement_email_enabled(false)->>'engagement_enabled', 'false', 'candidate can opt out');
select is(public.set_my_engagement_email_enabled(true)->>'engagement_enabled', 'true', 'candidate can re-subscribe');

select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(jsonb_array_length(public.get_admin_email_audience_catalog()->'segments'), 15, 'admin sees the server-defined segment catalogue including engagement subscribers');
select is((public.admin_preview_email_audience('segment', '{}', 'paid')->>'eligible')::integer, 1, 'admin preview returns authoritative eligible count');
select is(public.get_admin_user_application_email_history('e2000000-0000-4000-8000-000000000002') #>> '{user,current_email}', 'recent-unpaid@example.test', 'admin history reports the current Auth delivery address');
select is(public.get_admin_user_detail('e2000000-0000-4000-8000-000000000003') #>> '{practice,objective_attempts}', '1', 'admin user detail returns bounded operational practice truth');
select is((select item->>'engagement_subscribed' from jsonb_array_elements(public.get_admin_user_directory_v2('all', 'recent-unpaid@example.test')->'items') item limit 1), 'true', 'directory reports the real engagement preference');

select set_config('test.e2_support_campaign', (public.admin_create_e2_email_campaign(
  'Direct support', 'individual', array['e2000000-0000-4000-8000-000000000002']::uuid[], null, '{}', 'support',
  'A support update', null, 'Hello {{first_name}}, here is your update.', null, null, null
)->>'id'), true);
select is((public.get_admin_email_campaign(current_setting('test.e2_support_campaign')::uuid) #>> '{counts,all}')::integer, 0, 'draft does not create E1 events');
select is(public.admin_finalize_e2_email_campaign(current_setting('test.e2_support_campaign')::uuid)->>'queued', '1', 'single direct support can queue without a test');
select is((public.get_admin_email_campaign(current_setting('test.e2_support_campaign')::uuid) #>> '{counts,all}')::integer, 1, 'finalization creates one E1 event per recipient');
select is(public.admin_finalize_e2_email_campaign(current_setting('test.e2_support_campaign')::uuid)->>'idempotent', 'true', 'repeated finalization is idempotent');
select is((public.get_admin_email_campaign(current_setting('test.e2_support_campaign')::uuid) #>> '{counts,all}')::integer, 1, 'idempotent finalization does not duplicate events');
select is((public.get_admin_transactional_email_events('all', 'Direct support', 50, 0)->>'total')::integer, 1, 'shared delivery search finds campaign operations by campaign name');
select is(public.get_admin_transactional_email_events('all', 'Direct support', 50, 0) #>> '{items,0,subject}', 'A support update', 'shared delivery projection labels campaign email with its approved subject');

select set_config('test.e2_engagement_campaign', (public.admin_create_e2_email_campaign(
  'Engagement test', 'selected', array['e2000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000004']::uuid[], null, '{}', 'engagement',
  'Prepare with PromotionSure', 'A preparation update', 'Hello {{first_name}}, keep preparing.', 'Open PromotionSure', 'https://promotionsure.com.ng/dashboard', null
)->>'id'), true);
select throws_ok(format('select public.admin_finalize_e2_email_campaign(%L::uuid)', current_setting('test.e2_engagement_campaign')), 'P0001', 'Send a successful test for the current campaign before queueing', 'bulk engagement cannot queue before test');

reset role;
set local role service_role;
select set_config('test.e2_fingerprint', public.system_get_e2_campaign_test_payload(current_setting('test.e2_engagement_campaign')::uuid, 'e2000000-0000-4000-8000-000000000001')->>'fingerprint', true);
select is(public.system_record_e2_campaign_test(current_setting('test.e2_engagement_campaign')::uuid, 'e2000000-0000-4000-8000-000000000001', current_setting('test.e2_fingerprint'), true, 'e2-admin@example.test', 'resend-test-e2', null)->>'test_status', 'passed', 'service test result records a passed fingerprint');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(public.admin_finalize_e2_email_campaign(current_setting('test.e2_engagement_campaign')::uuid)->>'queued', '2', 'tested engagement finalizes exact eligible users');
select is(public.admin_pause_email_campaign(current_setting('test.e2_engagement_campaign')::uuid)->>'status', 'paused', 'campaign can pause');

reset role;
set local role service_role;
select is((select count(*) from public.claim_transactional_email_events('e2777777-7777-4777-8777-777777777777', 20, 120) where campaign_id = current_setting('test.e2_engagement_campaign')::uuid), 0::bigint, 'pause blocks new campaign claims');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(public.admin_resume_email_campaign(current_setting('test.e2_engagement_campaign')::uuid)->>'status', 'queued', 'paused campaign resumes without new events');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
select public.set_my_engagement_email_enabled(false);

reset role;
set local role service_role;
select is(
  public.system_validate_e2_campaign_event((
    select id from public.transactional_email_events
    where campaign_id = current_setting('test.e2_engagement_campaign')::uuid
      and user_id = 'e2000000-0000-4000-8000-000000000002'
  ))->>'reason',
  'opted_out',
  'an opt-out after queue is enforced again at dispatch time'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
select public.set_my_engagement_email_enabled(true);

reset role;
set local role service_role;
select is(
  public.system_validate_e2_campaign_event((
    select id from public.transactional_email_events
    where campaign_id = current_setting('test.e2_engagement_campaign')::uuid
      and user_id = 'e2000000-0000-4000-8000-000000000002'
  ))->>'allowed',
  'true',
  'candidate re-subscribe restores send-time engagement eligibility'
);

insert into public.transactional_email_events (
  event_key, event_type, template_key, category, priority, user_id,
  status, payload, dispatch_status, delivery_status, attempt_count,
  max_attempts, accepted_at
) values (
  'e2-frequency-prior', 'admin_campaign', 'admin_campaign', 'engagement', 50,
  'e2000000-0000-4000-8000-000000000002', 'sent', '{}', 'accepted',
  'unknown', 1, 6, now()
);
select is(
  public.system_validate_e2_campaign_event((
    select id from public.transactional_email_events
    where campaign_id = current_setting('test.e2_engagement_campaign')::uuid
      and user_id = 'e2000000-0000-4000-8000-000000000002'
  ))->>'reason',
  'recently_contacted',
  'recent accepted engagement is enforced again at dispatch time'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(
  public.admin_preview_email_audience(
    'individual', array['e2000000-0000-4000-8000-000000000002']::uuid[], null, '{}', 'engagement'
  ) #>> '{items,0,exclusion_reason}',
  'recently_contacted',
  'admin preview explains the engagement frequency exclusion'
);

reset role;
set local role service_role;
update public.transactional_email_events
set accepted_at = now() - interval '8 days'
where event_key = 'e2-frequency-prior';
select is(
  public.system_validate_e2_campaign_event((
    select id from public.transactional_email_events
    where campaign_id = current_setting('test.e2_engagement_campaign')::uuid
      and user_id = 'e2000000-0000-4000-8000-000000000002'
  ))->>'allowed',
  'true',
  'expiry of the engagement interval restores eligibility'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(
  public.admin_preview_email_audience(
    'individual', array['e2000000-0000-4000-8000-000000000002']::uuid[], null, '{}', 'support'
  )->>'eligible',
  '1',
  'direct support is not blocked by the engagement frequency rule'
);

reset role;
set local role service_role;
insert into public.email_suppressions (email, reason, source)
values ('recent-unpaid@example.test', 'hard_bounce', 'e2_test');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);
select public.set_my_engagement_email_enabled(true);

reset role;
set local role service_role;
select is(
  (select count(*) from public.email_suppressions where email = 'recent-unpaid@example.test' and active),
  1::bigint,
  're-subscribe does not clear technical suppression'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(public.admin_cancel_email_campaign(current_setting('test.e2_engagement_campaign')::uuid)->>'status', 'cancelled', 'cancel stops remaining recipients');
select throws_ok(format('select public.admin_resume_email_campaign(%L::uuid)', current_setting('test.e2_engagement_campaign')), 'P0001', 'Only a paused campaign can be resumed', 'cancelled campaign cannot resume');
select is((public.get_admin_email_campaign(current_setting('test.e2_engagement_campaign')::uuid) #>> '{counts,cancelled}')::integer, 2, 'cancel marks all remaining queued events cancelled');

reset role;
set local role service_role;
update public.transactional_email_events
set dispatch_status = 'cancelled', status = 'skipped', lease_token = null,
    leased_at = null, lease_expires_at = null
where dispatch_status in ('pending', 'retrying', 'processing');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select set_config('test.e2_pause_race_campaign', (public.admin_create_e2_email_campaign(
  'Pause race', 'individual', array['e2000000-0000-4000-8000-000000000005']::uuid[], null, '{}', 'support',
  'A service update', null, 'Hello {{first_name}}, here is your service update.', null, null, null
)->>'id'), true);
select public.admin_finalize_e2_email_campaign(current_setting('test.e2_pause_race_campaign')::uuid);

reset role;
set local role service_role;
select set_config('test.e2_pause_race_event', (
  select id::text from public.claim_transactional_email_events('e2aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 120)
  where campaign_id = current_setting('test.e2_pause_race_campaign')::uuid
), true);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(public.admin_pause_email_campaign(current_setting('test.e2_pause_race_campaign')::uuid)->>'status', 'paused', 'a campaign can pause after its event is claimed');

reset role;
set local role service_role;
select is(public.system_validate_e2_campaign_event(current_setting('test.e2_pause_race_event')::uuid)->>'disposition', 'defer', 'send-time validation defers a claimed event after pause');
select is(public.system_defer_paused_e2_campaign_event(current_setting('test.e2_pause_race_event')::uuid, 'e2aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->>'disposition', 'deferred', 'the exact paused lease is released without provider dispatch');
select is(
  (select dispatch_status || ':' || attempt_count::text from public.transactional_email_events where id = current_setting('test.e2_pause_race_event')::uuid),
  'pending:0',
  'paused event remains pending and does not consume an attempt'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(public.admin_resume_email_campaign(current_setting('test.e2_pause_race_campaign')::uuid)->>'status', 'queued', 'deferred paused mail remains resumable');
select public.admin_cancel_email_campaign(current_setting('test.e2_pause_race_campaign')::uuid);
select set_config('test.e2_cancel_race_campaign', (public.admin_create_e2_email_campaign(
  'Cancel race', 'individual', array['e2000000-0000-4000-8000-000000000005']::uuid[], null, '{}', 'support',
  'Another service update', null, 'Hello {{first_name}}, here is another service update.', null, null, null
)->>'id'), true);
select public.admin_finalize_e2_email_campaign(current_setting('test.e2_cancel_race_campaign')::uuid);

reset role;
set local role service_role;
select set_config('test.e2_cancel_race_event', (
  select id::text from public.claim_transactional_email_events('e2bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 120)
  where campaign_id = current_setting('test.e2_cancel_race_campaign')::uuid
), true);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(public.admin_cancel_email_campaign(current_setting('test.e2_cancel_race_campaign')::uuid)->>'status', 'cancelled', 'a campaign can cancel while its event is claimed');

reset role;
set local role service_role;
select is(public.system_validate_e2_campaign_event(current_setting('test.e2_cancel_race_event')::uuid)->>'reason', 'campaign_cancelled', 'send-time validation blocks a claimed event after cancellation');
select is(
  public.complete_transactional_email_attempt(
    requested_event_id => current_setting('test.e2_cancel_race_event')::uuid,
    requested_lease_token => 'e2bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    requested_outcome => 'cancelled',
    requested_recipient_email => 'checkout@example.test',
    requested_started_at => now(),
    requested_error_code => 'campaign_cancelled',
    requested_error_message => 'Campaign cancelled before provider dispatch'
  )->>'completed',
  'true',
  'cancelled claimed event completes against its exact lease'
);
select public.system_mark_e2_campaign_recipient_skipped(current_setting('test.e2_cancel_race_event')::uuid, 'campaign_cancelled');
select is((select dispatch_status from public.transactional_email_events where id = current_setting('test.e2_cancel_race_event')::uuid), 'cancelled', 'cancel race resolves the event as cancelled');
select is((select provider_message_id from public.transactional_email_events where id = current_setting('test.e2_cancel_race_event')::uuid), null, 'cancel race records no provider delivery');

update public.transactional_email_events
set dispatch_status = 'cancelled', status = 'skipped', lease_token = null,
    leased_at = null, lease_expires_at = null
where dispatch_status in ('pending', 'retrying', 'processing');
update public.email_runtime_config set engagement_daily_cap = 1 where singleton;
insert into public.transactional_email_events (
  event_key, event_type, template_key, category, priority, user_id,
  status, payload, dispatch_status, delivery_status, attempt_count,
  max_attempts, next_attempt_at, accepted_at
) values
  ('e2-cap-consumed', 'admin_campaign', 'admin_campaign', 'engagement', 50, 'e2000000-0000-4000-8000-000000000003', 'sent', '{}', 'accepted', 'unknown', 1, 6, now(), now()),
  ('e2-cap-deferred', 'admin_campaign', 'admin_campaign', 'engagement', 50, 'e2000000-0000-4000-8000-000000000004', 'pending', '{}', 'pending', 'unknown', 0, 6, now(), null),
  ('e2-critical-due', 'payment_success', 'payment_success', 'transactional', 1, 'e2000000-0000-4000-8000-000000000003', 'pending', '{}', 'pending', 'unknown', 0, 6, now(), null);
select is(
  (select event_key from public.claim_transactional_email_events('e2888888-8888-4888-8888-888888888888', 1, 120)),
  'e2-critical-due',
  'critical transactional work is claimed before engagement'
);
select is(
  (select dispatch_status from public.transactional_email_events where event_key = 'e2-cap-deferred'),
  'pending',
  'engagement remains pending when the configured daily cap is exhausted'
);
update public.transactional_email_events
set dispatch_status = 'cancelled', status = 'skipped', lease_token = null,
    leased_at = null, lease_expires_at = null
where event_key = 'e2-critical-due';
update public.transactional_email_events
set accepted_at = now() - interval '1 day 1 minute'
where event_key = 'e2-cap-consumed';
select is(
  (select event_key from public.claim_transactional_email_events('e2999999-9999-4999-8999-999999999999', 1, 120)),
  'e2-cap-deferred',
  'deferred engagement becomes claimable in the next daily period'
);
update public.email_runtime_config set engagement_daily_cap = 7 where singleton;
select is((select engagement_daily_cap from public.email_runtime_config where singleton), 7, 'engagement cap is runtime configuration rather than a schema constant');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(
  (public.admin_preview_email_audience('segment', '{}', 'incomplete_checkout')->>'eligible')::integer,
  1,
  'incomplete-checkout preview is eligible before payment truth changes'
);
select set_config('test.e2_race_campaign', (public.admin_create_e2_email_campaign(
  'Checkout race', 'segment', '{}'::uuid[], 'incomplete_checkout', '{}', 'engagement',
  'Complete your checkout', null, 'Hello {{first_name}}, complete your checkout.', null, null, null
)->>'id'), true);

reset role;
set local role service_role;
select set_config('test.e2_race_fingerprint', public.system_get_e2_campaign_test_payload(current_setting('test.e2_race_campaign')::uuid, 'e2000000-0000-4000-8000-000000000001')->>'fingerprint', true);
select public.system_record_e2_campaign_test(current_setting('test.e2_race_campaign')::uuid, 'e2000000-0000-4000-8000-000000000001', current_setting('test.e2_race_fingerprint'), true, 'e2-admin@example.test', 'resend-test-race', null);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(
  public.admin_update_e2_email_campaign(
    current_setting('test.e2_race_campaign')::uuid, 'Checkout race', 'segment', '{}'::uuid[],
    'incomplete_checkout', '{}', 'engagement', 'Complete your checkout', null,
    'Hello {{first_name}}, complete your checkout.', null, null, null
  )->>'test_status',
  'passed',
  'saving an unchanged tested campaign preserves the successful test gate'
);
select is(
  public.admin_update_e2_email_campaign(
    current_setting('test.e2_race_campaign')::uuid, 'Checkout race', 'segment', '{}'::uuid[],
    'incomplete_checkout', '{}', 'engagement', 'Complete checkout safely', null,
    'Hello {{first_name}}, complete your checkout.', null, null, null
  )->>'test_status',
  'not_sent',
  'a material subject edit invalidates the successful test gate'
);

reset role;
set local role service_role;
select set_config('test.e2_race_fingerprint', public.system_get_e2_campaign_test_payload(current_setting('test.e2_race_campaign')::uuid, 'e2000000-0000-4000-8000-000000000001')->>'fingerprint', true);
select public.system_record_e2_campaign_test(current_setting('test.e2_race_campaign')::uuid, 'e2000000-0000-4000-8000-000000000001', current_setting('test.e2_race_fingerprint'), true, 'e2-admin@example.test', 'resend-test-race-2', null);
update public.payment_orders
set status = 'active', provider_status = 'success', fulfillment_status = 'fulfilled', paid_at = now()
where id = 'e2400000-0000-4000-8000-000000000002';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select throws_ok(
  format('select public.admin_finalize_e2_email_campaign(%L::uuid)', current_setting('test.e2_race_campaign')),
  'P0001', 'There are no eligible recipients to queue',
  'finalization rechecks current payment truth after an earlier preview'
);

reset role;
update auth.users set email = 'current-at-dispatch@example.test' where id = 'e2000000-0000-4000-8000-000000000002';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);
select is(
  public.get_admin_user_application_email_history('e2000000-0000-4000-8000-000000000002') #>> '{user,current_email}',
  'current-at-dispatch@example.test',
  'admin history follows current Auth email rather than a campaign snapshot'
);

select * from finish();
rollback;
