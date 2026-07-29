begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(46);

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
select ok(has_function_privilege('anon', 'public.get_public_module_catalog()', 'EXECUTE'),
  'anonymous users can read the narrow public module catalogue');
select ok(has_function_privilege('anon', 'public.get_public_launch_offer()', 'EXECUTE'),
  'anonymous users can read the narrow active launch offer');
select is(
  (
    select count(*)::integer
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  2,
  'only the public catalogue and active launch offer are anonymous public-schema functions'
);

select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated users can read profiles through RLS');
select ok(has_column_privilege('authenticated', 'public.profiles', 'phone_number', 'UPDATE'),
  'authenticated users can update permitted profile fields');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
  'authenticated users cannot update profile authorization fields');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'c1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'profile-rls-one@example.test',
    'local-test-only',
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Profile RLS One"}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'c1000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'profile-rls-two@example.test',
    'local-test-only',
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Profile RLS Two"}',
    now(), now()
  );

insert into public.profiles (id, email, full_name)
values
  ('c1000000-0000-4000-8000-000000000001', 'profile-rls-one@example.test', 'Profile RLS One'),
  ('c1000000-0000-4000-8000-000000000002', 'profile-rls-two@example.test', 'Profile RLS Two')
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$
    update public.profiles
    set phone_number = '08142857377',
        state_code = 'Delta',
        organization_name = 'finance'
    where id = 'c1000000-0000-4000-8000-000000000001'
  $$,
  'candidate optional profile details update without recursive RLS'
);

select is(
  (
    select organization_name
    from public.profiles
    where id = 'c1000000-0000-4000-8000-000000000001'
  ),
  'finance',
  'candidate can read their own updated optional details'
);

select throws_ok(
  $$
    update public.profiles
    set phone_number = 'call-me-on-this-number'
    where id = 'c1000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'profile phone numbers reject non-phone text'
);

select throws_ok(
  $$
    update public.profiles
    set state_code = 'Atlantis'
    where id = 'c1000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'profile state is constrained to known Nigerian states'
);

select throws_ok(
  $$
    update public.profiles
    set organization_name = repeat('x', 121)
    where id = 'c1000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'profile organisation names are length-limited'
);

select is(
  (
    select count(*)::integer
    from public.profiles
    where id = 'c1000000-0000-4000-8000-000000000002'
  ),
  0,
  'candidate cannot read another candidate profile'
);

reset role;

select throws_ok(
  $$
    update public.profiles
    set full_name = repeat('x', 121)
    where id = 'c1000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'profile names originating from auth metadata are length-limited'
);

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
select ok(not has_function_privilege('anon', 'public.consume_edge_rate_limit(uuid,text,integer,integer)', 'EXECUTE'),
  'anonymous users cannot call the Edge rate limiter');
select ok(not has_function_privilege('authenticated', 'public.consume_edge_rate_limit(uuid,text,integer,integer)', 'EXECUTE'),
  'browser clients cannot call the Edge rate limiter');
select ok(has_function_privilege('service_role', 'public.consume_edge_rate_limit(uuid,text,integer,integer)', 'EXECUTE'),
  'trusted Edge Functions can call the rate limiter');

set local role service_role;
select ok(
  public.consume_edge_rate_limit(
    'c1000000-0000-4000-8000-000000000001',
    'payment_verify',
    2,
    300
  ),
  'the first payment verification request is allowed'
);
select ok(
  public.consume_edge_rate_limit(
    'c1000000-0000-4000-8000-000000000001',
    'payment_verify',
    2,
    300
  ),
  'the last request inside the payment verification allowance is allowed'
);
select ok(
  not public.consume_edge_rate_limit(
    'c1000000-0000-4000-8000-000000000001',
    'payment_verify',
    2,
    300
  ),
  'payment verification requests over the allowance are rejected'
);
reset role;

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
select is(
  (
    select count(*)::integer
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname ilike 'admin_%'
        or p.proname ilike 'get_admin_%'
        or p.proname ilike '%admin%'
        or p.proname in ('update_support_request')
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  0,
  'anonymous users cannot execute admin or admin-adjacent RPCs'
);
select is(
  (
    select count(*)::integer
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname <> 'is_admin'
      and (
        p.proname ilike 'admin_%'
        or p.proname ilike 'get_admin_%'
        or p.proname ilike '%admin%'
        or p.proname in ('update_support_request')
      )
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not (
        p.prosrc ilike '%admin_assert_access%'
        or p.prosrc ilike '%is_admin()%'
        or p.prosrc ilike '%public.admin_%'
      )
  ),
  0,
  'authenticated admin RPCs enforce admin access directly or through checked admin wrappers'
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
