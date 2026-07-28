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
    'a1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'attacker-one@example.test',
    'local-test-only',
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Attacker One"}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'victim-two@example.test',
    'local-test-only',
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Victim Two"}',
    now(), now()
  );

insert into public.profiles (id, email, full_name)
values
  ('a1000000-0000-4000-8000-000000000001', 'attacker-one@example.test', 'Attacker One'),
  ('a1000000-0000-4000-8000-000000000002', 'victim-two@example.test', 'Victim Two')
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name;

insert into public.exam_packs (id, slug, name, description, price_kobo, active_until, is_active)
values (
  'a2000000-0000-4000-8000-000000000001',
  'launch-security-pack',
  'Launch Security Pack',
  'Local launch attack-surface test pack',
  499900,
  current_date + 30,
  true
);

insert into public.subjects (id, name, slug, description, sort_order, lifecycle_status, candidate_availability)
values (
  'a3000000-0000-4000-8000-000000000001',
  'Launch Security Module',
  'launch-security-module',
  'Local launch attack-surface test module',
  990,
  'active',
  'available'
);

insert into public.module_offerings (id, exam_pack_id, subject_id, price_kobo, currency, is_active)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  499900,
  'NGN',
  true
);

insert into public.attempts (id, user_id, exam_pack_id, subject_id, mode, score, total_questions)
values (
  'a5000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'practice',
  10,
  30
);

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id, provider_reference,
  status, amount_kobo, currency
) values (
  'a6000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'PS-launch-security-victim',
  'pending',
  499900,
  'NGN'
);

insert into public.support_requests (id, user_id, category, subject, description)
values (
  'a7000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'payment',
  'Victim private payment issue',
  'This support request belongs to another candidate and must not be visible.'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer from public.profiles where id = 'a1000000-0000-4000-8000-000000000002'),
  0,
  'a candidate cannot read another candidate profile'
);

select is(
  (select count(*)::integer from public.attempts where user_id = 'a1000000-0000-4000-8000-000000000002'),
  0,
  'a candidate cannot read another candidate attempt history'
);

select is(
  (select count(*)::integer from public.support_requests where subject = 'Victim private payment issue'),
  0,
  'a candidate cannot read another candidate support request'
);

select lives_ok(
  $$ update public.profiles
     set phone_number = '08100000000'
     where id = 'a1000000-0000-4000-8000-000000000002' $$,
  'a candidate update against another profile is safely ignored by RLS'
);

reset role;

select is(
  (select phone_number from public.profiles where id = 'a1000000-0000-4000-8000-000000000002'),
  null,
  'the victim profile remains unchanged after the blocked update'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ update public.profiles set role = 'admin' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'a candidate cannot grant themselves admin privileges'
);

select throws_ok(
  $$ select count(*) from public.payment_orders $$,
  '42501',
  null,
  'a browser client cannot directly read payment orders'
);

select throws_ok(
  $$ insert into public.module_entitlements (
       user_id, exam_pack_id, subject_id, payment_order_id, status, expires_at
     ) values (
       'a1000000-0000-4000-8000-000000000001',
       'a2000000-0000-4000-8000-000000000001',
       'a3000000-0000-4000-8000-000000000001',
       null,
       'active',
       now() + interval '30 days'
     ) $$,
  '42501',
  null,
  'a browser client cannot directly create module access'
);

select throws_ok(
  $$ select * from public.activate_module_purchase('PS-launch-security-victim', '{}'::jsonb) $$,
  '42501',
  null,
  'a browser client cannot call the payment activation RPC'
);

select throws_ok(
  $$ select public.get_admin_support_queue('open', null, 10, 0) $$,
  'P0001',
  'Admin access is required',
  'a non-admin cannot read the admin support queue through its RPC'
);

select lives_ok(
  $$ select public.create_support_request_v2(
    'suggestion',
    'Launch suggestion one',
    'This is a normal suggestion that should be accepted before the rate limit.',
    null,
    '/help',
    null
  ) $$,
  'a normal signed-in suggestion can still be submitted'
);

select lives_ok(
  $$ select public.create_support_request_v2(
    'technical',
    'Launch issue two',
    'This is a normal technical report that should be accepted before the rate limit.',
    null,
    '/help',
    null
  ) $$,
  'a normal signed-in support request can still be submitted'
);

select lives_ok(
  $$ select public.create_support_request_v2(
    'account',
    'Launch issue three',
    'This is a normal account report that should be accepted before the rate limit.',
    null,
    '/help',
    null
  ) $$,
  'a third signed-in support request can still be submitted'
);

select lives_ok(
  $$ select public.create_support_request_v2(
    'payment',
    'Launch issue four',
    'This is a normal payment report that should be accepted before the rate limit.',
    'PS-launch-security-own',
    '/help',
    null
  ) $$,
  'a fourth signed-in support request can still be submitted'
);

select lives_ok(
  $$ select public.create_support_request_v2(
    'suggestion',
    'Launch suggestion five',
    'This is the final allowed request inside the one hour support window.',
    null,
    '/help',
    null
  ) $$,
  'a fifth signed-in support request can still be submitted'
);

select throws_ok(
  $$ select public.create_support_request_v2(
    'technical',
    'Launch issue six',
    'This request should be blocked by the one hour support request limit.',
    null,
    '/help',
    null
  ) $$,
  'P0001',
  'You have sent several requests recently. Please wait before sending another',
  'support requests are rate-limited before they can flood admin'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok(
  $$ select public.create_support_request_v2(
    'technical',
    'Anonymous request',
    'Anonymous users must not create signed-in support requests through the RPC.',
    null,
    '/help',
    null
  ) $$,
  '42501',
  null,
  'anonymous users cannot call signed-in support RPCs'
);

select * from finish();
rollback;
