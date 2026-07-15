-- Safe, admin-only content management for modules, practice sets, and questions.
-- Candidate APIs continue to use questions.batch_number and published question rows.

do $$
begin
  create type public.module_lifecycle_status as enum (
    'draft',
    'coming_soon',
    'active',
    'retired'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.practice_set_status as enum (
    'draft',
    'review',
    'published',
    'archived'
  );
exception
  when duplicate_object then null;
end $$;

alter table public.subjects
  add column if not exists lifecycle_status public.module_lifecycle_status,
  add column if not exists updated_at timestamptz not null default now();

update public.subjects as s
set lifecycle_status = case
  when s.is_active and exists (
    select 1
    from public.questions as q
    where q.subject_id = s.id
      and q.status = 'published'
  ) then 'active'::public.module_lifecycle_status
  when s.is_active then 'coming_soon'::public.module_lifecycle_status
  else 'retired'::public.module_lifecycle_status
end
where s.lifecycle_status is null;

alter table public.subjects
  alter column lifecycle_status set default 'draft',
  alter column lifecycle_status set not null;

drop trigger if exists subjects_touch_updated_at on public.subjects;
create trigger subjects_touch_updated_at
before update on public.subjects
for each row execute function public.touch_updated_at();

create table if not exists public.practice_sets (
  id uuid primary key default gen_random_uuid(),
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  set_number integer not null check (set_number > 0),
  expected_question_count integer not null check (expected_question_count > 0 and expected_question_count <= 200),
  status public.practice_set_status not null default 'draft',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_pack_id, subject_id, set_number)
);

create trigger practice_sets_touch_updated_at
before update on public.practice_sets
for each row execute function public.touch_updated_at();

insert into public.practice_sets (
  exam_pack_id,
  subject_id,
  set_number,
  expected_question_count,
  status,
  published_at,
  archived_at
)
select
  q.exam_pack_id,
  q.subject_id,
  q.batch_number,
  greatest(coalesce(s.batch_size, count(*)::integer), 1),
  case
    when bool_or(q.status = 'published') then 'published'::public.practice_set_status
    when bool_or(q.status = 'review') then 'review'::public.practice_set_status
    when bool_or(q.status = 'draft') then 'draft'::public.practice_set_status
    else 'archived'::public.practice_set_status
  end,
  case when bool_or(q.status = 'published') then now() else null end,
  case when bool_and(q.status = 'archived') then now() else null end
from public.questions as q
join public.subjects as s on s.id = q.subject_id
group by q.exam_pack_id, q.subject_id, q.batch_number, s.batch_size
on conflict (exam_pack_id, subject_id, set_number) do nothing;

alter table public.questions
  add column if not exists practice_set_id uuid references public.practice_sets(id) on delete restrict,
  add column if not exists supersedes_question_id uuid references public.questions(id) on delete restrict,
  add column if not exists revision_number integer not null default 1 check (revision_number > 0);

update public.questions as q
set practice_set_id = ps.id
from public.practice_sets as ps
where q.practice_set_id is null
  and ps.exam_pack_id = q.exam_pack_id
  and ps.subject_id = q.subject_id
  and ps.set_number = q.batch_number;

create index if not exists practice_sets_subject_number_idx
  on public.practice_sets (subject_id, set_number);

create index if not exists questions_practice_set_status_idx
  on public.questions (practice_set_id, status, batch_position);

create index if not exists questions_supersedes_idx
  on public.questions (supersedes_question_id)
  where supersedes_question_id is not null;

create or replace function public.assign_question_practice_set()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_set_id uuid;
  initial_set_status public.practice_set_status;
  expected_count integer;
begin
  if new.practice_set_id is not null
     and tg_op = 'UPDATE'
     and new.exam_pack_id is not distinct from old.exam_pack_id
     and new.subject_id is not distinct from old.subject_id
     and new.batch_number is not distinct from old.batch_number then
    return new;
  end if;

  initial_set_status := case new.status
    when 'published' then 'published'::public.practice_set_status
    when 'review' then 'review'::public.practice_set_status
    when 'archived' then 'archived'::public.practice_set_status
    else 'draft'::public.practice_set_status
  end;

  select greatest(coalesce(s.batch_size, 1), 1)
  into expected_count
  from public.subjects as s
  where s.id = new.subject_id;

  insert into public.practice_sets (
    exam_pack_id,
    subject_id,
    set_number,
    expected_question_count,
    status,
    created_by,
    updated_by,
    published_at,
    archived_at
  )
  values (
    new.exam_pack_id,
    new.subject_id,
    new.batch_number,
    expected_count,
    initial_set_status,
    auth.uid(),
    auth.uid(),
    case when initial_set_status = 'published' then now() else null end,
    case when initial_set_status = 'archived' then now() else null end
  )
  on conflict (exam_pack_id, subject_id, set_number) do update
  set status = case
        when excluded.status = 'published' then 'published'::public.practice_set_status
        when practice_sets.status = 'published' then practice_sets.status
        when excluded.status = 'review' then 'review'::public.practice_set_status
        when practice_sets.status = 'review' then practice_sets.status
        when excluded.status = 'draft' then 'draft'::public.practice_set_status
        else practice_sets.status
      end,
      published_at = case
        when excluded.status = 'published' then coalesce(practice_sets.published_at, now())
        else practice_sets.published_at
      end,
      updated_by = coalesce(auth.uid(), practice_sets.updated_by)
  returning id into resolved_set_id;

  new.practice_set_id := resolved_set_id;
  return new;
end;
$$;

drop trigger if exists questions_assign_practice_set on public.questions;
create trigger questions_assign_practice_set
before insert or update of exam_pack_id, subject_id, batch_number, practice_set_id, status
on public.questions
for each row execute function public.assign_question_practice_set();

alter table public.questions
  alter column practice_set_id set not null;

create or replace function public.sync_practice_set_status_from_questions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set_id uuid := coalesce(new.practice_set_id, old.practice_set_id);
  next_status public.practice_set_status;
begin
  if target_set_id is null then
    return coalesce(new, old);
  end if;

  select case
    when bool_or(q.status = 'published') then 'published'::public.practice_set_status
    when bool_or(q.status = 'review') then 'review'::public.practice_set_status
    when bool_or(q.status = 'draft') then 'draft'::public.practice_set_status
    when count(*) > 0 then 'archived'::public.practice_set_status
    else null
  end
  into next_status
  from public.questions as q
  where q.practice_set_id = target_set_id;

  if next_status is not null then
    update public.practice_sets
    set status = next_status,
        published_at = case
          when next_status = 'published' then coalesce(published_at, now())
          else published_at
        end,
        archived_at = case
          when next_status = 'archived' then coalesce(archived_at, now())
          else null
        end
    where id = target_set_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists questions_sync_practice_set_status on public.questions;
create trigger questions_sync_practice_set_status
after insert or update of status or delete on public.questions
for each row execute function public.sync_practice_set_status_from_questions();

alter table public.practice_sets enable row level security;

drop policy if exists "practice_sets_admin_only" on public.practice_sets;
create policy "practice_sets_admin_only"
on public.practice_sets for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.admin_assert_access()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access is required';
  end if;
end;
$$;

revoke all on function public.admin_assert_access() from public, anon, authenticated;

create or replace function public.admin_write_audit(
  requested_action text,
  requested_entity_type text,
  requested_entity_id uuid,
  requested_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_access();

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    requested_action,
    requested_entity_type,
    requested_entity_id,
    coalesce(requested_metadata, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_write_audit(text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.get_admin_content_modules()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  sort_order integer,
  lifecycle_status public.module_lifecycle_status,
  is_active boolean,
  batch_size integer,
  pass_mark_percent integer,
  offering_id uuid,
  price_kobo integer,
  currency text,
  available_for_purchase boolean,
  practice_set_count bigint,
  published_set_count bigint,
  question_count bigint,
  attempt_count bigint,
  payment_count bigint,
  active_entitlement_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_access();

  return query
  with active_pack as (
    select ep.id
    from public.exam_packs as ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  )
  select
    s.id,
    s.name,
    s.slug,
    s.sort_order,
    s.lifecycle_status,
    s.is_active,
    s.batch_size,
    s.pass_mark_percent,
    mo.id,
    mo.price_kobo,
    coalesce(mo.currency, 'NGN'),
    coalesce(mo.is_active, false),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id and ps.status = 'published'),
    (select count(*) from public.questions q where q.subject_id = s.id and q.exam_pack_id = ap.id),
    (select count(*) from public.attempts a where a.subject_id = s.id and a.exam_pack_id = ap.id),
    (select count(*) from public.payment_orders po where po.subject_id = s.id and po.exam_pack_id = ap.id),
    (
      select count(*)
      from public.module_entitlements me
      where me.subject_id = s.id
        and me.exam_pack_id = ap.id
        and me.status = 'active'
        and me.expires_at > now()
    )
    +
    (
      select count(*)
      from public.entitlements e
      where e.exam_pack_id = ap.id
        and e.status = 'active'
        and e.expires_at > now()
    )
  from public.subjects as s
  cross join active_pack as ap
  left join public.module_offerings as mo
    on mo.subject_id = s.id
   and mo.exam_pack_id = ap.id
  order by s.sort_order, s.name;
end;
$$;

create or replace function public.get_admin_practice_sets(requested_subject_id uuid)
returns table (
  practice_set_id uuid,
  set_number integer,
  status public.practice_set_status,
  expected_question_count integer,
  active_question_count bigint,
  draft_count bigint,
  review_count bigint,
  published_count bigint,
  archived_count bigint,
  attempted_question_count bigint,
  published_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_assert_access();

  return query
  select
    ps.id,
    ps.set_number,
    ps.status,
    ps.expected_question_count,
    count(q.id) filter (
      where q.status <> 'archived'
        and (q.supersedes_question_id is null or q.status = 'published')
    ),
    count(q.id) filter (where q.status = 'draft'),
    count(q.id) filter (where q.status = 'review'),
    count(q.id) filter (where q.status = 'published'),
    count(q.id) filter (where q.status = 'archived'),
    count(distinct aa.question_id),
    ps.published_at,
    ps.updated_at
  from public.practice_sets as ps
  left join public.questions as q on q.practice_set_id = ps.id
  left join public.attempt_answers as aa on aa.question_id = q.id
  where ps.subject_id = requested_subject_id
    and ps.exam_pack_id = (
      select ep.id
      from public.exam_packs as ep
      where ep.is_active = true
      order by ep.active_from desc, ep.created_at desc
      limit 1
    )
  group by ps.id
  order by ps.set_number;
end;
$$;

create or replace function public.admin_get_practice_set_validation(requested_practice_set_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  active_count integer;
  missing_position_count integer;
  duplicate_position_count integer;
  blank_explanation_count integer;
  invalid_option_count integer;
  duplicate_text_count integer;
  pending_revision_count integer;
  errors text[] := array[]::text[];
begin
  perform public.admin_assert_access();

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id;

  if not found then
    raise exception 'Practice set not found';
  end if;

  select count(*) into active_count
  from public.questions
  where practice_set_id = target_set.id
    and status <> 'archived'
    and (supersedes_question_id is null or status = 'published');

  select count(*) into missing_position_count
  from public.questions
  where practice_set_id = target_set.id
    and status <> 'archived'
    and (supersedes_question_id is null or status = 'published')
    and batch_position is null;

  select count(*) into duplicate_position_count
  from (
    select batch_position
    from public.questions
    where practice_set_id = target_set.id
      and status <> 'archived'
      and (supersedes_question_id is null or status = 'published')
      and batch_position is not null
    group by batch_position
    having count(*) > 1
  ) duplicates;

  select count(*) into blank_explanation_count
  from public.questions
  where practice_set_id = target_set.id
    and status <> 'archived'
    and (supersedes_question_id is null or status = 'published')
    and length(trim(explanation)) = 0;

  select count(*) into invalid_option_count
  from public.questions
  where practice_set_id = target_set.id
    and status <> 'archived'
    and (supersedes_question_id is null or status = 'published')
    and (
      length(trim(question_text)) = 0
      or length(trim(option_a)) = 0
      or length(trim(option_b)) = 0
      or length(trim(option_c)) = 0
      or length(trim(option_d)) = 0
      or (
        select count(distinct lower(trim(value)))
        from unnest(array[option_a, option_b, option_c, option_d]) as value
      ) <> 4
    );

  select count(*) into duplicate_text_count
  from (
    select lower(regexp_replace(trim(question_text), '\\s+', ' ', 'g'))
    from public.questions
    where practice_set_id = target_set.id
      and status <> 'archived'
      and (supersedes_question_id is null or status = 'published')
    group by lower(regexp_replace(trim(question_text), '\\s+', ' ', 'g'))
    having count(*) > 1
  ) duplicates;

  select count(*) into pending_revision_count
  from public.questions
  where practice_set_id = target_set.id
    and status <> 'archived'
    and supersedes_question_id is not null;

  if active_count <> target_set.expected_question_count then
    errors := array_append(
      errors,
      format('Expected %s questions but found %s.', target_set.expected_question_count, active_count)
    );
  end if;

  if missing_position_count > 0 then
    errors := array_append(errors, format('%s questions have no position.', missing_position_count));
  end if;

  if duplicate_position_count > 0 then
    errors := array_append(errors, format('%s question positions are duplicated.', duplicate_position_count));
  end if;

  if blank_explanation_count > 0 then
    errors := array_append(errors, format('%s questions have no explanation.', blank_explanation_count));
  end if;

  if invalid_option_count > 0 then
    errors := array_append(errors, format('%s questions have blank or repeated answer options.', invalid_option_count));
  end if;

  if duplicate_text_count > 0 then
    errors := array_append(errors, format('%s question texts are duplicated.', duplicate_text_count));
  end if;

  if target_set.status <> 'published' and pending_revision_count > 0 then
    errors := array_append(errors, 'Question corrections can only belong to an already published set.');
  end if;

  return jsonb_build_object(
    'ready', cardinality(errors) = 0,
    'errors', to_jsonb(errors),
    'question_count', active_count,
    'expected_question_count', target_set.expected_question_count,
    'status', target_set.status
  );
end;
$$;

create or replace function public.admin_create_module(
  requested_name text,
  requested_slug text,
  requested_sort_order integer,
  requested_price_kobo integer,
  requested_currency text default 'NGN',
  requested_batch_size integer default 30,
  requested_pass_mark_percent integer default 70,
  requested_lifecycle_status text default 'draft'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  active_pack public.exam_packs%rowtype;
  created_subject public.subjects%rowtype;
  created_offering public.module_offerings%rowtype;
  normalized_name text := trim(requested_name);
  normalized_slug text := lower(trim(requested_slug));
  next_status public.module_lifecycle_status;
begin
  perform public.admin_assert_access();

  if normalized_name = '' then
    raise exception 'Module name is required';
  end if;

  if normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Module slug must contain lowercase letters, numbers, and single hyphens only';
  end if;

  if requested_price_kobo is null or requested_price_kobo <= 0 then
    raise exception 'Module price must be greater than zero';
  end if;

  if requested_batch_size is null or requested_batch_size < 1 or requested_batch_size > 200 then
    raise exception 'Expected questions must be between 1 and 200';
  end if;

  if requested_pass_mark_percent < 1 or requested_pass_mark_percent > 100 then
    raise exception 'Pass mark must be between 1 and 100';
  end if;

  if requested_lifecycle_status not in ('draft', 'coming_soon') then
    raise exception 'A new module must begin as draft or coming soon';
  end if;

  next_status := requested_lifecycle_status::public.module_lifecycle_status;

  select * into active_pack
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if not found then
    raise exception 'No active examination edition was found';
  end if;

  insert into public.subjects (
    name,
    slug,
    description,
    sort_order,
    is_active,
    batch_size,
    pass_mark_percent,
    lifecycle_status
  )
  values (
    normalized_name,
    normalized_slug,
    '',
    coalesce(requested_sort_order, 100),
    next_status = 'coming_soon',
    requested_batch_size,
    requested_pass_mark_percent,
    next_status
  )
  returning * into created_subject;

  insert into public.module_offerings (
    exam_pack_id,
    subject_id,
    price_kobo,
    currency,
    is_active
  )
  values (
    active_pack.id,
    created_subject.id,
    requested_price_kobo,
    upper(coalesce(nullif(trim(requested_currency), ''), 'NGN')),
    false
  )
  returning * into created_offering;

  perform public.admin_write_audit(
    'CREATE',
    'module',
    created_subject.id,
    jsonb_build_object(
      'name', created_subject.name,
      'slug', created_subject.slug,
      'lifecycle_status', created_subject.lifecycle_status,
      'price_kobo', created_offering.price_kobo
    )
  );

  return jsonb_build_object(
    'subject_id', created_subject.id,
    'name', created_subject.name,
    'slug', created_subject.slug
  );
end;
$$;

create or replace function public.admin_update_module(
  requested_subject_id uuid,
  requested_name text,
  requested_sort_order integer,
  requested_price_kobo integer,
  requested_currency text,
  requested_batch_size integer,
  requested_pass_mark_percent integer,
  requested_lifecycle_status text,
  requested_available_for_purchase boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subject public.subjects%rowtype;
  active_pack_id uuid;
  next_status public.module_lifecycle_status;
  published_count integer;
  active_access_count integer;
begin
  perform public.admin_assert_access();

  select * into target_subject
  from public.subjects
  where id = requested_subject_id
  for update;

  if not found then
    raise exception 'Module not found';
  end if;

  if trim(requested_name) = '' then
    raise exception 'Module name is required';
  end if;

  if requested_price_kobo is null or requested_price_kobo <= 0 then
    raise exception 'Module price must be greater than zero';
  end if;

  if requested_batch_size is null or requested_batch_size < 1 or requested_batch_size > 200 then
    raise exception 'Expected questions must be between 1 and 200';
  end if;

  if requested_pass_mark_percent < 1 or requested_pass_mark_percent > 100 then
    raise exception 'Pass mark must be between 1 and 100';
  end if;

  if requested_lifecycle_status not in ('draft', 'coming_soon', 'active', 'retired') then
    raise exception 'Invalid module status';
  end if;

  next_status := requested_lifecycle_status::public.module_lifecycle_status;

  select ep.id into active_pack_id
  from public.exam_packs as ep
  where ep.is_active = true
  order by ep.active_from desc, ep.created_at desc
  limit 1;

  if active_pack_id is null then
    raise exception 'No active examination edition was found';
  end if;

  select count(*) into published_count
  from public.questions
  where subject_id = requested_subject_id
    and exam_pack_id = active_pack_id
    and status = 'published';

  if next_status = 'active' and published_count = 0 then
    raise exception 'Publish a complete practice set before activating this module';
  end if;

  if next_status in ('draft', 'coming_soon') and published_count > 0 then
    raise exception 'Archive every published practice set before changing this module to %', replace(next_status::text, '_', ' ');
  end if;

  select
    (select count(*) from public.module_entitlements me
      where me.subject_id = requested_subject_id
        and me.exam_pack_id = active_pack_id
        and me.status = 'active'
        and me.expires_at > now())
    +
    (select count(*) from public.entitlements e
      where e.exam_pack_id = active_pack_id
        and e.status = 'active'
        and e.expires_at > now())
  into active_access_count;

  if next_status = 'retired' and active_access_count > 0 then
    raise exception 'This module still has active access. Stop new sales instead of retiring it';
  end if;

  if requested_available_for_purchase and next_status <> 'active' then
    raise exception 'Only an active module can be offered for purchase';
  end if;

  update public.subjects
  set name = trim(requested_name),
      sort_order = coalesce(requested_sort_order, sort_order),
      batch_size = requested_batch_size,
      pass_mark_percent = requested_pass_mark_percent,
      lifecycle_status = next_status,
      is_active = next_status in ('active', 'coming_soon')
  where id = requested_subject_id;

  insert into public.module_offerings (
    exam_pack_id,
    subject_id,
    price_kobo,
    currency,
    is_active
  )
  values (
    active_pack_id,
    requested_subject_id,
    requested_price_kobo,
    upper(coalesce(nullif(trim(requested_currency), ''), 'NGN')),
    requested_available_for_purchase and next_status = 'active'
  )
  on conflict (exam_pack_id, subject_id) do update
  set price_kobo = excluded.price_kobo,
      currency = excluded.currency,
      is_active = excluded.is_active;

  perform public.admin_write_audit(
    'UPDATE',
    'module',
    requested_subject_id,
    jsonb_build_object(
      'name', trim(requested_name),
      'lifecycle_status', next_status,
      'price_kobo', requested_price_kobo,
      'available_for_purchase', requested_available_for_purchase and next_status = 'active'
    )
  );

  return jsonb_build_object('subject_id', requested_subject_id, 'updated', true);
end;
$$;

create or replace function public.admin_delete_empty_module(requested_subject_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  dependency_count bigint;
begin
  perform public.admin_assert_access();

  perform 1 from public.subjects where id = requested_subject_id for update;
  if not found then
    raise exception 'Module not found';
  end if;

  select
    (select count(*) from public.questions where subject_id = requested_subject_id)
    + (select count(*) from public.attempts where subject_id = requested_subject_id)
    + (select count(*) from public.payment_orders where subject_id = requested_subject_id)
    + (select count(*) from public.module_entitlements where subject_id = requested_subject_id)
  into dependency_count;

  if dependency_count > 0 then
    raise exception 'Only an unused module can be permanently deleted';
  end if;

  perform public.admin_write_audit('DELETE', 'module', requested_subject_id, '{}'::jsonb);
  delete from public.module_offerings where subject_id = requested_subject_id;
  delete from public.practice_sets where subject_id = requested_subject_id;
  delete from public.subjects where id = requested_subject_id;
  return true;
end;
$$;

create or replace function public.admin_create_practice_set(
  requested_subject_id uuid,
  requested_expected_question_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subject public.subjects%rowtype;
  active_pack_id uuid;
  next_set_number integer;
  created_set public.practice_sets%rowtype;
  expected_count integer;
begin
  perform public.admin_assert_access();

  select * into target_subject
  from public.subjects
  where id = requested_subject_id;

  if not found then
    raise exception 'Module not found';
  end if;

  select ep.id into active_pack_id
  from public.exam_packs as ep
  where ep.is_active = true
  order by ep.active_from desc, ep.created_at desc
  limit 1;

  if active_pack_id is null then
    raise exception 'No active examination edition was found';
  end if;

  expected_count := coalesce(requested_expected_question_count, target_subject.batch_size, 30);
  if expected_count < 1 or expected_count > 200 then
    raise exception 'Expected questions must be between 1 and 200';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requested_subject_id::text || active_pack_id::text, 0));

  select coalesce(max(set_number), 0) + 1
  into next_set_number
  from public.practice_sets
  where subject_id = requested_subject_id
    and exam_pack_id = active_pack_id;

  insert into public.practice_sets (
    exam_pack_id,
    subject_id,
    set_number,
    expected_question_count,
    status,
    created_by,
    updated_by
  )
  values (
    active_pack_id,
    requested_subject_id,
    next_set_number,
    expected_count,
    'draft',
    auth.uid(),
    auth.uid()
  )
  returning * into created_set;

  perform public.admin_write_audit(
    'CREATE',
    'practice_set',
    created_set.id,
    jsonb_build_object(
      'subject_id', requested_subject_id,
      'set_number', next_set_number,
      'expected_question_count', expected_count
    )
  );

  return to_jsonb(created_set);
end;
$$;

create or replace function public.admin_update_practice_set(
  requested_practice_set_id uuid,
  requested_expected_question_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
begin
  perform public.admin_assert_access();

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then
    raise exception 'Practice set not found';
  end if;

  if target_set.status in ('published', 'archived') then
    raise exception 'The expected question count is locked after publication';
  end if;

  if requested_expected_question_count < 1 or requested_expected_question_count > 200 then
    raise exception 'Expected questions must be between 1 and 200';
  end if;

  update public.practice_sets
  set expected_question_count = requested_expected_question_count,
      updated_by = auth.uid()
  where id = requested_practice_set_id
  returning * into target_set;

  perform public.admin_write_audit(
    'UPDATE',
    'practice_set',
    requested_practice_set_id,
    jsonb_build_object('expected_question_count', requested_expected_question_count)
  );

  return to_jsonb(target_set);
end;
$$;

create or replace function public.admin_transition_practice_set(
  requested_practice_set_id uuid,
  requested_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  target_subject public.subjects%rowtype;
  validation jsonb;
  next_status public.practice_set_status;
begin
  perform public.admin_assert_access();

  if requested_status not in ('draft', 'review', 'published', 'archived') then
    raise exception 'Invalid practice-set status';
  end if;

  next_status := requested_status::public.practice_set_status;

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then
    raise exception 'Practice set not found';
  end if;

  select * into target_subject
  from public.subjects
  where id = target_set.subject_id
  for update;

  if target_set.status = 'archived' then
    raise exception 'An archived practice set cannot be reopened';
  end if;

  if target_set.status = 'published' and next_status <> 'archived' then
    raise exception 'A published practice set can only be archived';
  end if;

  if target_set.status = 'draft' and next_status = 'published' then
    raise exception 'Send the practice set to review before publishing it';
  end if;

  if next_status in ('review', 'published') then
    validation := public.admin_get_practice_set_validation(requested_practice_set_id);
    if not coalesce((validation->>'ready')::boolean, false) then
      raise exception 'Practice set is not ready: %', array_to_string(
        array(select jsonb_array_elements_text(validation->'errors')),
        ' '
      );
    end if;
  end if;

  if next_status = 'draft' then
    update public.questions
    set status = 'draft', updated_by = auth.uid()
    where practice_set_id = target_set.id
      and status = 'review';
  elsif next_status = 'review' then
    update public.questions
    set status = 'review', updated_by = auth.uid()
    where practice_set_id = target_set.id
      and status = 'draft';
  elsif next_status = 'published' then
    update public.questions
    set status = 'published', updated_by = auth.uid()
    where practice_set_id = target_set.id
      and status in ('draft', 'review');

    update public.subjects
    set lifecycle_status = 'active', is_active = true
    where id = target_set.subject_id;

    if target_subject.lifecycle_status in ('draft', 'coming_soon') then
      update public.module_offerings
      set is_active = true
      where exam_pack_id = target_set.exam_pack_id
        and subject_id = target_set.subject_id;
    end if;
  elsif next_status = 'archived' then
    update public.questions
    set status = 'archived', updated_by = auth.uid()
    where practice_set_id = target_set.id
      and status <> 'archived';

    if not exists (
      select 1
      from public.questions
      where exam_pack_id = target_set.exam_pack_id
        and subject_id = target_set.subject_id
        and status = 'published'
    ) then
      update public.subjects
      set lifecycle_status = 'coming_soon', is_active = true
      where id = target_set.subject_id;

      update public.module_offerings
      set is_active = false
      where exam_pack_id = target_set.exam_pack_id
        and subject_id = target_set.subject_id;
    end if;
  end if;

  update public.practice_sets
  set status = next_status,
      updated_by = auth.uid(),
      published_at = case
        when next_status = 'published' then coalesce(published_at, now())
        else published_at
      end,
      archived_at = case when next_status = 'archived' then now() else null end
  where id = target_set.id
  returning * into target_set;

  perform public.admin_write_audit(
    upper(next_status::text),
    'practice_set',
    target_set.id,
    jsonb_build_object(
      'subject_id', target_set.subject_id,
      'set_number', target_set.set_number,
      'status', next_status
    )
  );

  return to_jsonb(target_set);
end;
$$;

create or replace function public.admin_delete_empty_practice_set(requested_practice_set_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
begin
  perform public.admin_assert_access();

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then
    raise exception 'Practice set not found';
  end if;

  if exists (select 1 from public.questions where practice_set_id = target_set.id) then
    raise exception 'Only an empty practice set can be permanently deleted';
  end if;

  perform public.admin_write_audit(
    'DELETE',
    'practice_set',
    target_set.id,
    jsonb_build_object('set_number', target_set.set_number, 'subject_id', target_set.subject_id)
  );
  delete from public.practice_sets where id = target_set.id;
  return true;
end;
$$;

create or replace function public.admin_validate_question_payload(
  requested_question jsonb,
  explanation_required boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  answer_options text[];
  correct_answer text := upper(trim(coalesce(requested_question->>'correct_option', '')));
  requested_position integer;
begin
  if trim(coalesce(requested_question->>'question_text', '')) = '' then
    raise exception 'Question text is required';
  end if;

  answer_options := array[
    trim(coalesce(requested_question->>'option_a', '')),
    trim(coalesce(requested_question->>'option_b', '')),
    trim(coalesce(requested_question->>'option_c', '')),
    trim(coalesce(requested_question->>'option_d', ''))
  ];

  if exists (select 1 from unnest(answer_options) as value where value = '') then
    raise exception 'All four answer options are required';
  end if;

  if (select count(distinct lower(value)) from unnest(answer_options) as value) <> 4 then
    raise exception 'Answer options must be different from one another';
  end if;

  if correct_answer not in ('A', 'B', 'C', 'D') then
    raise exception 'Correct answer must be A, B, C, or D';
  end if;

  if explanation_required and trim(coalesce(requested_question->>'explanation', '')) = '' then
    raise exception 'An explanation is required before publication';
  end if;

  if coalesce(requested_question->>'difficulty', 'medium') not in ('easy', 'medium', 'hard') then
    raise exception 'Difficulty must be easy, medium, or hard';
  end if;

  begin
    requested_position := (requested_question->>'batch_position')::integer;
  exception
    when invalid_text_representation then
      raise exception 'Question position must be a positive whole number';
  end;

  if requested_position is null or requested_position < 1 then
    raise exception 'Question position must be a positive whole number';
  end if;
end;
$$;

revoke all on function public.admin_validate_question_payload(jsonb, boolean) from public, anon, authenticated;

create or replace function public.admin_save_question(requested_question jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  existing_question public.questions%rowtype;
  saved_question public.questions%rowtype;
  requested_question_id uuid;
  requested_position integer;
  requested_text text := trim(coalesce(requested_question->>'question_text', ''));
  next_status public.question_status;
begin
  perform public.admin_assert_access();
  perform public.admin_validate_question_payload(requested_question, false);

  select * into target_set
  from public.practice_sets
  where id = (requested_question->>'practice_set_id')::uuid
  for update;

  if not found then
    raise exception 'Practice set not found';
  end if;

  if target_set.status in ('published', 'archived') then
    raise exception 'Published questions must be corrected with a revision';
  end if;

  requested_position := (requested_question->>'batch_position')::integer;
  next_status := case
    when target_set.status = 'review' then 'review'::public.question_status
    else 'draft'::public.question_status
  end;

  if nullif(requested_question->>'id', '') is not null then
    requested_question_id := (requested_question->>'id')::uuid;
    select * into existing_question
    from public.questions
    where id = requested_question_id
      and practice_set_id = target_set.id
    for update;

    if not found then
      raise exception 'Question not found in this practice set';
    end if;

    if existing_question.status in ('published', 'archived')
       or exists (select 1 from public.attempt_answers where question_id = existing_question.id) then
      raise exception 'This question has history and must be corrected with a revision';
    end if;
  end if;

  if exists (
    select 1
    from public.questions as q
    where q.practice_set_id = target_set.id
      and q.status <> 'archived'
      and q.batch_position = requested_position
      and q.id is distinct from requested_question_id
  ) then
    raise exception 'Another question already uses position %', requested_position;
  end if;

  if exists (
    select 1
    from public.questions as q
    where q.practice_set_id = target_set.id
      and q.status <> 'archived'
      and lower(regexp_replace(trim(q.question_text), '\\s+', ' ', 'g')) =
          lower(regexp_replace(requested_text, '\\s+', ' ', 'g'))
      and q.id is distinct from requested_question_id
  ) then
    raise exception 'This question already exists in the practice set';
  end if;

  if requested_question_id is null then
    insert into public.questions (
      exam_pack_id,
      subject_id,
      practice_set_id,
      batch_number,
      batch_position,
      service_level,
      difficulty,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option,
      explanation,
      reference_note,
      source_note,
      status,
      created_by,
      updated_by
    )
    values (
      target_set.exam_pack_id,
      target_set.subject_id,
      target_set.id,
      target_set.set_number,
      requested_position,
      nullif(trim(coalesce(requested_question->>'service_level', '')), ''),
      coalesce(requested_question->>'difficulty', 'medium')::public.difficulty_level,
      requested_text,
      trim(requested_question->>'option_a'),
      trim(requested_question->>'option_b'),
      trim(requested_question->>'option_c'),
      trim(requested_question->>'option_d'),
      upper(trim(requested_question->>'correct_option')),
      trim(coalesce(requested_question->>'explanation', '')),
      trim(coalesce(requested_question->>'reference_note', '')),
      coalesce(nullif(trim(coalesce(requested_question->>'source_note', '')), ''), 'Admin content manager'),
      next_status,
      auth.uid(),
      auth.uid()
    )
    returning * into saved_question;
  else
    update public.questions
    set batch_position = requested_position,
        difficulty = coalesce(requested_question->>'difficulty', 'medium')::public.difficulty_level,
        question_text = requested_text,
        option_a = trim(requested_question->>'option_a'),
        option_b = trim(requested_question->>'option_b'),
        option_c = trim(requested_question->>'option_c'),
        option_d = trim(requested_question->>'option_d'),
        correct_option = upper(trim(requested_question->>'correct_option')),
        explanation = trim(coalesce(requested_question->>'explanation', '')),
        reference_note = trim(coalesce(requested_question->>'reference_note', '')),
        source_note = coalesce(nullif(trim(coalesce(requested_question->>'source_note', '')), ''), source_note),
        status = next_status,
        updated_by = auth.uid()
    where id = requested_question_id
    returning * into saved_question;
  end if;

  return to_jsonb(saved_question);
end;
$$;

create or replace function public.admin_create_question_revision(requested_question jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  original_question public.questions%rowtype;
  revised_question public.questions%rowtype;
  original_id uuid := (requested_question->>'id')::uuid;
begin
  perform public.admin_assert_access();
  perform public.admin_validate_question_payload(requested_question, true);

  select * into original_question
  from public.questions
  where id = original_id
  for update;

  if not found or original_question.status <> 'published' then
    raise exception 'Only a published question can be corrected';
  end if;

  if exists (
    select 1
    from public.questions
    where supersedes_question_id = original_question.id
      and status <> 'archived'
  ) then
    raise exception 'A correction for this question is already awaiting publication';
  end if;

  insert into public.questions (
    exam_pack_id,
    subject_id,
    practice_set_id,
    batch_number,
    batch_position,
    service_level,
    difficulty,
    question_text,
    option_a,
    option_b,
    option_c,
    option_d,
    correct_option,
    explanation,
    reference_note,
    source_note,
    status,
    supersedes_question_id,
    revision_number,
    created_by,
    updated_by
  )
  values (
    original_question.exam_pack_id,
    original_question.subject_id,
    original_question.practice_set_id,
    original_question.batch_number,
    original_question.batch_position,
    original_question.service_level,
    coalesce(requested_question->>'difficulty', original_question.difficulty::text)::public.difficulty_level,
    trim(requested_question->>'question_text'),
    trim(requested_question->>'option_a'),
    trim(requested_question->>'option_b'),
    trim(requested_question->>'option_c'),
    trim(requested_question->>'option_d'),
    upper(trim(requested_question->>'correct_option')),
    trim(requested_question->>'explanation'),
    trim(coalesce(requested_question->>'reference_note', '')),
    coalesce(nullif(trim(coalesce(requested_question->>'source_note', '')), ''), original_question.source_note),
    'review',
    original_question.id,
    original_question.revision_number + 1,
    auth.uid(),
    auth.uid()
  )
  returning * into revised_question;

  perform public.admin_write_audit(
    'CREATE_REVISION',
    'question',
    revised_question.id,
    jsonb_build_object('supersedes_question_id', original_question.id)
  );

  return to_jsonb(revised_question);
end;
$$;

create or replace function public.admin_publish_question_revision(requested_question_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  revised_question public.questions%rowtype;
  original_question public.questions%rowtype;
begin
  perform public.admin_assert_access();

  select * into revised_question
  from public.questions
  where id = requested_question_id
  for update;

  if not found or revised_question.supersedes_question_id is null then
    raise exception 'Question correction not found';
  end if;

  if revised_question.status <> 'review' then
    raise exception 'Only a pending reviewed correction can be published';
  end if;

  select * into original_question
  from public.questions
  where id = revised_question.supersedes_question_id
  for update;

  if not found or original_question.status <> 'published' then
    raise exception 'The original published question is unavailable';
  end if;

  if exists (
    select 1
    from public.questions as q
    where q.practice_set_id = revised_question.practice_set_id
      and q.status = 'published'
      and q.id <> original_question.id
      and lower(regexp_replace(trim(q.question_text), '\\s+', ' ', 'g')) =
          lower(regexp_replace(trim(revised_question.question_text), '\\s+', ' ', 'g'))
  ) then
    raise exception 'This correction duplicates another published question in the practice set';
  end if;

  perform public.admin_validate_question_payload(
    jsonb_build_object(
      'question_text', revised_question.question_text,
      'option_a', revised_question.option_a,
      'option_b', revised_question.option_b,
      'option_c', revised_question.option_c,
      'option_d', revised_question.option_d,
      'correct_option', revised_question.correct_option,
      'explanation', revised_question.explanation,
      'difficulty', revised_question.difficulty,
      'batch_position', revised_question.batch_position
    ),
    true
  );

  update public.questions
  set status = 'archived', updated_by = auth.uid()
  where id = original_question.id;

  update public.questions
  set status = 'published', updated_by = auth.uid()
  where id = revised_question.id
  returning * into revised_question;

  perform public.admin_write_audit(
    'PUBLISH_REVISION',
    'question',
    revised_question.id,
    jsonb_build_object('archived_question_id', original_question.id)
  );

  return to_jsonb(revised_question);
end;
$$;

create or replace function public.admin_update_question_revision(requested_question jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  revised_question public.questions%rowtype;
begin
  perform public.admin_assert_access();
  perform public.admin_validate_question_payload(requested_question, true);

  select * into revised_question
  from public.questions
  where id = (requested_question->>'id')::uuid
  for update;

  if not found
     or revised_question.supersedes_question_id is null
     or revised_question.status not in ('draft', 'review') then
    raise exception 'Pending question correction not found';
  end if;

  update public.questions
  set difficulty = coalesce(requested_question->>'difficulty', revised_question.difficulty::text)::public.difficulty_level,
      question_text = trim(requested_question->>'question_text'),
      option_a = trim(requested_question->>'option_a'),
      option_b = trim(requested_question->>'option_b'),
      option_c = trim(requested_question->>'option_c'),
      option_d = trim(requested_question->>'option_d'),
      correct_option = upper(trim(requested_question->>'correct_option')),
      explanation = trim(requested_question->>'explanation'),
      reference_note = trim(coalesce(requested_question->>'reference_note', '')),
      source_note = coalesce(
        nullif(trim(coalesce(requested_question->>'source_note', '')), ''),
        revised_question.source_note
      ),
      status = 'review',
      updated_by = auth.uid()
  where id = revised_question.id
  returning * into revised_question;

  perform public.admin_write_audit(
    'UPDATE_REVISION',
    'question',
    revised_question.id,
    jsonb_build_object('supersedes_question_id', revised_question.supersedes_question_id)
  );

  return to_jsonb(revised_question);
end;
$$;

create or replace function public.admin_archive_question(requested_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_question public.questions%rowtype;
begin
  perform public.admin_assert_access();

  select * into target_question
  from public.questions
  where id = requested_question_id
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  if target_question.status = 'published' then
    raise exception 'Replace a published question or archive its entire practice set';
  end if;

  update public.questions
  set status = 'archived', updated_by = auth.uid()
  where id = requested_question_id;
  return true;
end;
$$;

create or replace function public.admin_delete_draft_question(requested_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_question public.questions%rowtype;
begin
  perform public.admin_assert_access();

  select * into target_question
  from public.questions
  where id = requested_question_id
  for update;

  if not found then
    raise exception 'Question not found';
  end if;

  if target_question.status not in ('draft', 'review')
     or exists (select 1 from public.attempt_answers where question_id = target_question.id) then
    raise exception 'Only an unused draft or review question can be permanently deleted';
  end if;

  delete from public.questions where id = target_question.id;
  return true;
end;
$$;

create or replace function public.admin_import_questions(
  requested_practice_set_id uuid,
  requested_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  item jsonb;
  item_number integer := 0;
  requested_position integer;
  imported_count integer := 0;
begin
  perform public.admin_assert_access();

  if jsonb_typeof(requested_questions) <> 'array' then
    raise exception 'Imported questions must be an array';
  end if;

  if jsonb_array_length(requested_questions) < 1 or jsonb_array_length(requested_questions) > 200 then
    raise exception 'Import between 1 and 200 questions at a time';
  end if;

  select * into target_set
  from public.practice_sets
  where id = requested_practice_set_id
  for update;

  if not found then
    raise exception 'Practice set not found';
  end if;

  if target_set.status in ('published', 'archived') then
    raise exception 'Questions can only be imported into a draft or review practice set';
  end if;

  for item in select value from jsonb_array_elements(requested_questions)
  loop
    item_number := item_number + 1;
    if nullif(item->>'batch_position', '') is null then
      item := jsonb_set(item, '{batch_position}', to_jsonb(item_number), true);
    end if;

    item := jsonb_set(item, '{practice_set_id}', to_jsonb(target_set.id::text), true);
    perform public.admin_validate_question_payload(item, false);
    requested_position := (item->>'batch_position')::integer;

    if exists (
      select 1 from public.questions q
      where q.practice_set_id = target_set.id
        and q.status <> 'archived'
        and q.batch_position = requested_position
    ) then
      raise exception 'Import row % uses an existing question position %', item_number, requested_position;
    end if;

    if exists (
      select 1 from public.questions q
      where q.practice_set_id = target_set.id
        and q.status <> 'archived'
        and lower(regexp_replace(trim(q.question_text), '\\s+', ' ', 'g')) =
            lower(regexp_replace(trim(item->>'question_text'), '\\s+', ' ', 'g'))
    ) then
      raise exception 'Import row % duplicates an existing question', item_number;
    end if;

    insert into public.questions (
      exam_pack_id,
      subject_id,
      practice_set_id,
      batch_number,
      batch_position,
      difficulty,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option,
      explanation,
      reference_note,
      source_note,
      status,
      created_by,
      updated_by
    )
    values (
      target_set.exam_pack_id,
      target_set.subject_id,
      target_set.id,
      target_set.set_number,
      requested_position,
      coalesce(item->>'difficulty', 'medium')::public.difficulty_level,
      trim(item->>'question_text'),
      trim(item->>'option_a'),
      trim(item->>'option_b'),
      trim(item->>'option_c'),
      trim(item->>'option_d'),
      upper(trim(item->>'correct_option')),
      trim(coalesce(item->>'explanation', '')),
      trim(coalesce(item->>'reference_note', '')),
      coalesce(nullif(trim(coalesce(item->>'source_note', '')), ''), 'Admin bulk import'),
      case when target_set.status = 'review' then 'review'::public.question_status else 'draft'::public.question_status end,
      auth.uid(),
      auth.uid()
    );

    imported_count := imported_count + 1;
  end loop;

  perform public.admin_write_audit(
    'IMPORT',
    'practice_set',
    target_set.id,
    jsonb_build_object('question_count', imported_count)
  );

  return jsonb_build_object('imported_count', imported_count);
end;
$$;

revoke all on function public.get_admin_content_modules() from public, anon;
revoke all on function public.get_admin_practice_sets(uuid) from public, anon;
revoke all on function public.admin_get_practice_set_validation(uuid) from public, anon;
revoke all on function public.admin_create_module(text, text, integer, integer, text, integer, integer, text) from public, anon;
revoke all on function public.admin_update_module(uuid, text, integer, integer, text, integer, integer, text, boolean) from public, anon;
revoke all on function public.admin_delete_empty_module(uuid) from public, anon;
revoke all on function public.admin_create_practice_set(uuid, integer) from public, anon;
revoke all on function public.admin_update_practice_set(uuid, integer) from public, anon;
revoke all on function public.admin_transition_practice_set(uuid, text) from public, anon;
revoke all on function public.admin_delete_empty_practice_set(uuid) from public, anon;
revoke all on function public.admin_save_question(jsonb) from public, anon;
revoke all on function public.admin_create_question_revision(jsonb) from public, anon;
revoke all on function public.admin_update_question_revision(jsonb) from public, anon;
revoke all on function public.admin_publish_question_revision(uuid) from public, anon;
revoke all on function public.admin_archive_question(uuid) from public, anon;
revoke all on function public.admin_delete_draft_question(uuid) from public, anon;
revoke all on function public.admin_import_questions(uuid, jsonb) from public, anon;

grant execute on function public.get_admin_content_modules() to authenticated;
grant execute on function public.get_admin_practice_sets(uuid) to authenticated;
grant execute on function public.admin_get_practice_set_validation(uuid) to authenticated;
grant execute on function public.admin_create_module(text, text, integer, integer, text, integer, integer, text) to authenticated;
grant execute on function public.admin_update_module(uuid, text, integer, integer, text, integer, integer, text, boolean) to authenticated;
grant execute on function public.admin_delete_empty_module(uuid) to authenticated;
grant execute on function public.admin_create_practice_set(uuid, integer) to authenticated;
grant execute on function public.admin_update_practice_set(uuid, integer) to authenticated;
grant execute on function public.admin_transition_practice_set(uuid, text) to authenticated;
grant execute on function public.admin_delete_empty_practice_set(uuid) to authenticated;
grant execute on function public.admin_save_question(jsonb) to authenticated;
grant execute on function public.admin_create_question_revision(jsonb) to authenticated;
grant execute on function public.admin_update_question_revision(jsonb) to authenticated;
grant execute on function public.admin_publish_question_revision(uuid) to authenticated;
grant execute on function public.admin_archive_question(uuid) to authenticated;
grant execute on function public.admin_delete_draft_question(uuid) to authenticated;
grant execute on function public.admin_import_questions(uuid, jsonb) to authenticated;
