begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'support-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Support Candidate"}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'support-other@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Other Candidate"}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'support-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Support Admin"}', now(), now()
  );

update public.profiles set role = 'admin' where id = 'e1000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$ select public.create_support_request(
    'payment',
    'Paid but access is locked',
    'The payment completed but the module still appears locked.',
    'PS-support-test',
    '/access'
  ) $$,
  'a candidate can create a valid support request'
);

select is(
  (select count(*)::integer from public.support_requests where payment_reference = 'PS-support-test'),
  1,
  'the support request is stored once'
);

select is(
  (select payment_reference from public.support_requests where user_id = 'e1000000-0000-4000-8000-000000000001' limit 1),
  'PS-support-test',
  'the payment reference is retained for reconciliation'
);

select throws_ok(
  $$ select public.create_support_request('unknown', 'Unknown issue', 'This description is long enough to submit.', null, '/help') $$,
  'P0001',
  'Choose a valid help category',
  'invalid support categories are rejected'
);

select throws_ok(
  $$ select public.create_support_request('technical', 'Short issue', 'Too short', null, '/help') $$,
  'P0001',
  'Add between 20 and 2000 characters of detail',
  'short support descriptions are rejected'
);

select throws_ok(
  $$ insert into public.support_requests (user_id, category, subject, description)
     values ('e1000000-0000-4000-8000-000000000001', 'technical', 'Direct request', 'This direct request must be rejected by permissions.') $$,
  '42501',
  null,
  'candidates cannot bypass the support request function'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.support_requests where payment_reference = 'PS-support-test'),
  0,
  'another candidate cannot read the request'
);
select throws_ok(
  $$ select public.get_admin_support_queue('open', null, 25, 0) $$,
  'P0001',
  'Admin access is required',
  'a candidate cannot read the admin support queue'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.support_requests where payment_reference = 'PS-support-test'),
  1,
  'an administrator can read support requests for resolution'
);
select is(
  (public.get_admin_support_queue('open', 'PS-support-test', 25, 0) ->> 'total')::integer,
  1,
  'the admin queue searches and counts matching open requests on the server'
);
select is(
  jsonb_array_length(public.get_admin_support_queue('open', null, 25, 25) -> 'items'),
  0,
  'the admin queue honors a server-side page offset'
);

select lives_ok(
  $$ select public.update_support_request(
    (select id from public.support_requests where payment_reference = 'PS-support-test' limit 1),
    'resolved',
    'Module access was reconciled successfully.'
  ) $$,
  'an administrator can resolve a support request'
);
select is(
  (select status from public.support_requests where payment_reference = 'PS-support-test' limit 1),
  'resolved',
  'the resolved status is visible to the requester and administrator'
);
select is(
  (public.get_admin_support_queue('open', null, 25, 0) ->> 'total')::integer,
  0,
  'resolved requests leave the default open queue'
);
select is(
  (select count(*)::integer
   from public.admin_audit_logs
   where entity_type = 'support_request'
     and entity_id = (select id from public.support_requests where payment_reference = 'PS-support-test' limit 1)),
  1,
  'support resolution creates an admin audit event'
);

select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.record_app_error('Practice submit', 'request_timeout', '/practice/example', 504) $$,
  'an authenticated candidate can record a sanitized error event'
);
select is(
  (select count(*)::integer from public.app_error_events),
  0,
  'a candidate cannot read error event records'
);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::integer from public.app_error_events where problem_code = 'request_timeout'),
  1,
  'an administrator can inspect sanitized error events'
);

select * from finish();
rollback;
