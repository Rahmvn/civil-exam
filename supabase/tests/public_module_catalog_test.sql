begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

do $$
declare
  target_pack_id uuid;
  target_subject_id uuid;
  target_set_id uuid;
begin
  select id into target_pack_id
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  insert into public.subjects (
    name,
    slug,
    description,
    sort_order,
    is_active,
    lifecycle_status,
    candidate_availability,
    practice_type
  ) values (
    'Public catalogue fixture',
    'public-catalogue-fixture',
    'Transactional public catalogue test module.',
    999,
    true,
    'active',
    'available',
    'objective'
  )
  returning id into target_subject_id;

  insert into public.practice_sets (
    exam_pack_id,
    subject_id,
    set_number,
    expected_question_count,
    status,
    published_at,
    practice_type
  ) values (
    target_pack_id,
    target_subject_id,
    1,
    1,
    'published',
    now(),
    'objective'
  )
  returning id into target_set_id;

  insert into public.questions (
    exam_pack_id,
    subject_id,
    practice_set_id,
    question_text,
    option_a,
    option_b,
    option_c,
    option_d,
    correct_option,
    explanation,
    status,
    batch_number,
    batch_position
  ) values (
    target_pack_id,
    target_subject_id,
    target_set_id,
    'Which option verifies the public catalogue fixture?',
    'The published option',
    'A draft option',
    'A retired option',
    'An inactive option',
    'A',
    'Published content makes an active module publicly available.',
    'published',
    1,
    1
  );
end;
$$;

select ok(
  exists (
    select 1
    from public.get_public_module_catalog()
    where slug = 'public-catalogue-fixture'
      and availability_status = 'available'
  ),
  'an active module with a published set is publicly listed as available'
);

update public.subjects
set candidate_availability = 'coming_soon'
where slug = 'public-catalogue-fixture';

select ok(
  exists (
    select 1
    from public.get_public_module_catalog()
    where slug = 'public-catalogue-fixture'
      and availability_status = 'coming_soon'
  ),
  'candidate coming-soon state is publicly listed accurately'
);

update public.subjects
set candidate_availability = 'paused'
where slug = 'public-catalogue-fixture';

select ok(
  exists (
    select 1
    from public.get_public_module_catalog()
    where slug = 'public-catalogue-fixture'
      and availability_status = 'paused'
  ),
  'candidate paused state is never advertised as available'
);

update public.subjects
set candidate_availability = 'hidden', is_active = false
where slug = 'public-catalogue-fixture';

select is(
  (select count(*)::integer from public.get_public_module_catalog() where slug = 'public-catalogue-fixture'),
  0,
  'candidate hidden state removes the module from the public catalogue'
);

select is(
  (
    select count(*)::integer
    from public.get_public_module_catalog() as catalog
    join public.subjects as subject on subject.slug = catalog.slug
    where subject.lifecycle_status in ('draft', 'retired')
       or subject.is_active = false
  ),
  0,
  'draft, retired, and inactive modules remain hidden'
);

select is(
  (
    select count(*)::integer
    from public.get_public_module_catalog()
    where availability_status not in ('available', 'coming_soon', 'paused')
  ),
  0,
  'the public catalogue returns only supported availability states'
);

select ok(
  has_function_privilege('anon', 'public.get_public_module_catalog()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_public_module_catalog()', 'EXECUTE'),
  'public and signed-in visitors can read the sanitized module catalogue'
);

select * from finish();
rollback;
