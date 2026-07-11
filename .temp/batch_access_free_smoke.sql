begin;

delete from public.profiles where id = '11111111-1111-1111-1111-111111111111'::uuid;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111'::uuid;

insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at, email_confirmed_at
) values (
  '11111111-1111-1111-1111-111111111111',
  'free-local@example.com',
  'authenticated',
  'authenticated',
  '{}'::jsonb,
  '{"full_name":"Free Local"}'::jsonb,
  false,
  false,
  now(),
  now(),
  now()
);

update public.profiles
set service_level = 'GL 13',
    phone_number = '08000000000',
    state_code = 'FCT',
    organization_name = 'Test Ministry',
    onboarding_completed_at = now(),
    full_name = 'Free Local'
where id = '11111111-1111-1111-1111-111111111111'::uuid;

update public.questions as q
set status = 'published'
where q.subject_id = '2d1ae7a8-704e-43d6-af9b-6b0f69ed03bb'::uuid
  and q.batch_number = 1
  and q.status = 'draft';

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 'free_psr_batch1' as check_name, state, reason_code, can_start, published_question_count, message
from public.get_batch_access_state('public-service-rules', 1);

select 'free_ca_batch1' as check_name, state, reason_code, can_start, published_question_count, message
from public.get_batch_access_state('current-affairs', 1);

select 'free_module_list' as check_name, batch_number, state, reason_code, can_start, is_recommended
from public.get_module_batch_access('public-service-rules');

rollback;
