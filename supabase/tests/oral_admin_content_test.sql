begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

update public.exam_packs set is_active = false;
insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, trial_question_limit,
  active_from, active_until, is_active
) values (
  'c0000000-0000-4000-8000-000000000001', 'oral-admin-pack', 'Oral Admin Pack',
  'Oral administration fixture', 250000, 'NGN', 20,
  current_date - 1, current_date + 365, true
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'oral-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
  '', '', '', '', '{"provider":"email","providers":["email"]}',
  '{"full_name":"Oral Admin"}', now(), now()
);
update public.profiles set role = 'admin' where id = 'c1000000-0000-4000-8000-000000000001';

create temporary table oral_admin_fixture (module_id uuid, set_id uuid, first_id uuid, revision_id uuid);
grant all on oral_admin_fixture to authenticated;
insert into oral_admin_fixture default values;

select ok(not has_function_privilege('anon', 'public.admin_save_oral_question(jsonb)', 'EXECUTE'),
  'anonymous clients cannot save oral content');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

update oral_admin_fixture set module_id = (
  select (public.admin_create_module_typed(
    'Oral Interview Practice', 'oral-interview-practice', 80, 200000,
    'NGN', 2, 70, 'draft', 'oral'
  )->>'subject_id')::uuid
);

select is((select practice_type::text from public.subjects where id = (select module_id from oral_admin_fixture)),
  'oral', 'admin can create an oral module explicitly');

update oral_admin_fixture set set_id = (
  select (public.admin_create_practice_set((select module_id from oral_admin_fixture), 2)->>'id')::uuid
);

select is((
  select practice_type::text
  from public.get_admin_practice_sets_v2((select module_id from oral_admin_fixture))
  where practice_set_id = (select set_id from oral_admin_fixture)
),
  'oral', 'new practice sets inherit the module type');

-- Raw table writes are RPC-only for application roles. Use the trusted test
-- role solely to prove the table trigger still rejects mixed content types.
reset role;
select throws_ok(
  $$ insert into public.questions (
    exam_pack_id, subject_id, practice_set_id, batch_number, batch_position,
    question_text, option_a, option_b, option_c, option_d, correct_option, source_note
  ) select 'c0000000-0000-4000-8000-000000000001', module_id, set_id, 1, 1,
    'Wrong type', 'A', 'B', 'C', 'D', 'A', 'test' from oral_admin_fixture $$,
  'P0001',
  'The objective question must belong to an objective set in the same module and exam pack',
  'objective questions cannot enter an oral set'
);
set local role authenticated;

update oral_admin_fixture set first_id = (
  select (public.admin_save_oral_question(jsonb_build_object(
    'practice_set_id', set_id, 'batch_position', 1,
    'question_text', 'Explain accountability in public service.',
    'model_answer', 'Accountability means being answerable for decisions and resources.',
    'key_points', jsonb_build_array('Answerability', 'Responsible use of resources'),
    'difficulty', 'medium', 'reference_note', 'PSR', 'source_note', 'pgtap'
  ))->>'id')::uuid from oral_admin_fixture
);

select lives_ok(
  $$ select public.admin_save_oral_question(jsonb_build_object(
    'practice_set_id', set_id, 'batch_position', 2,
    'question_text', 'Describe due process.',
    'model_answer', 'Due process follows approved and documented procedures.',
    'key_points', jsonb_build_array('Approved procedure', 'Documented decisions'),
    'difficulty', 'easy'
  )) from oral_admin_fixture $$,
  'admin can add complete oral questions'
);

select throws_ok(
  $$ select public.admin_save_oral_question(jsonb_build_object(
    'practice_set_id', set_id, 'batch_position', 3,
    'question_text', 'Incomplete guidance', 'model_answer', '',
    'key_points', jsonb_build_array('Point')
  )) from oral_admin_fixture $$,
  'P0001', 'Model answer is required',
  'oral question writes require review guidance'
);

select ok((select (public.admin_get_practice_set_validation_v2(set_id)->>'ready')::boolean from oral_admin_fixture),
  'a complete oral set passes oral readiness checks');

select lives_ok($$ select public.admin_transition_practice_set_v2(set_id, 'review') from oral_admin_fixture $$,
  'oral sets can move to review');
select lives_ok($$ select public.admin_transition_practice_set_v2(set_id, 'published') from oral_admin_fixture $$,
  'reviewed oral sets can be published');

select is((select question_count::integer from public.get_admin_content_modules_v2() where subject_id = (select module_id from oral_admin_fixture)),
  2, 'oral-aware module counts use oral questions');
select is((select published_count::integer from public.get_admin_practice_sets_v2((select module_id from oral_admin_fixture)) where practice_set_id = (select set_id from oral_admin_fixture)),
  2, 'oral-aware practice-set counts report published oral questions');
select ok((select not available_for_purchase from public.get_admin_content_modules_v2() where subject_id = (select module_id from oral_admin_fixture)),
  'publishing oral content does not silently enable sales');

update oral_admin_fixture set revision_id = (
  select (public.admin_create_oral_question_revision(jsonb_build_object(
    'id', first_id, 'batch_position', 1,
    'question_text', 'Explain accountability clearly in public service.',
    'model_answer', 'Accountability is answerability for decisions, conduct, and public resources.',
    'key_points', jsonb_build_array('Answerability', 'Conduct', 'Public resources'),
    'difficulty', 'medium', 'reference_note', 'PSR'
  ))->>'id')::uuid from oral_admin_fixture
);

select is((select status::text from public.oral_questions where id = (select revision_id from oral_admin_fixture)),
  'review', 'published oral corrections are staged as revisions');
select lives_ok($$ select public.admin_publish_oral_question_revision(revision_id) from oral_admin_fixture $$,
  'an oral correction can be published transactionally');
select is((select status::text from public.oral_questions where id = (select first_id from oral_admin_fixture)),
  'archived', 'publishing a correction archives the previous version');
select is((select status::text from public.oral_questions where id = (select revision_id from oral_admin_fixture)),
  'published', 'the corrected oral question becomes live');

select throws_ok(
  $$ select public.admin_delete_empty_practice_set_v2(set_id) from oral_admin_fixture $$,
  'P0001', 'Only an empty unused practice set can be permanently deleted',
  'oral content prevents destructive practice-set deletion'
);
select throws_ok(
  $$ select public.admin_delete_empty_module_v2(module_id) from oral_admin_fixture $$,
  'P0001', 'Only an unused module can be permanently deleted',
  'oral content prevents destructive module deletion'
);

select lives_ok($$ select public.admin_transition_practice_set_v2(set_id, 'archived') from oral_admin_fixture $$,
  'published oral sets can be archived safely');
select ok(exists(select 1 from public.admin_audit_logs where entity_type = 'oral_question'),
  'oral question operations are recorded in the admin audit log');

select * from finish();
rollback;
