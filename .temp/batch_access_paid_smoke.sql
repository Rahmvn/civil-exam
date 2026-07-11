begin;

delete from public.profiles where id = '22222222-2222-2222-2222-222222222222'::uuid;
delete from auth.users where id = '22222222-2222-2222-2222-222222222222'::uuid;

insert into auth.users (
  id, email, aud, role, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at, email_confirmed_at
) values (
  '22222222-2222-2222-2222-222222222222',
  'paid-local@example.com',
  'authenticated',
  'authenticated',
  '{}'::jsonb,
  '{"full_name":"Paid Local"}'::jsonb,
  false,
  false,
  now(),
  now(),
  now()
);

update public.profiles
set service_level = 'GL 14',
    phone_number = '08000000001',
    state_code = 'Lagos',
    organization_name = 'Test Agency',
    onboarding_completed_at = now(),
    full_name = 'Paid Local'
where id = '22222222-2222-2222-2222-222222222222'::uuid;

update public.questions as q
set status = 'published'
where q.subject_id = '2d1ae7a8-704e-43d6-af9b-6b0f69ed03bb'::uuid
  and q.batch_number = 1
  and q.status = 'draft';

insert into public.entitlements (
  user_id,
  exam_pack_id,
  paystack_reference,
  status,
  amount_kobo,
  currency,
  expires_at,
  metadata
)
select
  '22222222-2222-2222-2222-222222222222'::uuid,
  ep.id,
  'local-smoke-paid',
  'active',
  ep.price_kobo,
  'NGN',
  now() + interval '30 days',
  '{}'::jsonb
from public.exam_packs ep
where ep.is_active = true
limit 1;

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 'paid_psr_batch1' as check_name, state, reason_code, can_start, published_question_count, message
from public.get_batch_access_state('public-service-rules', 1);

select 'paid_psr_batch2' as check_name, state, reason_code, can_start, published_question_count, message
from public.get_batch_access_state('public-service-rules', 2);

select 'paid_module_list' as check_name, batch_number, state, reason_code, can_start, is_recommended
from public.get_module_batch_access('public-service-rules');

rollback;
