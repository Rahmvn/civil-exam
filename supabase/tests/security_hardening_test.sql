begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(29);

create table public.security_acl_table_probe (id integer);
create function public.security_acl_function_probe()
returns integer
language sql
as $$ select 1 $$;

select ok(not has_table_privilege('anon', 'public.security_acl_table_probe', 'SELECT'),
  'future tables are private from anonymous users by default');
select ok(not has_table_privilege('authenticated', 'public.security_acl_table_probe', 'SELECT'),
  'future tables require an explicit authenticated grant');
select ok(not has_table_privilege('service_role', 'public.security_acl_table_probe', 'SELECT'),
  'future tables require an explicit service-role grant');
select ok(not has_function_privilege('anon', 'public.security_acl_function_probe()', 'EXECUTE'),
  'future functions are private from anonymous users by default');
select ok(not has_function_privilege('authenticated', 'public.security_acl_function_probe()', 'EXECUTE'),
  'future functions require an explicit authenticated grant');
select ok(not has_function_privilege('service_role', 'public.security_acl_function_probe()', 'EXECUTE'),
  'future functions require an explicit service-role grant');

select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous role cannot read profiles');
select ok(not has_table_privilege('anon', 'public.attempts', 'SELECT'),
  'anonymous role cannot read attempts');
select ok(not has_table_privilege('anon', 'public.attempt_answers', 'SELECT'),
  'anonymous role cannot read attempt answers');
select ok(not has_function_privilege('anon', 'public.ensure_my_profile()', 'EXECUTE'),
  'anonymous role cannot recover an authenticated profile');
select ok(not has_function_privilege('anon', 'public.get_module_access_catalog()', 'EXECUTE'),
  'anonymous role cannot call candidate module access RPCs');
select is(
  (
    select count(*)::integer
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  0,
  'no public-schema function is executable by anonymous users'
);

select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated users can read profiles through RLS');
select ok(has_column_privilege('authenticated', 'public.profiles', 'phone_number', 'UPDATE'),
  'authenticated users can update permitted profile fields');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
  'authenticated users cannot update profile authorization fields');
select ok(has_table_privilege('authenticated', 'public.attempts', 'SELECT'),
  'authenticated users can read their attempt history through RLS');
select ok(has_table_privilege('authenticated', 'public.questions', 'SELECT'),
  'authenticated admins retain direct question reads through RLS');
select ok(not has_table_privilege('authenticated', 'public.questions', 'UPDATE'),
  'question writes remain RPC-only');
select ok(not has_table_privilege('authenticated', 'public.payment_orders', 'SELECT'),
  'payment order internals are not directly browser-readable');
select ok(has_function_privilege('authenticated', 'public.start_practice_batch(text,integer)', 'EXECUTE'),
  'authenticated candidates can start an allowed objective batch');
select ok(has_function_privilege('authenticated', 'public.get_admin_content_modules_v2()', 'EXECUTE'),
  'authenticated admins retain current content RPC access');
select ok(not has_function_privilege('authenticated', 'public.activate_module_purchase(text,jsonb)', 'EXECUTE'),
  'browser clients cannot activate payment entitlements');
select ok(has_function_privilege('service_role', 'public.activate_module_purchase(text,jsonb)', 'EXECUTE'),
  'verified server payment flow can activate an entitlement');
select is(
  (
    select count(*)::integer
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=public, pg_temp']
  ),
  0,
  'all public SECURITY DEFINER functions use the fixed safe search path'
);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and roles = '{public}'),
  0,
  'all application RLS policies are scoped to authenticated users'
);
select ok(to_regclass('public.attempts_user_started_idx') is not null,
  'recent-attempt history index exists');
select ok(to_regclass('public.attempt_answers_user_question_answered_idx') is not null,
  'review lookup index exists');
select ok(to_regclass('public.questions_pack_subject_batch_status_position_idx') is not null,
  'published question batch index exists');
select ok(to_regclass('public.app_error_events_user_created_idx') is not null,
  'error-event rate-limit index exists');

select * from finish();
rollback;
