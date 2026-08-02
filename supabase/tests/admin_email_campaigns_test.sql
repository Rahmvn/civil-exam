begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'ec000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'campaign-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Campaign Admin"}', now() - interval '3 days', now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ec000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'payment-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Payment Candidate"}', now() - interval '3 days', now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ec000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'practice-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Practice Candidate"}', now() - interval '3 days', now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ec000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
    'new-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"New Candidate"}', now() - interval '3 days', now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'ec000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
    'staging.candidate@promotionsure.com.ng', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Internal Candidate"}', now() - interval '3 days', now()
  );

update public.profiles
set role = 'admin'
where id = 'ec000000-0000-4000-8000-000000000001';

update public.profiles
set created_at = now() - interval '3 days'
where id in (
  'ec000000-0000-4000-8000-000000000002',
  'ec000000-0000-4000-8000-000000000003',
  'ec000000-0000-4000-8000-000000000004',
  'ec000000-0000-4000-8000-000000000005'
);

insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, active_until, is_active
) values (
  'ec100000-0000-4000-8000-000000000001',
  'campaign-test-pack',
  'Campaign Test Pack',
  'Isolated campaign test pack',
  250000,
  'NGN',
  current_date + 365,
  false
);

insert into public.subjects (
  id, name, slug, description, sort_order, is_active
) values (
  'ec110000-0000-4000-8000-000000000001',
  'Campaign Test Module',
  'campaign-test-module',
  'Isolated campaign test module',
  998,
  true
);

insert into public.module_offerings (
  id, exam_pack_id, subject_id, price_kobo, currency, is_active
) values (
  'ec120000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'ec110000-0000-4000-8000-000000000001',
  250000,
  'NGN',
  true
);

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id,
  provider_reference, status, amount_kobo, list_price_kobo,
  currency, provider_status, created_at
) values (
  'ec200000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000002',
  'ec100000-0000-4000-8000-000000000001',
  'ec110000-0000-4000-8000-000000000001',
  'ec120000-0000-4000-8000-000000000001',
  'PS-campaign-test-pending',
  'pending',
  250000,
  250000,
  'NGN',
  'initialized',
  now() - interval '2 hours'
);

insert into public.attempts (
  id, user_id, exam_pack_id, mode, started_at, score, total_questions
) values (
  'ec300000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000003',
  'ec100000-0000-4000-8000-000000000001',
  'practice',
  now() - interval '2 hours',
  0,
  0
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.get_admin_email_campaign_catalog() $$,
  'P0001',
  'Admin access is required',
  'a candidate cannot inspect campaign scenarios'
);

select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);

select is(
  jsonb_array_length(public.get_admin_email_campaign_catalog()->'items'),
  3,
  'the administrator sees all three prioritised scenarios'
);

select is(
  public.get_admin_email_campaign_catalog() #>> '{items,0,title}',
  'Payment check-in',
  'payment support is the first priority'
);

select is(
  (public.get_admin_email_campaign_catalog() #>> '{items,0,recipient_count}')::integer,
  1,
  'only the mature incomplete checkout is eligible for payment follow-up'
);

select is(
  (public.get_admin_email_campaign_catalog() #>> '{items,1,recipient_count}')::integer,
  1,
  'practice follow-up excludes users who have started payment'
);

select is(
  (public.get_admin_email_campaign_catalog() #>> '{items,2,recipient_count}')::integer,
  1,
  'getting-started follow-up excludes the internal account'
);

select throws_ok(
  $$ select public.admin_create_email_campaign(
    'payment_started_support_checkin',
    'not_started_unpaid',
    null,
    null
  ) $$,
  'P0001',
  'Choose a valid campaign scenario',
  'campaign type and segment cannot be mismatched'
);

select set_config(
  'test.email_campaign',
  public.admin_create_email_campaign(
    'payment_started_support_checkin',
    'payment_started_unpaid',
    null,
    null
  )::text,
  true
);

select is(
  (current_setting('test.email_campaign')::jsonb #>> '{counts,selected}')::integer,
  1,
  'creating a campaign snapshots the eligible recipient'
);

select throws_ok(
  $$ select public.admin_create_email_campaign(
    'practice_support_checkin',
    'practiced_unpaid_no_checkout',
    null,
    null
  ) $$,
  'P0001',
  'Finish or cancel the current campaign before creating another',
  'only one active campaign is allowed'
);

select is(
  (public.admin_set_email_campaign_recipient_included(
    (current_setting('test.email_campaign')::jsonb->>'id')::uuid,
    (public.get_admin_email_campaign(
      (current_setting('test.email_campaign')::jsonb->>'id')::uuid
    ) #>> '{recipients,0,id}')::uuid,
    false
  ) #>> '{counts,selected}')::integer,
  0,
  'an administrator can exclude a snapshotted recipient'
);

select is(
  (public.admin_set_email_campaign_recipient_included(
    (current_setting('test.email_campaign')::jsonb->>'id')::uuid,
    (public.get_admin_email_campaign(
      (current_setting('test.email_campaign')::jsonb->>'id')::uuid
    ) #>> '{recipients,0,id}')::uuid,
    true
  ) #>> '{counts,selected}')::integer,
  1,
  'an excluded recipient can be selected again before sending'
);

select throws_ok(
  $$ select public.system_revalidate_email_campaign_recipients(
    (current_setting('test.email_campaign')::jsonb->>'id')::uuid
  ) $$,
  '42501',
  null,
  'authenticated clients cannot invoke the system revalidation function'
);

reset role;

update public.payment_orders
set status = 'active', provider_status = 'success', paid_at = now()
where id = 'ec200000-0000-4000-8000-000000000001';

set local role service_role;

select is(
  public.system_revalidate_email_campaign_recipients(
    (current_setting('test.email_campaign')::jsonb->>'id')::uuid
  ),
  1,
  'the server revalidation removes a user who paid after the snapshot'
);

reset role;

select is(
  (select status from public.email_campaign_recipients limit 1),
  'skipped',
  'the newly paid recipient is marked skipped'
);

select is(
  (select included from public.email_campaign_recipients limit 1),
  false,
  'the newly paid recipient is excluded from delivery'
);

select ok(
  has_table_privilege('service_role', 'public.admin_audit_logs', 'INSERT'),
  'the server email function can record campaign audit events'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select * from public.email_campaigns $$,
  '42501',
  null,
  'campaign tables are not directly exposed to authenticated clients'
);

select * from finish();
rollback;
