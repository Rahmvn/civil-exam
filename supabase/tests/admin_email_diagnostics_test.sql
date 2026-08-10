begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'e3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'email-diagnostics-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Email Diagnostics Candidate"}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'e3000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'email-diagnostics-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Email Diagnostics Admin"}', now(), now()
  );

update public.profiles set role = 'admin'
where id = 'e3000000-0000-4000-8000-000000000002';

insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, active_until, is_active
) values (
  'e3100000-0000-4000-8000-000000000001',
  'email-diagnostics-pack',
  'Email Diagnostics Pack',
  'Isolated email diagnostics test pack',
  250000,
  'NGN',
  current_date + 365,
  false
);

insert into public.subjects (
  id, name, slug, description, sort_order, is_active
) values (
  'e3200000-0000-4000-8000-000000000001',
  'Email Diagnostics Module',
  'email-diagnostics-module',
  'Isolated email diagnostics test module',
  999,
  true
);

insert into public.module_offerings (
  id, exam_pack_id, subject_id, price_kobo, currency, is_active
) values (
  'e3300000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'e3200000-0000-4000-8000-000000000001',
  250000,
  'NGN',
  true
);

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id,
  provider_reference, status, amount_kobo, currency,
  provider_status, fulfillment_status, paid_at
) values (
  'e3400000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e3100000-0000-4000-8000-000000000001',
  'e3200000-0000-4000-8000-000000000001',
  'e3300000-0000-4000-8000-000000000001',
  'PS-email-diagnostics-test',
  'active',
  250000,
  'NGN',
  'success',
  'fulfilled',
  now()
);

insert into public.transactional_email_events (
  event_key, event_type, recipient_email, user_id, payment_order_id,
  provider_message_id, status, dispatch_status, delivery_status,
  error_message, attempted_at, sent_at
) values
  (
    'payment_success:PS-email-diagnostics-test',
    'payment_success',
    'email-diagnostics-candidate@example.test',
    'e3000000-0000-4000-8000-000000000001',
    'e3400000-0000-4000-8000-000000000001',
    'eml_sent_test',
    'sent',
    'accepted',
    'delivered',
    null,
    now() - interval '5 minutes',
    now() - interval '5 minutes'
  ),
  (
    'payment_access_issue:PS-email-diagnostics-test',
    'payment_access_issue',
    'email-diagnostics-candidate@example.test',
    'e3000000-0000-4000-8000-000000000001',
    'e3400000-0000-4000-8000-000000000001',
    null,
    'failed',
    'dead',
    'unknown',
    'Provider timeout',
    now() - interval '2 minutes',
    null
  ),
  (
    'refund_pending:PS-email-diagnostics-test',
    'refund_pending',
    'email-diagnostics-candidate@example.test',
    'e3000000-0000-4000-8000-000000000001',
    'e3400000-0000-4000-8000-000000000001',
    null,
    'skipped',
    'cancelled',
    'unknown',
    'RESEND_API_KEY is not configured',
    now() - interval '1 minute',
    null
  );

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.get_admin_transactional_email_events('all', null, 50, 0) $$,
  'P0001',
  'Admin access is required',
  'a candidate cannot inspect transactional email diagnostics'
);

select set_config('request.jwt.claim.sub', 'e3000000-0000-4000-8000-000000000002', true);

select cmp_ok(
  (public.get_admin_transactional_email_events('all', null, 50, 0) ->> 'total')::integer,
  '>=',
  3,
  'an administrator can see transactional email events'
);

select is(
  (public.get_admin_transactional_email_events('dead', null, 50, 0) ->> 'total')::integer,
  1,
  'status filtering returns only matching email events'
);

select is(
  (public.get_admin_transactional_email_events('all', 'PS-email-diagnostics-test', 50, 0) ->> 'total')::integer,
  3,
  'search matches payment references joined through payment orders'
);

select is(
  public.get_admin_transactional_email_events('dead', null, 50, 0) #>> '{items,0,provider_reference}',
  'PS-email-diagnostics-test',
  'email diagnostics include the linked payment reference'
);

select is(
  public.get_admin_transactional_email_events('dead', null, 50, 0) #>> '{items,0,subject_name}',
  'Email Diagnostics Module',
  'email diagnostics include the linked module'
);

select is(
  public.get_admin_transactional_email_events('dead', null, 50, 0) #>> '{items,0,error_message}',
  'Provider timeout',
  'email diagnostics expose the send failure reason'
);

select is(
  (public.get_admin_transactional_email_events('all', null, 1, 0) ->> 'limit')::integer,
  10,
  'the diagnostics page size is bounded to the server minimum'
);

select throws_ok(
  $$ select public.get_admin_transactional_email_events('unknown', null, 50, 0) $$,
  'P0001',
  'Choose a valid email status',
  'invalid status filters are rejected'
);

select * from finish();
rollback;
