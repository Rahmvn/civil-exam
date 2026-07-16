begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

update public.exam_packs set is_active = false;
insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, trial_question_limit,
  active_from, active_until, is_active
) values (
  'd0000000-0000-4000-8000-000000000001', 'optional-guidance-pack',
  'Optional Guidance Pack', 'Optional objective guidance fixture', 250000, 'NGN', 20,
  current_date - 1, current_date + 365, true
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'optional-guidance-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
  '', '', '', '', '{"provider":"email","providers":["email"]}',
  '{"full_name":"Optional Guidance Admin"}', now(), now()
);
update public.profiles set role = 'admin' where id = 'd1000000-0000-4000-8000-000000000001';

create temporary table optional_guidance_fixture (
  module_id uuid,
  set_id uuid,
  question_id uuid,
  revision_id uuid
);
grant all on optional_guidance_fixture to authenticated;
insert into optional_guidance_fixture default values;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

update optional_guidance_fixture set module_id = (
  select (public.admin_create_module_typed(
    'Optional Guidance Module', 'optional-guidance-module', 90, 200000,
    'NGN', 1, 70, 'draft', 'objective'
  )->>'subject_id')::uuid
);

update optional_guidance_fixture set set_id = (
  select (public.admin_create_practice_set(module_id, 1)->>'id')::uuid
  from optional_guidance_fixture
);

select lives_ok(
  $$ select public.admin_save_question(jsonb_build_object(
    'practice_set_id', set_id, 'batch_position', 1,
    'question_text', 'Which record confirms the approved allocation?',
    'option_a', 'Vote book', 'option_b', 'Visitor register',
    'option_c', 'Personal note', 'option_d', 'Blank form',
    'correct_option', 'A', 'difficulty', 'medium',
    'explanation', '', 'reference_note', ''
  )) from optional_guidance_fixture $$,
  'an objective question can be saved without explanation or reference'
);

update optional_guidance_fixture set question_id = (
  select q.id from public.questions q where q.practice_set_id = set_id
);

select is((select explanation from public.questions where id = (select question_id from optional_guidance_fixture)),
  '', 'a missing explanation is stored consistently as an empty string');
select is((select reference_note from public.questions where id = (select question_id from optional_guidance_fixture)),
  '', 'a missing reference is stored consistently as an empty string');
select is((public.admin_get_practice_set_validation((select set_id from optional_guidance_fixture))->>'ready')::boolean,
  true, 'blank optional guidance does not block readiness');

select lives_ok(
  $$ select public.admin_transition_practice_set((select set_id from optional_guidance_fixture), 'review') $$,
  'the set can enter review without optional guidance'
);
select lives_ok(
  $$ select public.admin_transition_practice_set((select set_id from optional_guidance_fixture), 'published') $$,
  'the set can be published without optional guidance'
);

update optional_guidance_fixture set revision_id = (
  select (public.admin_create_question_revision(jsonb_build_object(
    'id', question_id, 'batch_position', 1, 'difficulty', 'medium',
    'question_text', 'Which official record confirms the approved allocation?',
    'option_a', 'Vote book', 'option_b', 'Visitor register',
    'option_c', 'Personal note', 'option_d', 'Blank form',
    'correct_option', 'A', 'explanation', '', 'reference_note', ''
  ))->>'id')::uuid
  from optional_guidance_fixture
);

select ok((select revision_id is not null from optional_guidance_fixture),
  'a published correction can omit explanation and reference');
select lives_ok(
  $$ select public.admin_publish_question_revision((select revision_id from optional_guidance_fixture)) $$,
  'a correction without optional guidance can be published'
);
select ok(
  (select status = 'published' and explanation = '' and reference_note = ''
   from public.questions where id = (select revision_id from optional_guidance_fixture)),
  'the corrected live question preserves blank optional guidance safely'
);

select * from finish();
rollback;
