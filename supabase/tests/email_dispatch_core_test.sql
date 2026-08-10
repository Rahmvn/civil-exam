begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(29);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'e1-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'e1-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles set role = 'admin' where id = 'e1000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.enqueue_transactional_email_event('forbidden', 'payment_success', 'e1000000-0000-4000-8000-000000000001', null) $$,
  '42501', null,
  'a candidate cannot enqueue application email'
);

reset role;

select is(
  public.enqueue_transactional_email_event(
    'payment_success:e1-order', 'payment_success',
    'e1000000-0000-4000-8000-000000000001', null,
    '{"provider_reference":"e1-order","product_label":"Pension"}'::jsonb
  ) ->> 'created',
  'true',
  'the first business event is queued'
);

select is(
  public.enqueue_transactional_email_event(
    'payment_success:e1-order', 'payment_success',
    'e1000000-0000-4000-8000-000000000001', null,
    '{}'::jsonb
  ) ->> 'created',
  'false',
  'a duplicate event returns the same logical event without cloning it'
);

select is((select count(*) from public.transactional_email_events where event_key = 'payment_success:e1-order'), 1::bigint, 'event-key uniqueness is permanent');

select is(
  (select count(*) from public.claim_transactional_email_events('e1111111-1111-4111-8111-111111111111', 10, 120)),
  1::bigint,
  'a due event is claimed'
);

select is(
  (select count(*) from public.claim_transactional_email_events('e1222222-2222-4222-8222-222222222222', 10, 120)),
  0::bigint,
  'a live lease cannot be stolen'
);

select is(
  public.complete_transactional_email_attempt(
    (select id from public.transactional_email_events where event_key = 'payment_success:e1-order'),
    'e1111111-1111-4111-8111-111111111111', 'accepted', 'e1-candidate@example.test', now(),
    'resend-e1-message', 200
  ) ->> 'dispatch_status',
  'accepted',
  'an accepted attempt atomically completes the lease'
);

select is((select attempt_count from public.transactional_email_events where event_key = 'payment_success:e1-order'), 1, 'attempt count advances once');
select is((select count(*) from public.transactional_email_attempts where provider_message_id = 'resend-e1-message'), 1::bigint, 'attempt history preserves the provider result');
select is((select count(*) from public.claim_transactional_email_events('e1333333-3333-4333-8333-333333333333', 10, 120)), 0::bigint, 'an accepted event cannot be reclaimed');

select public.enqueue_transactional_email_event('payment_success:e1-retry', 'payment_success', 'e1000000-0000-4000-8000-000000000001', null);
select is((select count(*) from public.claim_transactional_email_events('e1444444-4444-4444-8444-444444444444', 10, 120)), 1::bigint, 'a second event is claimed');
select is(
  public.complete_transactional_email_attempt(
    (select id from public.transactional_email_events where event_key = 'payment_success:e1-retry'),
    'e1444444-4444-4444-8444-444444444444', 'retry_scheduled', 'e1-candidate@example.test', now(),
    null, 429, true, 300, now() + interval '5 minutes', 'provider_http_429', 'Rate limited'
  ) ->> 'dispatch_status',
  'retrying',
  'a transient failure schedules retry'
);
select is((select count(*) from public.claim_transactional_email_events('e1555555-5555-4555-8555-555555555555', 10, 120)), 0::bigint, 'a not-yet-due retry is not claimed');
update public.transactional_email_events set next_attempt_at = now() - interval '1 second' where event_key = 'payment_success:e1-retry';
select is((select count(*) from public.claim_transactional_email_events('e1555555-5555-4555-8555-555555555555', 10, 120)), 1::bigint, 'a due retry becomes claimable');

select public.complete_transactional_email_attempt(
  (select id from public.transactional_email_events where event_key = 'payment_success:e1-retry'),
  'e1555555-5555-4555-8555-555555555555', 'permanent_failure', 'e1-candidate@example.test', now(),
  null, 422, false, null, null, 'provider_http_422', 'Invalid request'
);
select is((select dispatch_status from public.transactional_email_events where event_key = 'payment_success:e1-retry'), 'dead', 'a permanent provider rejection becomes dead');

select public.enqueue_transactional_email_event('payment_success:e1-stale', 'payment_success', 'e1000000-0000-4000-8000-000000000001', null);
select is((select count(*) from public.claim_transactional_email_events('e1666666-6666-4666-8666-666666666666', 10, 120)), 1::bigint, 'a new lease is established');
update public.transactional_email_events set lease_expires_at = now() - interval '1 second' where event_key = 'payment_success:e1-stale';
select is((select count(*) from public.claim_transactional_email_events('e1777777-7777-4777-8777-777777777777', 10, 120)), 1::bigint, 'an expired lease is reclaimable');

select is(
  public.record_email_provider_event('resend', 'svix-e1-delivered', 'resend-e1-message', 'delivered', now(), 'e1-candidate@example.test') ->> 'duplicate',
  'false',
  'a signed normalized provider event is stored'
);
select is((select delivery_status from public.transactional_email_events where event_key = 'payment_success:e1-order'), 'delivered', 'delivery truth is separate from provider acceptance');
select is(
  public.record_email_provider_event('resend', 'svix-e1-delivered', 'resend-e1-message', 'delivered', now(), 'e1-candidate@example.test') ->> 'duplicate',
  'true',
  'a repeated provider event is idempotent'
);
select public.record_email_provider_event('resend', 'svix-e1-old-sent', 'resend-e1-message', 'sent', now() - interval '1 hour', 'e1-candidate@example.test');
select is((select delivery_status from public.transactional_email_events where event_key = 'payment_success:e1-order'), 'delivered', 'an older lower provider state cannot regress delivery');

select public.record_email_provider_event('resend', 'svix-e1-bounce', 'unknown-message', 'bounced', now(), 'bounce@example.test');
select is((select reason from public.email_suppressions where email = 'bounce@example.test'), 'hard_bounce', 'a hard bounce creates local suppression even for an unknown message');
select is((select count(*) from public.email_provider_events where provider_message_id = 'unknown-message'), 1::bigint, 'an unknown legitimate provider message remains auditable');

select public.enqueue_transactional_email_event('payment_success:e1-early-webhook', 'payment_success', 'e1000000-0000-4000-8000-000000000001', null);
select * from public.claim_transactional_email_events('e1888888-8888-4888-8888-888888888888', 10, 120);
select public.record_email_provider_event('resend', 'svix-e1-early-delivery', 'resend-e1-early', 'delivered', now(), 'e1-candidate@example.test');
select public.complete_transactional_email_attempt(
  (select id from public.transactional_email_events where event_key = 'payment_success:e1-early-webhook'),
  'e1888888-8888-4888-8888-888888888888', 'accepted', 'e1-candidate@example.test', now(),
  'resend-e1-early', 200
);
select is((select delivery_status from public.transactional_email_events where event_key = 'payment_success:e1-early-webhook'), 'delivered', 'an early provider webhook is reconciled after acceptance');
select isnt((select email_event_id from public.email_provider_events where provider_event_id = 'svix-e1-early-delivery'), null::uuid, 'an early provider event is back-correlated to its application event');

insert into public.transactional_email_events (event_key, event_type, recipient_email, status)
values ('legacy:e1-pending', 'payment_success', 'legacy@example.test', 'pending');
select is((select dispatch_status from public.transactional_email_events where event_key = 'legacy:e1-pending'), 'cancelled', 'legacy-shaped inserts cannot enter automatic dispatch');

update public.transactional_email_events
set dispatch_status = 'dead', status = 'failed', lease_token = null, leased_at = null, lease_expires_at = null
where event_key = 'payment_success:e1-stale';
select set_config(
  'test.dead_email_event_id',
  (select id::text from public.transactional_email_events where event_key = 'payment_success:e1-stale'),
  true
);
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
select is(
  public.admin_retry_transactional_email_event(current_setting('test.dead_email_event_id')::uuid) ->> 'dispatch_status',
  'retrying',
  'an administrator retries the same dead logical event'
);
select cmp_ok(
  (select max_attempts - attempt_count
    from jsonb_to_recordset(public.get_admin_transactional_email_events('retrying', null, 50, 0) -> 'items')
      as item(id uuid, max_attempts integer, attempt_count integer)
    where item.id = current_setting('test.dead_email_event_id')::uuid),
  '>=', 1,
  'operator retry authorizes another attempt without erasing prior attempts'
);
select cmp_ok((public.get_admin_transactional_email_events('delivered', null, 50, 0) ->> 'total')::integer, '>=', 1, 'admin diagnostics distinguish delivered mail');

select * from finish();
rollback;
