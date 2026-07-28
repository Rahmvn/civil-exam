-- Read-only pre-launch reset inspection for the hosted Supabase project.
-- This script performs no writes and no destructive action.
--
-- Intent:
-- - Confirm what will remain: admin profiles and published content.
-- - Confirm what will be removed by the reset script: non-admin users and
--   their activity/payment/support/test-operational records.

with user_scope as (
  select
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    coalesce(p.role::text, 'missing_profile') as profile_role
  from auth.users as u
  left join public.profiles as p on p.id = u.id
)
select
  profile_role,
  count(*) as user_count,
  min(created_at) as oldest_created_at,
  max(created_at) as newest_created_at
from user_scope
group by profile_role
order by profile_role;

with target_users as (
  select u.id
  from auth.users as u
  left join public.profiles as p on p.id = u.id
  where coalesce(p.role::text, 'candidate') <> 'admin'
)
select *
from (
  values
    ('target_auth_users', (select count(*) from target_users)),
    ('target_profiles', (select count(*) from public.profiles p where p.id in (select id from target_users))),
    ('attempts', (select count(*) from public.attempts a where a.user_id in (select id from target_users))),
    ('attempt_answers', (select count(*) from public.attempt_answers aa where aa.user_id in (select id from target_users))),
    ('objective_practice_sessions', (select count(*) from public.objective_practice_sessions s where s.user_id in (select id from target_users))),
    ('attempt_submission_keys', (select count(*) from public.attempt_submission_keys k where k.user_id in (select id from target_users))),
    ('user_module_progress', (select count(*) from public.user_module_progress p where p.user_id in (select id from target_users))),
    ('oral_attempts', (select count(*) from public.oral_attempts a where a.user_id in (select id from target_users))),
    ('oral_responses', (select count(*) from public.oral_responses r where r.user_id in (select id from target_users))),
    ('legacy_entitlements', (select count(*) from public.entitlements e where e.user_id in (select id from target_users))),
    ('module_entitlements', (select count(*) from public.module_entitlements e where e.user_id in (select id from target_users))),
    ('payment_orders', (select count(*) from public.payment_orders o where o.user_id in (select id from target_users))),
    ('payment_provider_events', (
      select count(*)
      from public.payment_provider_events e
      join public.payment_orders o on o.id = e.payment_order_id
      where o.user_id in (select id from target_users)
    )),
    ('support_requests', (select count(*) from public.support_requests r where r.user_id in (select id from target_users))),
    ('app_error_events', (select count(*) from public.app_error_events e where e.user_id in (select id from target_users))),
    ('user_legal_acceptances', (select count(*) from public.user_legal_acceptances a where a.user_id in (select id from target_users))),
    ('edge_rate_limits', (select count(*) from private.edge_rate_limits r where r.user_id in (select id from target_users)))
) as counts(record_type, record_count)
order by record_type;

select *
from (
  values
    ('exam_packs', (select count(*) from public.exam_packs)),
    ('subjects', (select count(*) from public.subjects)),
    ('module_offerings', (select count(*) from public.module_offerings)),
    ('practice_sets', (select count(*) from public.practice_sets)),
    ('objective_questions', (select count(*) from public.questions)),
    ('oral_questions', (select count(*) from public.oral_questions)),
    ('admin_profiles', (select count(*) from public.profiles where role = 'admin'))
) as content_counts(record_type, record_count)
order by record_type;

select
  p.id,
  p.email,
  p.full_name,
  p.role,
  u.last_sign_in_at
from public.profiles as p
left join auth.users as u on u.id = p.id
where p.role = 'admin'
order by p.email;
