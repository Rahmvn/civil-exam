-- Guarded pre-launch reset for PromotionSure.
--
-- This is intentionally selective. It preserves schema, RPCs, RLS, modules,
-- practice sets, questions, oral questions, module offerings, and admin
-- profiles. It removes non-admin users and their test activity/payment/support
-- records so the first launch starts clean.
--
-- Before running on hosted Supabase:
-- 1. Take a Supabase Dashboard backup or a logical dump.
-- 2. Run supabase/audit/prelaunch_reset_inspect.sql.
-- 3. Confirm the admin profiles listed there are the accounts to keep.
-- 4. Edit the confirmation value below from CHANGE_ME to the exact token.

begin;

select set_config(
  'promotionsure.prelaunch_reset_confirmation',
  'RESET_PROMOTIONSURE_TEST_DATA_BEFORE_LAUNCH',
  true
);

do $$
begin
  if current_setting('promotionsure.prelaunch_reset_confirmation', true)
     <> 'RESET_PROMOTIONSURE_TEST_DATA_BEFORE_LAUNCH' then
    raise exception
      'Reset blocked. Edit the confirmation token only after backup and inspection.';
  end if;
end;
$$;

create temp table prelaunch_target_users on commit drop as
select u.id
from auth.users as u
left join public.profiles as p on p.id = u.id
where coalesce(p.role::text, 'candidate') <> 'admin';

do $$
declare
  v_target_count integer;
  v_admin_count integer;
begin
  select count(*) into v_target_count from prelaunch_target_users;
  select count(*) into v_admin_count from public.profiles where role = 'admin';

  if v_admin_count < 1 then
    raise exception 'Reset blocked. No admin profile would remain.';
  end if;

  raise notice 'Reset will remove % non-admin auth users and preserve % admin profiles.',
    v_target_count,
    v_admin_count;
end;
$$;

-- Content rows may have been created during testing by accounts being removed.
-- Keep the content; only clear stale editor/audit references.
update public.questions
set created_by = null
where created_by in (select id from prelaunch_target_users);

update public.questions
set updated_by = null
where updated_by in (select id from prelaunch_target_users);

update public.practice_sets
set created_by = null
where created_by in (select id from prelaunch_target_users);

update public.practice_sets
set updated_by = null
where updated_by in (select id from prelaunch_target_users);

update public.oral_questions
set created_by = null
where created_by in (select id from prelaunch_target_users);

update public.oral_questions
set updated_by = null
where updated_by in (select id from prelaunch_target_users);

update public.admin_audit_logs
set actor_id = null
where actor_id in (select id from prelaunch_target_users);

-- Delete user-owned state in dependency order. Some of this would cascade from
-- auth.users/profile deletion, but explicit deletes make the operation clearer
-- and avoid surprises with non-cascading references.
delete from private.edge_rate_limits
where user_id in (select id from prelaunch_target_users);

delete from public.payment_provider_events as e
using public.payment_orders as o
where e.payment_order_id = o.id
  and o.user_id in (select id from prelaunch_target_users);

delete from public.module_entitlements
where user_id in (select id from prelaunch_target_users);

delete from public.payment_orders
where user_id in (select id from prelaunch_target_users);

delete from public.entitlements
where user_id in (select id from prelaunch_target_users);

delete from public.attempt_submission_keys
where user_id in (select id from prelaunch_target_users);

delete from public.objective_practice_sessions
where user_id in (select id from prelaunch_target_users);

delete from public.user_module_progress
where user_id in (select id from prelaunch_target_users);

delete from public.attempt_answers
where user_id in (select id from prelaunch_target_users);

delete from public.attempts
where user_id in (select id from prelaunch_target_users);

delete from public.oral_responses
where user_id in (select id from prelaunch_target_users);

delete from public.oral_attempts
where user_id in (select id from prelaunch_target_users);

delete from public.support_requests
where user_id in (select id from prelaunch_target_users);

delete from public.app_error_events
where user_id in (select id from prelaunch_target_users);

delete from public.user_legal_acceptances
where user_id in (select id from prelaunch_target_users);

-- Clear auth session state before deleting users. If a hosted Auth table ever
-- differs, the transaction will fail and roll back instead of half-resetting.
delete from auth.refresh_tokens
where user_id in (select id::text from prelaunch_target_users);

delete from auth.sessions
where user_id in (select id from prelaunch_target_users);

delete from auth.users
where id in (select id from prelaunch_target_users);

do $$
declare
  v_remaining_non_admin_users integer;
  v_content_questions integer;
  v_content_sets integer;
  v_admin_count integer;
begin
  select count(*)
  into v_remaining_non_admin_users
  from auth.users as u
  left join public.profiles as p on p.id = u.id
  where coalesce(p.role::text, 'candidate') <> 'admin';

  select count(*) into v_content_questions from public.questions;
  select count(*) into v_content_sets from public.practice_sets;
  select count(*) into v_admin_count from public.profiles where role = 'admin';

  if v_remaining_non_admin_users <> 0 then
    raise exception 'Reset verification failed. % non-admin users remain.',
      v_remaining_non_admin_users;
  end if;

  if v_admin_count < 1 then
    raise exception 'Reset verification failed. No admin profile remains.';
  end if;

  if v_content_questions < 1 or v_content_sets < 1 then
    raise exception
      'Reset verification failed. Content counts look wrong: % questions, % practice sets.',
      v_content_questions,
      v_content_sets;
  end if;

  raise notice 'Reset verified: % admin profile(s), % objective question(s), % practice set(s).',
    v_admin_count,
    v_content_questions,
    v_content_sets;
end;
$$;

commit;
