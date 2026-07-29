begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'launch-offer-candidate@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Launch Offer Candidate"}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'launch-offer-admin@example.test', crypt('LocalTestOnly!2026', gen_salt('bf')), now(),
    '', '', '', '', '{"provider":"email","providers":["email"]}',
    '{"full_name":"Launch Offer Admin"}', now(), now()
  );

update public.profiles
set role = 'admin'
where id = 'f1000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.get_admin_launch_offer() $$,
  'P0001',
  'Admin access is required',
  'candidates cannot read launch offer controls'
);

select throws_ok(
  $$ select public.admin_configure_launch_offer('[]'::jsonb, now(), now() + interval '1 day') $$,
  'P0001',
  'Admin access is required',
  'candidates cannot configure the launch offer'
);

select throws_ok(
  $$ select * from public.launch_offers $$,
  '42501',
  null,
  'authenticated clients cannot read the launch offer table directly'
);

reset role;

insert into public.subjects (
  id,
  name,
  slug,
  description,
  sort_order,
  is_active,
  batch_size,
  pass_mark_percent,
  lifecycle_status,
  candidate_availability,
  practice_type
) values
  (
    'f2000000-0000-4000-8000-000000000001',
    'Launch Offer Objective Fixture',
    'launch-offer-objective-fixture',
    'Launch offer pricing test objective module',
    991,
    true,
    20,
    70,
    'active',
    'available',
    'objective'
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'Launch Offer Oral Fixture',
    'launch-offer-oral-fixture',
    'Launch offer pricing test oral module',
    992,
    true,
    5,
    70,
    'active',
    'available',
    'oral'
  )
on conflict (id) do update
set lifecycle_status = 'active',
    candidate_availability = 'available',
    is_active = true;

update public.module_offerings
set is_active = false
where subject_id not in (
  'f2000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002'
);

insert into public.module_offerings (
  exam_pack_id,
  subject_id,
  price_kobo,
  currency,
  is_active
)
select
  ep.id,
  fixture.subject_id,
  fixture.price_kobo,
  'NGN',
  true
from (
  values
    ('f2000000-0000-4000-8000-000000000001'::uuid, 1000000),
    ('f2000000-0000-4000-8000-000000000002'::uuid, 1200000)
) as fixture(subject_id, price_kobo)
cross join lateral (
  select id
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1
) ep
on conflict (exam_pack_id, subject_id) do update
set price_kobo = excluded.price_kobo,
    currency = excluded.currency,
    is_active = true;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);

select is(
  (select status from public.get_admin_launch_offer()),
  'not_configured',
  'the launch offer is disabled by default'
);

select throws_ok(
  $$
    select public.admin_configure_launch_offer(
      jsonb_build_array(
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000001', 'discounted_price_kobo', 700000),
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000002', 'discounted_price_kobo', 900000)
      ),
      now() + interval '10 minutes',
      now() + interval '7 days 11 minutes'
    )
  $$,
  'P0001',
  'The one-time launch offer cannot run for more than seven days',
  'an offer cannot exceed seven days'
);

select throws_ok(
  $$
    select public.admin_configure_launch_offer(
      jsonb_build_array(
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000001', 'discounted_price_kobo', 1000000),
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000002', 'discounted_price_kobo', 1200000)
      ),
      now() + interval '10 minutes',
      now() + interval '1 day'
    )
  $$,
  'P0001',
  'Each launch price must be lower than that module regular price',
  'each module launch price must be a genuine discount'
);

select lives_ok(
  $$
    select public.admin_configure_launch_offer(
      jsonb_build_array(
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000001', 'discounted_price_kobo', 700000),
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000002', 'discounted_price_kobo', 900000)
      ),
      now() + interval '10 minutes',
      now() + interval '6 days'
    )
  $$,
  'an admin can schedule the one-time offer'
);

select is(
  (select status from public.get_admin_launch_offer()),
  'scheduled',
  'the admin view reports the scheduled state'
);

select is(
  (select count(*)::integer from public.get_public_launch_offer()),
  0,
  'a scheduled offer is not advertised before it starts'
);

select lives_ok(
  $$
    select public.admin_configure_launch_offer(
      jsonb_build_array(
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000001', 'discounted_price_kobo', 700000),
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000002', 'discounted_price_kobo', 900000)
      ),
      now() - interval '1 minute',
      now() + interval '6 days'
    )
  $$,
  'an admin can make a scheduled offer live'
);

reset role;

select throws_ok(
  $$
    update public.module_offerings
    set price_kobo = (
      select lop.discounted_price_kobo
      from public.launch_offers lo
      join public.launch_offer_module_prices lop on lop.launch_offer_id = lo.id
      where lo.singleton_key = 'launch'
        and lop.subject_id = module_offerings.subject_id
      limit 1
    )
    where id = (
      select mo.id
      from public.module_offerings mo
      join public.exam_packs ep on ep.id = mo.exam_pack_id
      join public.subjects s on s.id = mo.subject_id
      where ep.is_active = true
        and mo.is_active = true
        and mo.currency = 'NGN'
        and s.is_active = true
        and s.lifecycle_status = 'active'
      limit 1
    )
  $$,
  'P0001',
  'An active module regular price must remain above its configured launch price',
  'regular module prices cannot invalidate a scheduled or live discount'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select ok(
  exists (
    select 1
    from public.get_module_access_catalog_v2()
    where launch_offer_active = true
      and regular_price_kobo > price_kobo
  ),
  'candidate pricing shows the server-computed launch price and regular price'
);

select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
select public.admin_end_launch_offer();

select throws_ok(
  $$
    select public.admin_configure_launch_offer(
      jsonb_build_array(
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000001', 'discounted_price_kobo', 700000),
        jsonb_build_object('subject_id', 'f2000000-0000-4000-8000-000000000002', 'discounted_price_kobo', 900000)
      ),
      now() + interval '1 day',
      now() + interval '2 days'
    )
  $$,
  'P0001',
  'The one-time launch offer has already started and cannot be rescheduled',
  'an offer cannot be restarted after it has begun'
);

select * from finish();
rollback;
