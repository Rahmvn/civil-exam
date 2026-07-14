begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(28);

update public.exam_packs set is_active = false;

insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, trial_question_limit,
  active_from, active_until, is_active
) values (
  '90000000-0000-4000-8000-000000000001',
  'e2e-policy-pack',
  'E2E Policy Pack',
  'Transactional database test fixture',
  250000,
  'NGN',
  20,
  current_date - 1,
  current_date + 365,
  true
);

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size, pass_mark_percent
) values
  (
    '91000000-0000-4000-8000-000000000001',
    'E2E Financial Management',
    'e2e-financial-management',
    '',
    1,
    true,
    4,
    70
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'E2E Service Rules',
    'e2e-service-rules',
    '',
    2,
    true,
    2,
    70
  );

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '92000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'paid-db@example.test',
    crypt('LocalTestOnly!2026', gen_salt('bf')),
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Paid DB Candidate"}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '92000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'free-db@example.test',
    crypt('LocalTestOnly!2026', gen_salt('bf')),
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Free DB Candidate"}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '92000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'module-db@example.test',
    crypt('LocalTestOnly!2026', gen_salt('bf')),
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Module DB Candidate"}',
    now(), now()
  );

insert into public.entitlements (
  user_id, exam_pack_id, paystack_reference, status, amount_kobo, currency, expires_at
) values (
  '92000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'e2e-policy-paid',
  'active',
  250000,
  'NGN',
  now() + interval '1 year'
);

insert into public.module_offerings (
  id, exam_pack_id, subject_id, price_kobo, currency, is_active
) values (
  '95000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  150000,
  'NGN',
  true
);

insert into public.payment_orders (
  id, user_id, exam_pack_id, subject_id, module_offering_id,
  provider_reference, status, amount_kobo, currency
) values (
  '96000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',
  'e2e-module-payment',
  'pending',
  150000,
  'NGN'
);

do $$
begin
  perform * from public.activate_module_purchase(
    'e2e-module-payment',
    '{"status":"success","amount":150000,"currency":"NGN"}'::jsonb
  );
end;
$$;

update public.profiles
set
  phone_number = '+2348000000000',
  state_code = 'FC',
  service_level = 'GL 10',
  organization_name = 'E2E Ministry',
  onboarding_completed_at = now()
where id in (
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000003'
);

insert into public.questions (
  id, exam_pack_id, subject_id, difficulty, question_text,
  option_a, option_b, option_c, option_d, correct_option, explanation,
  reference_note, source_note, status, batch_number, batch_position
) values
  ('93000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'medium', 'Policy question 1', 'A1', 'B1', 'C1', 'D1', 'A', 'A is correct.', '', 'pgtap', 'published', 1, 1),
  ('93000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'medium', 'Policy question 2', 'A2', 'B2', 'C2', 'D2', 'B', 'B is correct.', '', 'pgtap', 'published', 1, 2),
  ('93000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'medium', 'Policy question 3', 'A3', 'B3', 'C3', 'D3', 'C', 'C is correct.', '', 'pgtap', 'published', 1, 3),
  ('93000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'medium', 'Policy question 4', 'A4', 'B4', 'C4', 'D4', 'D', 'D is correct.', '', 'pgtap', 'published', 1, 4),
  ('93000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'medium', 'Policy question 5', 'A5', 'B5', 'C5', 'D5', 'A', 'A is correct.', '', 'pgtap', 'published', 2, 1),
  ('93000000-0000-4000-8000-000000000006', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'medium', 'Policy question 6', 'A6', 'B6', 'C6', 'D6', 'B', 'B is correct.', '', 'pgtap', 'published', 2, 2),
  ('94000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'medium', 'Rules question 1', 'A1', 'B1', 'C1', 'D1', 'A', 'A is correct.', '', 'pgtap', 'published', 1, 1),
  ('94000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'medium', 'Rules question 2', 'A2', 'B2', 'C2', 'D2', 'B', 'B is correct.', '', 'pgtap', 'published', 1, 2);

select is(
  (select count(*)::integer from public.profiles where id in (
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000003'
  )),
  3,
  'auth users receive profiles'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  public.has_active_entitlement('90000000-0000-4000-8000-000000000001'),
  'paid user has active access'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.activate_module_purchase(text,jsonb)',
    'EXECUTE'
  ),
  'clients cannot activate a pending module purchase directly'
);
select is(
  (select can_start from public.get_batch_access_state('e2e-financial-management', 1)),
  true,
  'paid user can start the first set'
);
select is(
  (select can_start from public.get_batch_access_state('e2e-financial-management', 2)),
  true,
  'paid user can start a later published set'
);

create temporary table paid_questions as
select * from public.start_practice_batch('e2e-financial-management', 1);

select is((select count(*)::integer from paid_questions), 4, 'practice returns every published question in the set');
select ok(
  not exists (
    select 1
    from paid_questions
    where correct_option is not null or explanation is not null
  ),
  'practice payload does not expose answer-key values'
);

create temporary table paid_result as
select * from public.submit_attempt(
  'timed_mock',
  '91000000-0000-4000-8000-000000000001',
  '[
    {"question_id":"93000000-0000-4000-8000-000000000001","selected_option":"A","display_order":1,"option_order":["A","B","C","D"]},
    {"question_id":"93000000-0000-4000-8000-000000000002","selected_option":"B","display_order":2,"option_order":["B","A","D","C"]},
    {"question_id":"93000000-0000-4000-8000-000000000003","selected_option":"C","display_order":3,"option_order":["C","D","A","B"]},
    {"question_id":"93000000-0000-4000-8000-000000000004","selected_option":"D","display_order":4,"option_order":["D","C","B","A"]}
  ]'::jsonb,
  1
);

select is((select passed from paid_result), true, 'a score at or above the pass mark passes');
select is((select score_percent from paid_result), 100, 'score percentage is calculated from persisted answers');
select is((select next_action from paid_result), 'next_batch', 'a passed set recommends the next published set');
select is(
  (select option_order::text from public.attempt_answers where attempt_id = (select attempt_id from paid_result) and display_order = 2),
  '{B,A,D,C}',
  'submitted option order is preserved for review'
);
select is(
  (select next_recommended_batch from public.get_batch_access_state('e2e-financial-management', 1)),
  2,
  'progression recommends the nearest unfinished published set'
);
select is((select count(*)::integer from public.questions), 0, 'candidate cannot read the answer-key table directly');
select is(
  (select count(*)::integer from public.get_attempt_review((select attempt_id from paid_result))),
  4,
  'owner can review every submitted question'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  public.has_active_module_entitlement(
    '90000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001'
  ),
  'module buyer has access to the purchased module'
);
select ok(
  not public.has_active_module_entitlement(
    '90000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002'
  ),
  'module buyer does not receive access to another module'
);
select is(
  (select can_start from public.get_batch_access_state('e2e-financial-management', 2)),
  true,
  'module buyer can start a later set in the purchased module'
);
select is(
  (select reason_code from public.get_batch_access_state('e2e-service-rules', 1)),
  'free_batch_available',
  'an unpurchased module remains eligible only for the unused free choice'
);
select is(
  (select count(*)::integer from public.get_module_access_catalog() where has_module_access),
  1,
  'module catalog reports exactly one unlocked module'
);
select is(
  (select subject_name from public.get_payment_history(10) where provider_reference = 'e2e-module-payment'),
  'E2E Financial Management',
  'payment history identifies the module that was purchased'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '92000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer from public.start_practice_batch('e2e-financial-management', 1)),
  4,
  'free user can select and start one module'
);
select is(
  (select reason_code from public.get_batch_access_state('e2e-service-rules', 1)),
  'free_different_module_requires_payment',
  'another module stays locked for the free user'
);

create temporary table free_first_result as
select * from public.submit_attempt(
  'timed_mock',
  '91000000-0000-4000-8000-000000000001',
  '[
    {"question_id":"93000000-0000-4000-8000-000000000001","selected_option":null},
    {"question_id":"93000000-0000-4000-8000-000000000002","selected_option":null},
    {"question_id":"93000000-0000-4000-8000-000000000003","selected_option":null},
    {"question_id":"93000000-0000-4000-8000-000000000004","selected_option":null}
  ]'::jsonb,
  1
);

select is((select next_action from free_first_result), 'retry_free_batch', 'first failed free attempt receives one retry');
select is(
  (select count(*)::integer from public.attempt_answers where attempt_id = (select attempt_id from free_first_result) and selected_option is null and is_correct = false),
  4,
  'unanswered questions persist safely as incorrect'
);

create temporary table free_retry_result as
select * from public.submit_attempt(
  'timed_mock',
  '91000000-0000-4000-8000-000000000001',
  '[
    {"question_id":"93000000-0000-4000-8000-000000000001","selected_option":"D"},
    {"question_id":"93000000-0000-4000-8000-000000000002","selected_option":"D"},
    {"question_id":"93000000-0000-4000-8000-000000000003","selected_option":"D"},
    {"question_id":"93000000-0000-4000-8000-000000000004","selected_option":"A"}
  ]'::jsonb,
  1
);

select is((select next_action from free_retry_result), 'unlock_module', 'second failed free attempt requires that module to be unlocked');
select is(
  (select can_start from public.get_batch_access_state('e2e-financial-management', 1)),
  false,
  'free set cannot be started after the retry is consumed'
);
select is(
  (select count(*)::integer from public.attempts where id = (select attempt_id from paid_result)),
  0,
  'candidate cannot read another candidate attempt'
);
select is(
  (select count(*)::integer from public.get_attempt_review((select attempt_id from paid_result))),
  0,
  'candidate cannot review another candidate attempt'
);

select * from finish();
rollback;
