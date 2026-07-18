-- Read-only hosted inspection. Replace only the placeholder emails after
-- explicit approval. This script performs no writes and no destructive action.

with target_users as (
  select id, email, created_at, last_sign_in_at, email_confirmed_at
  from auth.users
  where lower(email) in (
    'replace-with-approved-test-email@example.com'
  )
)
select
  id,
  email,
  created_at,
  last_sign_in_at,
  email_confirmed_at,
  email_confirmed_at is null as is_unverified
from target_users
order by created_at;

with target_users as (
  select id from auth.users
  where lower(email) in ('replace-with-approved-test-email@example.com')
)
select
  tu.id as user_id,
  (select count(*) from auth.identities i where i.user_id = tu.id) as identity_count,
  (select count(*) from public.profiles p where p.id = tu.id) as profile_count,
  (select count(*) from public.attempts a where a.user_id = tu.id) as attempt_count,
  (select count(*) from public.attempt_answers aa where aa.user_id = tu.id) as answer_count,
  (select count(*) from public.entitlements e where e.user_id = tu.id) as legacy_entitlement_count,
  (select count(*) from public.module_entitlements me where me.user_id = tu.id) as module_entitlement_count,
  (select count(*) from public.payment_orders po where po.user_id = tu.id) as payment_order_count,
  (select count(*) from public.user_module_progress ump where ump.user_id = tu.id) as module_progress_count,
  (select count(*) from public.oral_attempts oa where oa.user_id = tu.id) as oral_attempt_count,
  (select count(*) from public.support_requests sr where sr.user_id = tu.id) as support_request_count,
  (select count(*) from public.attempt_submission_keys ask where ask.user_id = tu.id) as submission_key_count,
  (select count(*) from public.app_error_events aee where aee.user_id = tu.id) as error_event_count,
  (select count(*) from public.admin_audit_logs aal where aal.actor_id = tu.id) as admin_audit_count
from target_users tu;

select
  conrelid::regclass as referencing_table,
  a.attname as referencing_column,
  confrelid::regclass as referenced_table,
  confdeltype as delete_action
from pg_constraint c
join unnest(c.conkey) with ordinality as k(attnum, ord) on true
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
where c.contype = 'f'
  and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
order by referenced_table::text, referencing_table::text, referencing_column;
