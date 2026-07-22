begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'e2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'payment-attention-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Payment Attention Candidate"}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'e2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'payment-attention-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Payment Attention Admin"}', now(), now()
  );

update public.profiles set role = 'admin'
where id = 'e2000000-0000-4000-8000-000000000002';

insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, active_until, is_active
) values (
  'e2100000-0000-4000-8000-000000000001',
  'payment-attention-pack',
  'Payment Attention Pack',
  'Isolated payment attention test pack',
  250000,
  'NGN',
  current_date + 365,
  false
);

insert into public.subjects (
  id, name, description, sort_order, is_active
) values (
  'e2200000-0000-4000-8000-000000000001',
  'Payment Attention Module',
  'Isolated payment attention test module',
  999,
  true
);

insert into public.module_offerings (
  id, exam_pack_id, subject_id, price_kobo, currency, is_active
) values (
  'e2300000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  250000,
  'NGN',
  true
);

insert into public.payment_orders (
  user_id, exam_pack_id, subject_id, module_offering_id,
  provider_reference, status, amount_kobo, currency,
  provider_status, fulfillment_status, fulfillment_error, paid_at
) values (
  'e2000000-0000-4000-8000-000000000001',
  'e2100000-0000-4000-8000-000000000001',
  'e2200000-0000-4000-8000-000000000001',
  'e2300000-0000-4000-8000-000000000001',
  'PS-admin-attention-test',
  'pending',
  250000,
  'NGN',
  'success',
  'failed',
  'Transient access activation failure',
  now()
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.get_admin_payment_attention(100) $$,
  'P0001',
  'Admin access is required',
  'a candidate cannot inspect the payment attention queue'
);

select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$ select public.get_admin_payment_attention(100) $$,
  'an administrator can inspect the payment attention queue'
);

select is(
  (select count(*)::integer from public.get_admin_payment_attention(100)
   where provider_reference = 'PS-admin-attention-test'),
  1,
  'the paid order with failed fulfillment appears exactly once'
);

select is(
  (select attention_type from public.get_admin_payment_attention(100)
   where provider_reference = 'PS-admin-attention-test'),
  'access_issue',
  'the mismatch is classified as an access issue'
);

select is(
  (select requester_email from public.get_admin_payment_attention(100)
   where provider_reference = 'PS-admin-attention-test'),
  'payment-attention-candidate@example.test',
  'the queue identifies the affected candidate'
);

select is(
  (select fulfillment_error from public.get_admin_payment_attention(100)
   where provider_reference = 'PS-admin-attention-test'),
  'Transient access activation failure',
  'the queue exposes the sanitized fulfillment diagnostic'
);

reset role;

update public.payment_orders
set status = 'active', fulfillment_status = 'fulfilled', fulfillment_error = null
where provider_reference = 'PS-admin-attention-test';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::integer from public.get_admin_payment_attention(100)
   where provider_reference = 'PS-admin-attention-test'),
  0,
  'a fulfilled order leaves the attention queue'
);

select * from finish();
rollback;
