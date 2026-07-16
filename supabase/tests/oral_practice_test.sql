begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(40);

update public.exam_packs set is_active = false;

insert into public.exam_packs (
  id, slug, name, description, price_kobo, currency, trial_question_limit,
  active_from, active_until, is_active
) values (
  'b0000000-0000-4000-8000-000000000001',
  'oral-practice-test-pack',
  'Oral Practice Test Pack',
  'Transactional oral practice fixture',
  250000,
  'NGN',
  20,
  current_date - 1,
  current_date + 365,
  true
);

insert into public.subjects (
  id, name, slug, description, sort_order, is_active, batch_size,
  pass_mark_percent, lifecycle_status, practice_type
) values
  (
    'b1000000-0000-4000-8000-000000000001',
    'Oral Questions Test',
    'oral-questions-test',
    'Oral answer rehearsal',
    1,
    true,
    3,
    70,
    'active',
    'oral'
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'Objective Control Test',
    'objective-control-test',
    'Objective regression fixture',
    2,
    true,
    1,
    70,
    'active',
    'objective'
  );

insert into public.practice_sets (
  id, exam_pack_id, subject_id, set_number, expected_question_count,
  status, published_at, practice_type
) values
  (
    'b2000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    1,
    3,
    'published',
    now(),
    'oral'
  ),
  (
    'b2000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    2,
    1,
    'published',
    now(),
    'oral'
  );

insert into public.oral_questions (
  id, exam_pack_id, subject_id, practice_set_id, difficulty, question_text,
  model_answer, key_points, reference_note, source_note, status, batch_position
) values
  (
    'b3000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'medium',
    'Explain the purpose of a vote book.',
    'A vote book records commitments and expenditure against an approved vote.',
    array['Tracks commitments', 'Prevents overspending'],
    'Financial Regulations section 1',
    'pgtap oral fixture',
    'published',
    1
  ),
  (
    'b3000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'medium',
    'Describe one safeguard for public funds.',
    'Segregation of duties prevents one officer from controlling every stage.',
    array['Segregation of duties', 'Independent checks'],
    'Financial Regulations section 2',
    'pgtap oral fixture',
    'published',
    2
  ),
  (
    'b3000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'medium',
    'Explain why reconciliation is important.',
    'Reconciliation identifies differences and supports accurate financial records.',
    array['Finds differences', 'Supports accurate records'],
    'Financial Regulations section 3',
    'pgtap oral fixture',
    'published',
    3
  ),
  (
    'b3000000-0000-4000-8000-000000000004',
    'b0000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002',
    'medium',
    'Describe accountability in public service.',
    'Accountability means being answerable for decisions, actions, and public resources.',
    array['Answerable for decisions', 'Responsible for resources'],
    'Public Service Rules',
    'pgtap oral fixture',
    'published',
    1
  );

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'b4000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'oral-paid@example.test',
    crypt('LocalTestOnly!2026', gen_salt('bf')),
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Oral Paid Candidate"}',
    now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b4000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'oral-other@example.test',
    crypt('LocalTestOnly!2026', gen_salt('bf')),
    now(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Oral Other Candidate"}',
    now(), now()
  );

insert into public.module_entitlements (
  user_id, exam_pack_id, subject_id, status, starts_at, expires_at, metadata
) values (
  'b4000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'active',
  now(),
  now() + interval '1 year',
  '{"source":"pgtap"}'::jsonb
);

select is(
  (select practice_type::text from public.subjects where id = 'b1000000-0000-4000-8000-000000000002'),
  'objective',
  'existing-style modules remain objective by default'
);

select throws_ok(
  $$
    insert into public.oral_questions (
      exam_pack_id, subject_id, practice_set_id, question_text, model_answer,
      key_points, status, batch_position
    ) values (
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000002',
      'b2000000-0000-4000-8000-000000000001',
      'Mismatched context', 'Hidden answer', array['Point'], 'published', 9
    )
  $$,
  'P0001',
  'The oral question must belong to an oral set in the same module and exam pack',
  'oral questions cannot be attached across module types'
);

select throws_ok(
  $$
    insert into public.oral_questions (
      exam_pack_id, subject_id, practice_set_id, question_text, model_answer,
      key_points, status, batch_position
    ) values (
      'b0000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',
      'b2000000-0000-4000-8000-000000000001',
      'Missing review material', '', '{}'::text[], 'published', 9
    )
  $$,
  '23514',
  null,
  'published oral questions require a model answer and key points'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.start_or_resume_oral_attempt(text,integer,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot start oral practice'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_oral_attempt_review(uuid)',
    'EXECUTE'
  ),
  'anonymous clients cannot read oral reviews'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer from public.oral_questions),
  0,
  'candidate direct table reads cannot see oral questions or model answers'
);

select ok(
  not has_table_privilege('authenticated', 'public.oral_attempts', 'SELECT'),
  'candidate direct table reads cannot bypass the oral attempt API'
);

select set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000002', true);

select ok(
  (
    select can_start and state = 'available' and reason_code = 'free_batch_available'
    from public.get_oral_practice_set_access('oral-questions-test')
    where batch_number = 1
  ),
  'new unpaid candidate can choose oral set 1 as free practice'
);

select ok(
  (
    select not can_start and state = 'locked_requires_payment' and reason_code = 'requires_payment'
    from public.get_oral_practice_set_access('oral-questions-test')
    where batch_number = 2
  ),
  'new unpaid candidate cannot start later oral sets without module access'
);

select is(
  (
    select message
    from public.get_oral_practice_set_access('oral-questions-test')
    where batch_number = 1
  ),
  'Choose this module for your free oral practice.',
  'oral catalogue explains the free choice path'
);

select set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::integer from public.get_oral_practice_set_access('oral-questions-test')),
  2,
  'oral catalogue returns both published practice sets'
);

select ok(
  (select bool_and(practice_type = 'oral' and is_paid and published_question_count > 0)
   from public.get_oral_practice_set_access('oral-questions-test')),
  'oral catalogue reports type, paid access, and published content'
);

select throws_ok(
  $$ select public.start_or_resume_oral_attempt('oral-questions-test', 1, 240) $$,
  'P0001',
  'Choose either 3 or 5 minutes per question',
  'only the supported three- and five-minute choices are accepted'
);

create temporary table oral_attempt_fixture (
  attempt_id uuid not null,
  first_question_id uuid not null,
  second_question_id uuid,
  third_question_id uuid
);
grant all on oral_attempt_fixture to authenticated;

insert into oral_attempt_fixture (attempt_id, first_question_id)
select
  (payload->>'attempt_id')::uuid,
  (payload->'current_question'->>'id')::uuid
from (
  select public.start_or_resume_oral_attempt('oral-questions-test', 1, 180) as payload
) as started;

select is(
  (select (public.get_oral_attempt_state(attempt_id)->>'current_position')::integer from oral_attempt_fixture),
  1,
  'a new oral attempt starts on the first question'
);

select is(
  (select (public.get_oral_attempt_state(attempt_id)->>'seconds_per_question')::integer from oral_attempt_fixture),
  180,
  'the chosen duration is stored by the server'
);

select ok(
  (select public.get_oral_attempt_state(attempt_id)::text not like '%vote book records commitments%' from oral_attempt_fixture),
  'active attempt payload does not expose the model answer'
);

select ok(
  (select public.get_oral_attempt_state(attempt_id)::text not like '%Tracks commitments%' from oral_attempt_fixture),
  'active attempt payload does not expose key points'
);

select is(
  (
    select (public.start_or_resume_oral_attempt('oral-questions-test', 1, 300)->>'attempt_id')::uuid
  ),
  (select attempt_id from oral_attempt_fixture),
  'starting the same active set resumes instead of duplicating it'
);

select is(
  (
    select (public.start_or_resume_oral_attempt('oral-questions-test', 1, 300)->>'seconds_per_question')::integer
  ),
  180,
  'resuming cannot silently change the attempt duration'
);

select is(
  (
    select (public.start_or_resume_oral_attempt('oral-questions-test', 2, 300)->>'attempt_id')::uuid
  ),
  (select attempt_id from oral_attempt_fixture),
  'starting a different oral set resumes the current active attempt'
);

select is(
  (
    select (public.start_or_resume_oral_attempt('oral-questions-test', 2, 300)->>'set_number')::integer
  ),
  1,
  'resuming from another set keeps the candidate in the active set'
);

select lives_ok(
  $$
    select public.save_oral_response_draft(
      (select attempt_id from oral_attempt_fixture),
      (select first_question_id from oral_attempt_fixture),
      'It controls commitments and expenditure.'
    )
  $$,
  'the current response can be autosaved before its deadline'
);

select is(
  (
    select public.advance_oral_attempt(
      attempt_id,
      first_question_id,
      'It controls commitments and expenditure.',
      'manual'
    )->>'current_position'
    from oral_attempt_fixture
  )::integer,
  2,
  'manual continue locks the first answer and moves forward once'
);

update oral_attempt_fixture as fixture
set second_question_id = (
  select (public.get_oral_attempt_state(fixture.attempt_id)->'current_question'->>'id')::uuid
);

select is(
  (
    select public.advance_oral_attempt(
      attempt_id,
      first_question_id,
      'A duplicate browser request.',
      'manual'
    )->>'current_position'
    from oral_attempt_fixture
  )::integer,
  2,
  'a repeated continue request is idempotent and cannot skip a question'
);

select ok(
  not has_table_privilege('authenticated', 'public.oral_responses', 'SELECT'),
  'candidate direct reads cannot inspect active response snapshots'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ select public.get_oral_attempt_state((select attempt_id from oral_attempt_fixture)) $$,
  'P0001',
  'Oral practice attempt was not found',
  'another candidate cannot read an active oral attempt'
);

select throws_ok(
  $$ select count(*) from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture)) $$,
  'P0001',
  'Oral practice attempt was not found',
  'another candidate cannot read an oral review'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ select count(*) from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture)) $$,
  'P0001',
  'Finish the oral practice before reviewing model answers',
  'model answers remain unavailable until the full attempt is complete'
);

reset role;
update public.oral_responses
set deadline_at = clock_timestamp() - interval '1 second'
where attempt_id = (select attempt_id from oral_attempt_fixture)
  and display_order = 2;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b4000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (
    select (public.advance_oral_attempt(
      attempt_id,
      second_question_id,
      'This text arrived after the deadline.',
      'manual'
    )->>'current_position')::integer
    from oral_attempt_fixture
  ),
  3,
  'an expired question locks and starts the next question'
);

update oral_attempt_fixture as fixture
set third_question_id = (
  select (public.get_oral_attempt_state(fixture.attempt_id)->'current_question'->>'id')::uuid
);

select is(
  (
    select public.advance_oral_attempt(
      attempt_id,
      third_question_id,
      'Reconciliation finds differences.',
      'manual'
    )->>'status'
    from oral_attempt_fixture
  ),
  'completed',
  'locking the final response completes the oral attempt'
);

select ok(
  not has_table_privilege('authenticated', 'public.oral_responses', 'SELECT'),
  'candidate direct reads still cannot inspect completed response rows'
);

select is(
  (select count(*)::integer from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture))),
  3,
  'completed review returns every response in the set'
);

select is(
  (
    select response_text
    from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture))
    where display_order = 2
  ),
  '',
  'text submitted after the deadline cannot replace the last autosave'
);

select is(
  (
    select model_answer
    from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture))
    where display_order = 1
  ),
  'A vote book records commitments and expenditure against an approved vote.',
  'completed review reveals the model answer'
);

select is(
  (
    select key_points
    from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture))
    where display_order = 1
  )::text,
  array['Tracks commitments', 'Prevents overspending']::text[]::text,
  'completed review reveals the comparison key points'
);

select is(
  public.save_oral_self_rating(
    (
      select response_id
      from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture))
      where display_order = 1
    ),
    'partly_covered'
  ),
  'partly_covered',
  'candidate can save a reflection rating after completion'
);

select is(
  (
    select self_rating
    from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture))
    where display_order = 1
  ),
  'partly_covered',
  'saved reflection rating is durable'
);

select lives_ok(
  $$
    select public.save_oral_response_draft(
      (select attempt_id from oral_attempt_fixture),
      (select first_question_id from oral_attempt_fixture),
      'Changed after completion'
    )
  $$,
  'late autosave is handled idempotently after completion'
);

select is(
  (
    select response_text
    from public.get_oral_attempt_review((select attempt_id from oral_attempt_fixture))
    where display_order = 1
  ),
  'It controls commitments and expenditure.',
  'a locked answer cannot be changed by a late autosave'
);

select lives_ok(
  $$ select public.start_or_resume_oral_attempt('oral-questions-test', 1, 180) $$,
  'paid candidate can begin a fresh rehearsal after completion'
);

select * from finish();
rollback;
