begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'ec000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'campaign-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Campaign Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ec000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'campaign-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Campaign Candidate"}', now(), now());
update public.profiles set role = 'admin' where id = 'ec000000-0000-4000-8000-000000000001';

insert into public.email_campaigns (
  id, campaign_type, segment, priority, subject, body_text, status, created_by
) values (
  'ec100000-0000-4000-8000-000000000001',
  'payment_started_support_checkin', 'payment_started_unpaid', 1,
  'Historical campaign', 'Historical direct-send body', 'sent',
  'ec000000-0000-4000-8000-000000000001'
);
insert into public.email_campaign_recipients (
  id, campaign_id, user_id, recipient_email, recipient_name, status, included
) values (
  'ec200000-0000-4000-8000-000000000001',
  'ec100000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000002',
  'historical-address@example.test', 'Campaign Candidate', 'sent', true
);

select is((select delivery_mode from public.email_campaigns where id = 'ec100000-0000-4000-8000-000000000001'), 'legacy_direct', 'historical-shaped campaign defaults to legacy direct mode');
select is((select internal_name from public.email_campaigns where id = 'ec100000-0000-4000-8000-000000000001'), 'Legacy campaign', 'historical-shaped campaign receives a conservative label');
select is((select count(*) from public.transactional_email_events where campaign_id = 'ec100000-0000-4000-8000-000000000001'), 0::bigint, 'historical recipient is not converted into a dispatchable E1 event');
select is((select status from public.email_campaign_recipients where id = 'ec200000-0000-4000-8000-000000000001'), 'sent', 'historical success state remains truthful');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);
select throws_ok($$ select public.get_admin_email_campaigns(20) $$, 'P0001', 'Admin access is required', 'candidate cannot enumerate campaign history');
select throws_ok($$ select public.get_admin_email_campaign('ec100000-0000-4000-8000-000000000001') $$, 'P0001', 'Admin access is required', 'candidate cannot inspect campaign detail');
select throws_ok($$ select public.admin_create_email_campaign('payment_started_support_checkin', 'payment_started_unpaid', null, null) $$, '42501', null, 'superseded direct campaign creation is not executable');

select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);
select is((public.get_admin_email_campaign('ec100000-0000-4000-8000-000000000001')->>'delivery_mode'), 'legacy_direct', 'admin can inspect historical campaign mode');
select is(
  (select count(*)::integer
   from jsonb_to_recordset(public.get_admin_email_campaigns(20)->'items') as campaign(id uuid)
   where campaign.id = 'ec100000-0000-4000-8000-000000000001'),
  1,
  'historical campaign remains in the admin campaign list'
);
select is((public.get_admin_email_campaign('ec100000-0000-4000-8000-000000000001') #>> '{counts,accepted}')::integer, 0, 'historical direct send does not invent E1 acceptance truth');

select * from finish();
rollback;
