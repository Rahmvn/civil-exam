begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(54);

update public.exam_packs set is_active = false;

insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, trial_question_limit,
  active_from, active_until, is_active
) values (
  'a0000000-0000-4000-8000-000000000001',
  'admin-content-test-pack',
  'Admin Content Test Pack',
  'Transactional admin content fixture',
  250000,
  'NGN',
  20,
  current_date - 1,
  current_date + 365,
  true
);

insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, trial_question_limit,
  active_from, active_until, is_active
) values (
  'a0000000-0000-4000-8000-000000000002',
  'admin-content-older-pack',
  'Admin Content Older Pack',
  'Inactive edition fixture',
  250000,
  'NGN',
  20,
  current_date - 730,
  current_date - 365,
  false
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'content-admin@example.test',
    crypt('LocalTestOnly!2026', gen_salt('bf')),
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Content Admin"}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'a1000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'content-candidate@example.test',
    crypt('LocalTestOnly!2026', gen_salt('bf')),
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Content Candidate"}',
    now(), now()
  );

update public.profiles
set role = 'admin'
where id = 'a1000000-0000-4000-8000-000000000001';

create temporary table admin_module_fixture (module_id uuid not null);
create temporary table admin_set_fixture (set_id uuid not null);
create temporary table admin_question_fixture (
  original_id uuid not null,
  revision_id uuid
);
create temporary table admin_delete_question_fixture (question_id uuid not null);
create temporary table admin_history_question_fixture (question_id uuid not null);

grant all on admin_module_fixture, admin_set_fixture, admin_question_fixture, admin_delete_question_fixture, admin_history_question_fixture to authenticated;

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_create_module(text,text,integer,integer,text,integer,integer,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute admin content functions'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ select count(*) from public.get_admin_content_modules() $$,
  'P0001',
  'Admin access is required',
  'candidate cannot read the admin catalogue'
);

select throws_ok(
  $$ select public.admin_create_module('Blocked Module', 'blocked-module', 1, 150000, 'NGN', 2, 70, 'draft') $$,
  'P0001',
  'Admin access is required',
  'candidate cannot create a module'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into admin_module_fixture (module_id)
select (public.admin_create_module(
  'Admin Test Module',
  'admin-test-module',
  90,
  150000,
  'NGN',
  2,
  70,
  'draft'
)->>'subject_id')::uuid;

select ok(
  (select lifecycle_status = 'draft' and not is_active
   from public.subjects
   where id = (select module_id from admin_module_fixture)),
  'a new module begins as a private draft'
);

select ok(
  (select price_kobo = 150000 and not available_for_purchase
   from public.get_admin_content_modules()
   where subject_id = (select module_id from admin_module_fixture)),
  'a new module receives an inactive price record'
);

select is(
  (select count(*)::integer
   from public.get_admin_content_modules()
   where subject_id = (select module_id from admin_module_fixture)),
  1,
  'the admin catalogue returns the draft module'
);

reset role;
delete from public.module_offerings
where subject_id = (select module_id from admin_module_fixture);
set local role authenticated;

select public.admin_update_module(
  (select module_id from admin_module_fixture),
  'Admin Test Module',
  90,
  175000,
  'NGN',
  2,
  70,
  'draft',
  false
);

select ok(
  (select price_kobo = 175000 and not available_for_purchase
   from public.get_admin_content_modules()
   where subject_id = (select module_id from admin_module_fixture)),
  'module settings recreate a missing offering safely'
);

insert into admin_set_fixture (set_id)
select (public.admin_create_practice_set(
  (select module_id from admin_module_fixture),
  2
)->>'id')::uuid;

select ok(
  (select set_number = 1 and expected_question_count = 2 and status = 'draft'
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))
   where practice_set_id = (select set_id from admin_set_fixture)),
  'the first practice set is numbered and kept in draft'
);

select throws_ok(
  $$
    select public.admin_import_questions(
      (select set_id from admin_set_fixture),
      '[
        {"batch_position":1,"question_text":"Atomic import one","option_a":"A1","option_b":"B1","option_c":"C1","option_d":"D1","correct_option":"A","explanation":"A1 is correct."},
        {"batch_position":1,"question_text":"Atomic import two","option_a":"A2","option_b":"B2","option_c":"C2","option_d":"D2","correct_option":"B","explanation":"B2 is correct."}
      ]'::jsonb
    )
  $$,
  'P0001',
  'Import row 2 uses an existing question position 1',
  'a conflicting import is rejected'
);

select is(
  (select count(*)::integer
   from public.questions
   where practice_set_id = (select set_id from admin_set_fixture)),
  0,
  'a rejected import saves no partial rows'
);

insert into admin_question_fixture (original_id)
select (public.admin_save_question(jsonb_build_object(
  'practice_set_id', (select set_id from admin_set_fixture),
  'batch_position', 1,
  'difficulty', 'medium',
  'question_text', 'Which record should be checked first?',
  'option_a', 'The approved vote book',
  'option_b', 'An unrelated memo',
  'option_c', 'A blank form',
  'option_d', 'A personal note',
  'correct_option', 'A',
  'explanation', '',
  'reference_note', 'Test reference',
  'source_note', 'pgTAP'
))->>'id')::uuid;

select is(
  (select status::text
   from public.questions
   where id = (select original_id from admin_question_fixture)),
  'draft',
  'an individually added question stays in draft'
);

select is(
  (public.admin_get_practice_set_validation((select set_id from admin_set_fixture))->>'ready')::boolean,
  false,
  'an incomplete set fails publication checks'
);

select throws_like(
  $$ select public.admin_transition_practice_set((select set_id from admin_set_fixture), 'review') $$,
  'Practice set is not ready:%',
  'an incomplete set cannot enter review'
);

select public.admin_save_question(jsonb_build_object(
  'id', (select original_id from admin_question_fixture),
  'practice_set_id', (select set_id from admin_set_fixture),
  'batch_position', 1,
  'difficulty', 'medium',
  'question_text', 'Which record should be checked first?',
  'option_a', 'The approved vote book',
  'option_b', 'An unrelated memo',
  'option_c', 'A blank form',
  'option_d', 'A personal note',
  'correct_option', 'A',
  'explanation', 'The approved vote book is the relevant control record.',
  'reference_note', 'Test reference',
  'source_note', 'pgTAP'
));

select is(
  (public.admin_import_questions(
    (select set_id from admin_set_fixture),
    '[
      {"batch_position":2,"question_text":"Who authorises the control?","option_a":"The designated officer","option_b":"A visitor","option_c":"A vendor","option_d":"No one","correct_option":"A","explanation":"The designated officer is responsible.","difficulty":"easy"}
    ]'::jsonb,
    'admin-test-questions.csv',
    repeat('a', 64)
  )->>'imported_count')::integer,
  1,
  'a valid bulk import is saved'
);

select ok(
  exists (
    select 1
    from public.admin_audit_logs
    where action = 'IMPORT'
      and entity_id = (select set_id from admin_set_fixture)
      and metadata->>'file_name' = 'admin-test-questions.csv'
      and metadata->>'file_checksum' = repeat('a', 64)
  ),
  'a bulk import records its file identity in the audit log'
);

select throws_ok(
  $$
    select public.admin_import_questions(
      (select set_id from admin_set_fixture),
      '[{"question_text":"A replayed file row","option_a":"A","option_b":"B","option_c":"C","option_d":"D","correct_option":"A"}]'::jsonb,
      'admin-test-questions.csv',
      repeat('a', 64)
    )
  $$,
  'P0001',
  'This file has already been imported into this practice set',
  'the same upload cannot be replayed into one practice set'
);

select is(
  (public.admin_get_practice_set_validation((select set_id from admin_set_fixture))->>'ready')::boolean,
  true,
  'a complete set passes publication checks'
);

select throws_ok(
  $$ select public.admin_transition_practice_set((select set_id from admin_set_fixture), 'published') $$,
  'P0001',
  'Send the practice set to review before publishing it',
  'a draft set cannot bypass review'
);

select public.admin_transition_practice_set((select set_id from admin_set_fixture), 'review');

select is(
  (select status::text
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))
   where practice_set_id = (select set_id from admin_set_fixture)),
  'review',
  'the set enters review'
);

select is(
  (select count(*)::integer
   from public.questions
   where practice_set_id = (select set_id from admin_set_fixture)
     and status = 'review'),
  2,
  'all draft questions enter review together'
);

select public.admin_transition_practice_set((select set_id from admin_set_fixture), 'published');

select is(
  (select status::text
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))
   where practice_set_id = (select set_id from admin_set_fixture)),
  'published',
  'the reviewed set publishes'
);

select is(
  (select count(*)::integer
   from public.questions
   where practice_set_id = (select set_id from admin_set_fixture)
     and status = 'published'),
  2,
  'publishing makes every reviewed question live'
);

select ok(
  (select lifecycle_status = 'active' and is_active and not available_for_purchase
   from public.get_admin_content_modules()
   where subject_id = (select module_id from admin_module_fixture)),
  'publishing activates content without silently enabling sales'
);

select is(
  (public.admin_update_module(
    (select module_id from admin_module_fixture),
    'Admin Test Module', 90, 175000, 'NGN', 2, 70, 'active', true
  )->>'updated')::boolean,
  true,
  'an administrator can explicitly enable sales after publication'
);

select ok(
  (select available_for_purchase
   from public.get_admin_content_modules()
   where subject_id = (select module_id from admin_module_fixture)),
  'the explicit sales setting is persisted'
);

select throws_like(
  $$
    select public.admin_update_module(
      (select module_id from admin_module_fixture),
      'Admin Test Module', 90, 175000, 'NGN', 2, 70, 'coming_soon', false
    )
  $$,
  'Archive every published practice set before changing this module to %',
  'a module with live content cannot be mislabeled as coming soon'
);

reset role;

insert into public.practice_sets (
  exam_pack_id, subject_id, set_number, expected_question_count, status
) values (
  'a0000000-0000-4000-8000-000000000002',
  (select module_id from admin_module_fixture),
  99,
  2,
  'draft'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))),
  1,
  'the module workspace shows practice sets from the active edition only'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  not has_table_privilege('authenticated', 'public.practice_sets', 'SELECT'),
  'candidate cannot read practice-set administration rows directly'
);

select is(
  (select count(*)::integer from public.questions),
  0,
  'candidate still cannot read the answer-key table'
);

reset role;

insert into public.attempts (
  id, user_id, exam_pack_id, mode, subject_id, completed_at, score, total_questions, batch_number
) values (
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  'timed_mock',
  (select module_id from admin_module_fixture),
  now(),
  1,
  2,
  1
);

insert into public.attempt_answers (
  id, attempt_id, user_id, question_id, selected_option, is_correct, display_order
) values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  (select original_id from admin_question_fixture),
  'A',
  true,
  1
);

insert into public.attempts (
  id, user_id, exam_pack_id, mode, subject_id, completed_at, score, total_questions, batch_number
) values (
  'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000001',
  'timed_mock',
  (select module_id from admin_module_fixture),
  now(),
  0,
  2,
  1
);

insert into public.attempt_answers (
  id, attempt_id, user_id, question_id, selected_option, is_correct, display_order
) values (
  'a3000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000002',
  (select original_id from admin_question_fixture),
  'B',
  false,
  1
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer from public.attempts),
  0,
  'admin cannot read candidate attempts through the candidate data policy'
);

select is(
  (select count(*)::integer from public.attempt_answers),
  0,
  'admin cannot read candidate answers through the candidate data policy'
);

select is(
  (select attempt_count::integer
   from public.get_admin_content_modules()
   where subject_id = (select module_id from admin_module_fixture)),
  2,
  'audited admin catalogue still receives aggregate attempt counts'
);

update admin_question_fixture
set revision_id = (public.admin_create_question_revision(jsonb_build_object(
  'id', original_id,
  'batch_position', 1,
  'difficulty', 'medium',
  'question_text', 'Which official record should be checked first?',
  'option_a', 'The approved vote book',
  'option_b', 'An unrelated memo',
  'option_c', 'A blank form',
  'option_d', 'A personal note',
  'correct_option', 'A',
  'explanation', 'The approved vote book is the relevant official control record.',
  'reference_note', 'Corrected test reference',
  'source_note', 'pgTAP correction'
))->>'id')::uuid;

select ok(
  (select original.status = 'published' and revision.status = 'review'
   from public.questions as original
   join admin_question_fixture as fixture on fixture.original_id = original.id
   join public.questions as revision on revision.id = fixture.revision_id),
  'a correction waits in review while the original stays live'
);

select is(
  (select active_question_count::integer
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))
   where practice_set_id = (select set_id from admin_set_fixture limit 1)),
  2,
  'a pending correction does not inflate the current question count'
);

select is(
  (select active_question_count::integer
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))
   where practice_set_id = (select set_id from admin_set_fixture limit 1)),
  2,
  'multiple attempts on one question do not inflate the current question count'
);

select is(
  (public.admin_get_practice_set_validation((select set_id from admin_set_fixture))->>'ready')::boolean,
  true,
  'a pending correction does not distort published-set readiness'
);

select public.admin_archive_question((select revision_id from admin_question_fixture));

select ok(
  exists (
    select 1 from public.admin_audit_logs
    where action = 'ARCHIVE'
      and entity_type = 'question'
      and entity_id = (select revision_id from admin_question_fixture)
  ),
  'discarding a correction is recorded in the audit log'
);

select throws_ok(
  $$ select public.admin_publish_question_revision((select revision_id from admin_question_fixture)) $$,
  'P0001',
  'Only a pending reviewed correction can be published',
  'a discarded correction cannot be published'
);

update admin_question_fixture
set revision_id = (public.admin_create_question_revision(jsonb_build_object(
  'id', original_id,
  'batch_position', 1,
  'difficulty', 'medium',
  'question_text', 'Which official record should be checked first?',
  'option_a', 'The approved vote book',
  'option_b', 'An unrelated memo',
  'option_c', 'A blank form',
  'option_d', 'A personal note',
  'correct_option', 'A',
  'explanation', 'The approved vote book is the relevant official control record.',
  'reference_note', 'Corrected test reference',
  'source_note', 'pgTAP correction'
))->>'id')::uuid;

select public.admin_publish_question_revision((select revision_id from admin_question_fixture));

select is(
  (select status::text
   from public.questions
   where id = (select original_id from admin_question_fixture)),
  'archived',
  'publishing a correction archives the previous version'
);

select is(
  (select status::text
   from public.questions
   where id = (select revision_id from admin_question_fixture)),
  'published',
  'publishing a correction makes the revision live'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select question_id
   from public.attempt_answers
   where id = 'a3000000-0000-4000-8000-000000000001'),
  (select original_id from admin_question_fixture),
  'historical attempt answers keep the original question version'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select public.admin_transition_practice_set((select set_id from admin_set_fixture), 'archived');

select ok(
  (select status = 'archived'
      and not exists (
        select 1 from public.questions q
        where q.practice_set_id = practice_sets_rpc.practice_set_id
          and q.status = 'published'
      )
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))
     as practice_sets_rpc
   where practice_sets_rpc.practice_set_id = (select set_id from admin_set_fixture)),
  'archiving removes the set from new practice without deleting it'
);

select ok(
  (select lifecycle_status = 'coming_soon' and is_active and not available_for_purchase
   from public.get_admin_content_modules()
   where subject_id = (select module_id from admin_module_fixture)),
  'archiving the final live set stops sales without deleting the module'
);

select throws_ok(
  $$ select public.admin_delete_empty_practice_set((select set_id from admin_set_fixture)) $$,
  'P0001',
  'Only an empty practice set can be permanently deleted',
  'a practice set with content cannot be permanently deleted'
);

select throws_ok(
  $$ select public.admin_delete_empty_module((select module_id from admin_module_fixture)) $$,
  'P0001',
  'Only an unused module can be permanently deleted',
  'a module with content and history cannot be permanently deleted'
);

insert into admin_set_fixture (set_id)
select (public.admin_create_practice_set(
  (select module_id from admin_module_fixture),
  2
)->>'id')::uuid;

insert into admin_delete_question_fixture (question_id)
select (public.admin_save_question(jsonb_build_object(
  'practice_set_id', (
    select practice_set_id
    from public.get_admin_practice_sets((select module_id from admin_module_fixture))
    where set_number = 2
  ),
  'batch_position', 1,
  'difficulty', 'medium',
  'question_text', 'Temporary unused draft question?',
  'option_a', 'First',
  'option_b', 'Second',
  'option_c', 'Third',
  'option_d', 'Fourth',
  'correct_option', 'A',
  'explanation', '',
  'reference_note', '',
  'source_note', 'pgTAP deletion test'
))->>'id')::uuid;

select ok(
  public.admin_delete_draft_question(
    (select question_id from admin_delete_question_fixture)
  ),
  'an unused draft question can be permanently deleted'
);

select ok(
  exists (
    select 1 from public.admin_audit_logs
    where action = 'DELETE'
      and entity_type = 'question'
      and entity_id = (select question_id from admin_delete_question_fixture)
  ),
  'permanent draft question deletion is recorded in the audit log'
);

select ok(
  public.admin_delete_empty_practice_set(
    (select practice_set_id
     from public.get_admin_practice_sets((select module_id from admin_module_fixture))
     where set_number = 2)
  ),
  'an unused empty draft set can be deleted'
);

select ok(
  exists (
    select 1 from public.admin_audit_logs
    where action = 'DELETE'
      and entity_type = 'practice_set'
      and metadata->>'set_number' = '2'
  ),
  'permanent empty set deletion is recorded in the audit log'
);

insert into admin_set_fixture (set_id)
select (public.admin_create_practice_set(
  (select module_id from admin_module_fixture),
  2
)->>'id')::uuid;

insert into admin_history_question_fixture (question_id)
select (public.admin_save_question(jsonb_build_object(
  'practice_set_id', (
    select practice_set_id
    from public.get_admin_practice_sets((select module_id from admin_module_fixture))
    where set_number = 2
  ),
  'batch_position', 1,
  'difficulty', 'medium',
  'question_text', 'Historical draft question to remove?',
  'option_a', 'First',
  'option_b', 'Second',
  'option_c', 'Third',
  'option_d', 'Fourth',
  'correct_option', 'A',
  'explanation', '',
  'reference_note', '',
  'source_note', 'pgTAP history preservation test'
))->>'id')::uuid;

reset role;

insert into public.attempt_answers (
  id, attempt_id, user_id, question_id, selected_option, is_correct, display_order
) values (
  'a3000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  (select question_id from admin_history_question_fixture),
  'A',
  true,
  2
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  public.admin_delete_draft_question(
    (select question_id from admin_history_question_fixture)
  ),
  'a historical draft question can be removed safely'
);

select is(
  (select status::text
   from public.questions
   where id = (select question_id from admin_history_question_fixture)),
  'archived',
  'removing a historical question archives it instead of deleting it'
);

select is(
  (select status::text
   from public.get_admin_practice_sets((select module_id from admin_module_fixture))
   where set_number = 2),
  'draft',
  'removing the last historical question leaves its practice set editable'
);

select ok(
  exists (
    select 1
    from public.admin_audit_logs
    where action = 'ARCHIVE'
      and entity_type = 'question'
      and entity_id = (select question_id from admin_history_question_fixture)
      and metadata->>'reason' = 'historical_attempt_or_revision'
  ),
  'history-preserving removal is recorded clearly in the audit log'
);

select ok(
  (select count(*) > 0
   from public.admin_audit_logs
   where actor_id = 'a1000000-0000-4000-8000-000000000001'),
  'admin content changes are recorded in the audit log'
);

select * from finish();
rollback;
