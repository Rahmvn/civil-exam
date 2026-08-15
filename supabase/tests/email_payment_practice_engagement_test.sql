begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(35);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'e4-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"E4 Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'e4-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"E4 Candidate"}', now(), now());

update public.profiles set role = 'admin' where id = 'e4000000-0000-4000-8000-000000000001';

insert into public.exam_packs (id, slug, name, description, price_kobo, currency, active_until, is_active)
values ('e4100000-0000-4000-8000-000000000001', 'e4-test-pack', 'E4 Test Pack', 'E4 tests', 250000, 'NGN', current_date + 365, false);

insert into public.subjects (id, name, slug, description, sort_order, is_active)
values ('e4200000-0000-4000-8000-000000000001', 'E4 Practice Module With A Long Name', 'e4-practice-module', 'E4 tests', 994, true);

insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
values ('e4300000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001', 250000, 'NGN', true);

insert into public.practice_sets (
  id, exam_pack_id, subject_id, set_number, expected_question_count, status,
  practice_type, logical_set_key, version_number, ever_published, published_at
) values
  ('e4400000-0000-4000-8000-000000000001', 'e4100000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001', 1, 10, 'published', 'objective', 'e4410000-0000-4000-8000-000000000001', 1, true, now() - interval '1 day'),
  ('e4400000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001', 2, 10, 'published', 'objective', 'e4410000-0000-4000-8000-000000000002', 1, true, now() - interval '1 day');

select is((select count(*) from public.email_lifecycle_automations), 6::bigint, 'practice progress extends the lifecycle catalogue');
select ok((select not enabled and activated_at is null from public.email_lifecycle_automations where automation_key = 'practice_progress'), 'practice progress deploys disabled and unactivated');
select is((select practice_progress_min_interval_hours from public.email_runtime_config where singleton), 72, 'practice progress interval defaults to 72 hours');
select is((select practice_progress_rolling_7d_cap from public.email_runtime_config where singleton), 2, 'practice progress defaults to two accepted messages per seven days');
select is((select practice_progress_improvement_points from public.email_runtime_config where singleton), 10, 'personal-best threshold defaults to ten points');
select ok(not has_table_privilege('authenticated', 'public.email_practice_milestones', 'SELECT'), 'candidate role cannot enumerate practice milestones');

insert into public.attempts (
  id, user_id, exam_pack_id, subject_id, practice_set_id, mode,
  started_at, completed_at, score, total_questions, score_percent, passed
) values (
  'e4500000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002',
  'e4100000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001',
  'e4400000-0000-4000-8000-000000000001', 'practice', now() - interval '4 hours',
  now() - interval '4 hours', 5, 10, 50, false
);
select ok(exists (select 1 from public.email_practice_milestones where milestone_type = 'first_practice'), 'authoritative completion captures a durable first-practice fact');

select set_config('test.e4_template', (select template_id::text from public.email_lifecycle_automations where automation_key = 'practice_progress'), true);
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e4000000-0000-4000-8000-000000000001', true);
select lives_ok(format(
  'select public.admin_update_email_automation(%L, true, 30, %L::uuid, 96, 2, 12)',
  'practice_progress', current_setting('test.e4_template')
), 'admin can enable practice progress and save bounded controls');
reset role;
set local role service_role;
update public.email_lifecycle_automations
set activated_at = now() - interval '3 hours'
where automation_key = 'practice_progress';
select ok((select enabled and activated_at is not null from public.email_lifecycle_automations where automation_key = 'practice_progress'), 'enabling records a fresh activation cutoff');
select is(public.evaluate_email_lifecycle_automations(100)->>'discovered', '0', 'pre-activation milestone facts are not backfilled');

insert into public.attempts (
  id, user_id, exam_pack_id, subject_id, practice_set_id, mode,
  started_at, completed_at, score, total_questions, score_percent, passed
) values (
  'e4500000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000002',
  'e4100000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001',
  'e4400000-0000-4000-8000-000000000002', 'practice', now(), now(), 9, 10, 90, true
);

select ok(exists (select 1 from public.email_practice_milestones where source_attempt_id = 'e4500000-0000-4000-8000-000000000002' and milestone_type = 'first_module_pass'), 'first module pass is captured');
select ok(exists (select 1 from public.email_practice_milestones where source_attempt_id = 'e4500000-0000-4000-8000-000000000002' and milestone_type = 'personal_best'), 'qualifying personal best is captured');
select ok(exists (select 1 from public.email_practice_milestones where source_attempt_id = 'e4500000-0000-4000-8000-000000000002' and milestone_type = 'module_complete'), 'published-set completion uses the authoritative catalogue');
select lives_ok($$ update public.attempts set completed_at = completed_at where id = 'e4500000-0000-4000-8000-000000000002' $$, 'replaying a completed attempt is harmless');
select is((select count(*) from public.email_practice_milestones where source_attempt_id = 'e4500000-0000-4000-8000-000000000002'), 3::bigint, 'attempt replay does not duplicate milestone facts');

select lives_ok($$ select public.evaluate_email_lifecycle_automations(100) $$, 'lifecycle evaluator discovers the coalesced practice group');
select is((select count(*) from public.email_lifecycle_instances where automation_key = 'practice_progress'), 1::bigint, 'nearby milestones create one lifecycle instance');
select is((select state from public.email_lifecycle_instances where automation_key = 'practice_progress'), 'scheduled', 'coalescing window keeps the instance scheduled');
update public.email_lifecycle_instances
set trigger_at = now() - interval '2 minutes', due_at = now() - interval '1 minute'
where automation_key = 'practice_progress';
select lives_ok($$ select public.evaluate_email_lifecycle_automations(100) $$, 'practice progress queues after the coalescing window');
select is((select count(*) from public.transactional_email_events where event_type = 'lifecycle_practice_progress'), 1::bigint, 'one E1 event owns the coalesced milestones');
select is((select count(distinct lifecycle_instance_id) from public.email_practice_milestones where source_attempt_id = 'e4500000-0000-4000-8000-000000000002'), 1::bigint, 'all facts attach to the same lifecycle instance');
select ok((select payload->>'achievement_summary' from public.transactional_email_events where event_type = 'lifecycle_practice_progress') like '%completed all currently available%', 'highest-value milestone leads the message');
select lives_ok($$ select public.evaluate_email_lifecycle_automations(100) $$, 'repeat lifecycle evaluation is idempotent');
select is((select count(*) from public.transactional_email_events where event_type = 'lifecycle_practice_progress'), 1::bigint, 'repeat evaluation does not duplicate the practice email');

update public.transactional_email_events
set status = 'sent', dispatch_status = 'accepted', delivery_status = 'sent',
  accepted_at = now() - interval '25 hours'
where event_type = 'lifecycle_practice_progress';

insert into public.email_lifecycle_instances (
  id, automation_key, user_id, source_type, source_key, source_id,
  trigger_at, due_at, state, eligibility_result, metadata
) values (
  'e4700000-0000-4000-8000-000000000001', 'practice_progress',
  'e4000000-0000-4000-8000-000000000002', 'practice_milestone_group',
  'e4710000-0000-4000-8000-000000000001', 'e4500000-0000-4000-8000-000000000002',
  now(), now(), 'queued', 'eligible', '{"coalesce_key":"e4710000-0000-4000-8000-000000000001"}'
);
insert into public.email_practice_milestones (
  milestone_key, coalesce_key, user_id, exam_pack_id, subject_id,
  source_type, source_attempt_id, milestone_type, trigger_at, expires_at,
  state, lifecycle_instance_id, metadata
) values (
  'practice:test:second-progress', 'e4710000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001',
  'e4200000-0000-4000-8000-000000000001', 'objective_attempt',
  'e4500000-0000-4000-8000-000000000002', 'personal_best', now(), now() + interval '7 days',
  'queued', 'e4700000-0000-4000-8000-000000000001', '{"score_percent":90}'
);
insert into public.transactional_email_events (
  event_key, event_type, template_key, category, priority, user_id,
  status, dispatch_status, delivery_status, lifecycle_instance_id, payload
) values (
  'lifecycle:practice_progress:test-second', 'lifecycle_practice_progress',
  'admin_campaign', 'engagement', 50, 'e4000000-0000-4000-8000-000000000002',
  'pending', 'pending', 'unknown', 'e4700000-0000-4000-8000-000000000001', '{}'
);
select is(public.system_validate_e3_lifecycle_event((
  select id from public.transactional_email_events where event_key = 'lifecycle:practice_progress:test-second'
))->>'reason', 'recent_practice_progress', 'another practice-progress email waits for the practice-specific interval');

update public.email_lifecycle_automations
set enabled = true, activated_at = now() - interval '1 hour'
where automation_key = 'practised_unpaid';
insert into public.email_lifecycle_instances (
  id, automation_key, user_id, source_type, source_key, source_id,
  trigger_at, due_at, state, eligibility_result, metadata
) values (
  'e4700000-0000-4000-8000-000000000002', 'practised_unpaid',
  'e4000000-0000-4000-8000-000000000002', 'practice_activity',
  'e4000000-0000-4000-8000-000000000002:e4200000-0000-4000-8000-000000000001:test',
  'e4200000-0000-4000-8000-000000000001', now(), now(), 'queued', 'eligible',
  '{"subject_id":"e4200000-0000-4000-8000-000000000001"}'
);
insert into public.transactional_email_events (
  event_key, event_type, template_key, category, priority, user_id,
  status, dispatch_status, delivery_status, lifecycle_instance_id, payload
) values (
  'lifecycle:practised_unpaid:test-after-progress', 'lifecycle_practised_unpaid',
  'admin_campaign', 'engagement', 50, 'e4000000-0000-4000-8000-000000000002',
  'pending', 'pending', 'unknown', 'e4700000-0000-4000-8000-000000000002', '{}'
);
select is(public.system_validate_e3_lifecycle_event((
  select id from public.transactional_email_events where event_key = 'lifecycle:practised_unpaid:test-after-progress'
))->>'reason', 'recent_practice_progress', 'practice progress also defers the related unpaid reminder');

update public.transactional_email_events
set accepted_at = now() - interval '5 days'
where event_type = 'lifecycle_practice_progress' and dispatch_status = 'accepted';
insert into public.email_lifecycle_instances (
  id, automation_key, user_id, source_type, source_key, source_id,
  trigger_at, due_at, state, eligibility_result, metadata, completed_at
) values (
  'e4700000-0000-4000-8000-000000000003', 'practice_progress',
  'e4000000-0000-4000-8000-000000000002', 'practice_milestone_group',
  'e4710000-0000-4000-8000-000000000003', 'e4500000-0000-4000-8000-000000000001',
  now() - interval '6 days', now() - interval '6 days', 'sent', 'eligible',
  '{"coalesce_key":"e4710000-0000-4000-8000-000000000003"}', now() - interval '6 days'
);
insert into public.transactional_email_events (
  event_key, event_type, template_key, category, priority, user_id,
  status, dispatch_status, delivery_status, accepted_at, lifecycle_instance_id, payload
) values (
  'lifecycle:practice_progress:test-prior', 'lifecycle_practice_progress',
  'admin_campaign', 'engagement', 50, 'e4000000-0000-4000-8000-000000000002',
  'sent', 'accepted', 'sent', now() - interval '6 days',
  'e4700000-0000-4000-8000-000000000003', '{}'
);
select is(public.system_validate_e3_lifecycle_event((
  select id from public.transactional_email_events where event_key = 'lifecycle:practice_progress:test-second'
))->>'reason', 'practice_progress_weekly_cap', 'a third practice-progress email is deferred by the rolling seven-day cap');
select is((public.system_validate_e3_lifecycle_event((
  select id from public.transactional_email_events where event_key = 'lifecycle:practice_progress:test-second'
))->>'disposition'), 'defer', 'practice frequency limits remain resumable rather than destructive');

update public.email_runtime_config set payment_email_repair_activated_at = now() - interval '1 hour' where singleton;
insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id, provider_reference,
  status, amount_kobo, list_price_kobo, currency, provider_status,
  fulfillment_status, paid_at, created_at, purchase_snapshot
) values
  ('e4600000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001', 'e4300000-0000-4000-8000-000000000001', 'PS-e4-repair', 'active', 250000, 250000, 'NGN', 'success', 'fulfilled', now(), now(), '{"duration_months":1,"marker":"unchanged"}'),
  ('e4600000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000002', 'e4100000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001', 'e4300000-0000-4000-8000-000000000001', 'PS-e4-historical', 'active', 250000, 250000, 'NGN', 'success', 'fulfilled', now() - interval '2 hours', now() - interval '2 hours', '{"duration_months":1,"marker":"historical"}');
insert into public.payment_order_items (payment_order_id, subject_id, module_offering_id, list_price_kobo, allocated_amount_kobo)
values
  ('e4600000-0000-4000-8000-000000000001', 'e4200000-0000-4000-8000-000000000001', 'e4300000-0000-4000-8000-000000000001', 250000, 250000),
  ('e4600000-0000-4000-8000-000000000002', 'e4200000-0000-4000-8000-000000000001', 'e4300000-0000-4000-8000-000000000001', 250000, 250000);
insert into public.transactional_email_events (
  event_key, event_type, template_key, category, priority, user_id, payment_order_id,
  status, dispatch_status, delivery_status, payload
) values (
  'payment_access_issue:PS-e4-repair', 'payment_access_issue', 'payment_access_issue',
  'transactional', 10, 'e4000000-0000-4000-8000-000000000002',
  'e4600000-0000-4000-8000-000000000001', 'sent', 'accepted', 'sent', '{}'
);

select set_config('test.e4_repair_result', public.repair_missing_payment_success_email_events(20)::text, true);
select is((current_setting('test.e4_repair_result')::jsonb)->>'created', '1', 'bounded repair creates the missing recent payment event');
select is((select count(*) from public.transactional_email_events where event_key = 'payment_success:PS-e4-repair'), 1::bigint, 'payment repair uses the canonical deterministic event identity');
select is(public.repair_missing_payment_success_email_events(20)->>'created', '0', 'payment repair replay is a no-op');
select is((select purchase_snapshot->>'marker' from public.payment_orders where id = 'e4600000-0000-4000-8000-000000000001'), 'unchanged', 'repair does not modify the payment snapshot');
select ok(not exists (select 1 from public.transactional_email_events where event_key = 'payment_success:PS-e4-historical'), 'repair cutoff prevents historical payment backfill');
select is((select category from public.transactional_email_events where event_key = 'payment_success:PS-e4-repair'), 'transactional', 'payment confirmation remains transactional');
select is((select practice_progress_min_interval_hours from public.email_runtime_config where singleton), 96, 'Admin-saved practice interval remains server authoritative');

select * from finish();
rollback;
