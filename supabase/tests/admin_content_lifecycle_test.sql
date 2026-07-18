begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(40);

update public.exam_packs set is_active = false;
insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, trial_question_limit,
  active_from, active_until, is_active
) values (
  'd0000000-0000-4000-8000-000000000001', 'lifecycle-pack', 'Lifecycle Pack',
  'Lifecycle test fixture', 200000, 'NGN', 20,
  current_date - 1, current_date + 365, true
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'lifecycle-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Lifecycle Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'lifecycle-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
   '', '', '', '', '{"provider":"email","providers":["email"]}', '{"full_name":"Lifecycle Candidate"}', now(), now());

update public.profiles set role = 'admin'
where id = 'd1000000-0000-4000-8000-000000000001';
update public.profiles set service_level = 'GL 07-10'
where id = 'd1000000-0000-4000-8000-000000000002';

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size,
  pass_mark_percent, lifecycle_status, practice_type, candidate_availability
) values (
  'd2000000-0000-4000-8000-000000000001', 'Lifecycle Objective', 'lifecycle-objective',
  '', 10, true, 2, 70, 'active', 'objective', 'available'
);

insert into public.module_offerings (exam_pack_id, subject_id, price_kobo, currency, is_active)
values ('d0000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 200000, 'NGN', true);

insert into public.entitlements (
  user_id, exam_pack_id, paystack_reference, status, amount_kobo, currency, expires_at
) values (
  'd1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
  'lifecycle-entitlement', 'active', 200000, 'NGN', now() + interval '30 days'
);

insert into public.practice_sets (
  id, exam_pack_id, subject_id, set_number, expected_question_count,
  status, practice_type, created_by, updated_by
) values (
  'd3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001', 1, 2, 'draft', 'objective',
  'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001'
);

insert into public.questions (
  id, exam_pack_id, subject_id, practice_set_id, batch_number, batch_position,
  question_text, option_a, option_b, option_c, option_d, correct_option,
  explanation, source_note, status
) values
  ('d4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 1, 1,
   'Lifecycle question one?', 'Correct one', 'Wrong', 'Wrong C', 'Wrong D', 'A', 'A is correct.', 'pgtap', 'draft'),
  ('d4000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 1, 2,
   'Lifecycle question two?', 'Wrong', 'Correct two', 'Wrong C', 'Wrong D', 'B', 'B is correct.', 'pgtap', 'draft');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$ select public.admin_transition_practice_set_v2('d3000000-0000-4000-8000-000000000001', 'review') $$,
  'draft can move to review');
select is((select status::text from public.practice_sets where id = 'd3000000-0000-4000-8000-000000000001'), 'review',
  'review status is persisted');
select lives_ok($$ select public.admin_transition_practice_set_v2('d3000000-0000-4000-8000-000000000001', 'draft') $$,
  'review can return to draft');
select lives_ok($$ select public.admin_transition_practice_set_v2('d3000000-0000-4000-8000-000000000001', 'review') $$,
  'returned draft can re-enter review');
select lives_ok($$ select public.admin_transition_practice_set_v2('d3000000-0000-4000-8000-000000000001', 'published') $$,
  'review can publish');
select ok((public.admin_get_practice_set_capabilities('d3000000-0000-4000-8000-000000000001')->>'can_withdraw')::boolean,
  'published capabilities allow temporary withdrawal');
select throws_ok(
  $$ select public.admin_transition_practice_set_v2('d3000000-0000-4000-8000-000000000001', 'draft') $$,
  'P0001', 'Only a review practice set can return to draft',
  'published content cannot return directly to draft'
);
select throws_ok(
  $$ select public.admin_delete_unpublished_practice_set('d3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'Only an unpublished draft or review set can be deleted.',
  'published content cannot be permanently deleted'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table lifecycle_session as
select public.start_objective_practice_session(
  null, 'lifecycle-objective', 1, false
) as payload;
grant select on lifecycle_session to authenticated;

select is((select payload->>'practice_set_id' from lifecycle_session), 'd3000000-0000-4000-8000-000000000001',
  'new objective session is pinned to the published version');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$ select public.admin_withdraw_practice_set('d3000000-0000-4000-8000-000000000001') $$,
  'published set can be withdrawn');
select is((select status::text from public.practice_sets where id = 'd3000000-0000-4000-8000-000000000001'), 'withdrawn',
  'withdrawn status is persisted');
select is((select count(*)::integer from public.questions where practice_set_id = 'd3000000-0000-4000-8000-000000000001' and status = 'archived'), 2,
  'withdrawal removes questions from legacy new-attempt selection');
select throws_ok(
  $$ select public.admin_transition_practice_set_v2('d3000000-0000-4000-8000-000000000001', 'draft') $$,
  'P0001', 'Only a review practice set can return to draft',
  'a used withdrawn set cannot be reopened for editing'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table lifecycle_result as
select public.submit_objective_practice_session(
  (select (payload->>'practice_session_id')::uuid from lifecycle_session),
  'timed_mock',
  '[{"question_id":"d4000000-0000-4000-8000-000000000001","selected_option":"A","display_order":1},
    {"question_id":"d4000000-0000-4000-8000-000000000002","selected_option":"B","display_order":2}]'::jsonb
) as payload;
grant select on lifecycle_result to authenticated;

select is((select (payload->>'score')::integer from lifecycle_result), 2,
  'a pinned attempt submits after withdrawal');
select is((select practice_set_id::text from public.attempts where id = (select (payload->>'attempt_id')::uuid from lifecycle_result)),
  'd3000000-0000-4000-8000-000000000001', 'completed attempt remains pinned to its original version');
select is((select score from public.attempts where id = (select (payload->>'attempt_id')::uuid from lifecycle_result)), 2,
  'original score is stored');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$ select public.admin_republish_practice_set('d3000000-0000-4000-8000-000000000001') $$,
  'withdrawn set can be republished unchanged');
select lives_ok($$ select public.admin_withdraw_practice_set('d3000000-0000-4000-8000-000000000001') $$,
  'republished content can be withdrawn again before replacement');

create temporary table lifecycle_replacement as
select public.admin_create_practice_set_replacement('d3000000-0000-4000-8000-000000000001', true) as payload;
grant select on lifecycle_replacement to authenticated;

select is((select (payload->>'copied_question_count')::integer from lifecycle_replacement), 2,
  'replacement draft can copy current questions');
select is((select status::text from public.practice_sets where id = (select (payload->>'id')::uuid from lifecycle_replacement)), 'draft',
  'replacement begins as an editable draft');
select lives_ok($$ select public.admin_transition_practice_set_v2((select (payload->>'id')::uuid from lifecycle_replacement), 'review') $$,
  'replacement draft can enter review');
select lives_ok($$ select public.admin_publish_practice_set_replacement((select (payload->>'id')::uuid from lifecycle_replacement)) $$,
  'reviewed replacement publishes atomically');
select is((select status::text from public.practice_sets where id = 'd3000000-0000-4000-8000-000000000001'), 'archived',
  'source version is retired during replacement publication');
select is((select status::text from public.practice_sets where id = (select (payload->>'id')::uuid from lifecycle_replacement)), 'published',
  'replacement becomes the current published version');
select is((select score from public.attempts where id = (select (payload->>'attempt_id')::uuid from lifecycle_result)), 2,
  'replacement publication does not regrade historical attempts');
select throws_ok(
  $$ select public.admin_delete_unpublished_practice_set('d3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'Only an unpublished draft or review set can be deleted.',
  'the used replacement source remains protected from deletion'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select question_text
   from public.get_attempt_review((select (payload->>'attempt_id')::uuid from lifecycle_result))
   where display_order = 1),
  'Lifecycle question one?',
  'historical review still returns the original question content'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((public.start_objective_practice_session(null, 'lifecycle-objective', 1, false)->>'practice_set_id'),
  (select payload->>'id' from lifecycle_replacement), 'new attempts use the replacement version');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$ select public.admin_withdraw_practice_set((select (payload->>'id')::uuid from lifecycle_replacement)) $$,
  'published replacement can be temporarily withdrawn');
select lives_ok($$ select public.admin_retire_practice_set((select (payload->>'id')::uuid from lifecycle_replacement), 'End of lifecycle test') $$,
  'withdrawn replacement can be retired permanently');
select throws_ok(
  $$ select public.admin_republish_practice_set((select (payload->>'id')::uuid from lifecycle_replacement)) $$,
  'P0001', 'Only a withdrawn practice set can be republished',
  'retired versions cannot be republished');

reset role;
insert into public.practice_sets (
  id, exam_pack_id, subject_id, set_number, expected_question_count, status, practice_type
) values (
  'd3000000-0000-4000-8000-000000000099', 'd0000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001', 99, 1, 'draft', 'objective'
);
insert into public.questions (
  exam_pack_id, subject_id, practice_set_id, batch_number, batch_position,
  question_text, option_a, option_b, option_c, option_d, correct_option, source_note, status
) values (
  'd0000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000099', 99, 1, 'Unused draft question?', 'A', 'B', 'C', 'D', 'A', 'pgtap', 'draft'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select ok(public.admin_delete_unpublished_practice_set('d3000000-0000-4000-8000-000000000099'),
  'unused unpublished set and its questions can be deleted');

reset role;
insert into public.practice_sets (
  id, exam_pack_id, subject_id, set_number, expected_question_count, status, practice_type
) values (
  'd3000000-0000-4000-8000-000000000098', 'd0000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001', 98, 1, 'draft', 'objective'
);
insert into public.questions (
  exam_pack_id, subject_id, practice_set_id, batch_number, batch_position,
  question_text, option_a, option_b, option_c, option_d, correct_option, source_note, status
) values (
  'd0000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000098', 98, 1, 'Original draft question?', 'A', 'B', 'C', 'D', 'A', 'pgtap', 'draft'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$ select public.admin_replace_practice_set_questions(
    'd3000000-0000-4000-8000-000000000098',
    '[{"batch_position":1,"question_text":"First replacement?","option_a":"A","option_b":"B","option_c":"C","option_d":"D","correct_option":"A"},
      {"batch_position":1,"question_text":"Duplicate position?","option_a":"A","option_b":"B","option_c":"C","option_d":"D","correct_option":"A"}]'::jsonb
  ) $$,
  'P0001', 'Import row 2 uses an existing question position 1',
  'failed replace-all rejects the complete import'
);
select is(
  (select question_text from public.questions where practice_set_id = 'd3000000-0000-4000-8000-000000000098'),
  'Original draft question?',
  'failed replace-all rolls back and preserves the original questions'
);

select throws_ok(
  $$ select public.admin_replace_practice_set_questions(
    (select (payload->>'id')::uuid from lifecycle_replacement),
    '[{"batch_position":1,"question_text":"Blocked","option_a":"A","option_b":"B","option_c":"C","option_d":"D","correct_option":"A"}]'::jsonb
  ) $$,
  'P0001', 'Replace all is available only for draft or review practice sets',
  'replace-all is blocked for retired content');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$ select public.admin_withdraw_practice_set('d3000000-0000-4000-8000-000000000001') $$,
  'P0001', 'Administrator access is required',
  'non-admin cannot mutate lifecycle state');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$ select public.admin_update_module_availability('d2000000-0000-4000-8000-000000000001', 'paused', 'Content maintenance') $$,
  'module candidate practice can be paused independently');
select is((select status::text from public.entitlements where paystack_reference = 'lifecycle-entitlement'), 'active',
  'pausing a module preserves candidate entitlement');
select lives_ok($$ select public.admin_update_module_sales_availability('d2000000-0000-4000-8000-000000000001', false) $$,
  'new module sales can be stopped independently');
select is((select status::text from public.entitlements where paystack_reference = 'lifecycle-entitlement'), 'active',
  'stopping sales preserves existing entitlement');

select * from finish();
rollback;
