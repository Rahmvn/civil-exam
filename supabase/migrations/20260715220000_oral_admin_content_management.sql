-- Add oral content administration without changing the objective content contract.

create or replace function public.enforce_practice_set_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subject_type public.practice_type;
begin
  select practice_type into subject_type
  from public.subjects
  where id = new.subject_id;

  if subject_type is null then
    raise exception 'Choose a valid module';
  end if;

  if tg_op = 'UPDATE' and new.practice_type <> old.practice_type then
    raise exception 'A practice set type cannot be changed after creation';
  end if;

  new.practice_type := subject_type;
  return new;
end;
$$;

drop trigger if exists practice_sets_enforce_type on public.practice_sets;
create trigger practice_sets_enforce_type
before insert or update of subject_id, practice_type on public.practice_sets
for each row execute function public.enforce_practice_set_type();

create or replace function public.prevent_used_module_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.practice_type <> old.practice_type and exists (
    select 1 from public.practice_sets where subject_id = old.id
  ) then
    raise exception 'A module type cannot be changed after practice sets are created';
  end if;
  return new;
end;
$$;

drop trigger if exists subjects_prevent_used_type_change on public.subjects;
create trigger subjects_prevent_used_type_change
before update of practice_type on public.subjects
for each row execute function public.prevent_used_module_type_change();

create or replace function public.validate_objective_question_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
begin
  select * into target_set from public.practice_sets where id = new.practice_set_id;
  if target_set.id is null
     or target_set.practice_type <> 'objective'
     or target_set.exam_pack_id <> new.exam_pack_id
     or target_set.subject_id <> new.subject_id then
    raise exception 'The objective question must belong to an objective set in the same module and exam pack';
  end if;
  return new;
end;
$$;

drop trigger if exists questions_validate_objective_context on public.questions;
create trigger questions_validate_objective_context
before insert or update of exam_pack_id, subject_id, practice_set_id on public.questions
for each row execute function public.validate_objective_question_context();

create or replace function public.get_admin_content_modules_v2()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  practice_type public.practice_type,
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
    select ep.id from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc limit 1
  )
  select s.id, s.name, s.slug, s.practice_type, s.sort_order, s.lifecycle_status,
    s.is_active, s.batch_size, s.pass_mark_percent, mo.id, mo.price_kobo,
    coalesce(mo.currency, 'NGN'), coalesce(mo.is_active, false),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id),
    (select count(*) from public.practice_sets ps where ps.subject_id = s.id and ps.exam_pack_id = ap.id and ps.status = 'published'),
    case when s.practice_type = 'oral'
      then (select count(*) from public.oral_questions q where q.subject_id = s.id and q.exam_pack_id = ap.id)
      else (select count(*) from public.questions q where q.subject_id = s.id and q.exam_pack_id = ap.id)
    end,
    case when s.practice_type = 'oral'
      then (select count(*) from public.oral_attempts a where a.subject_id = s.id and a.exam_pack_id = ap.id)
      else (select count(*) from public.attempts a where a.subject_id = s.id and a.exam_pack_id = ap.id)
    end,
    (select count(*) from public.payment_orders po where po.subject_id = s.id and po.exam_pack_id = ap.id),
    (select count(*) from public.module_entitlements me where me.subject_id = s.id and me.exam_pack_id = ap.id and me.status = 'active' and me.expires_at > now())
      + (select count(*) from public.entitlements e where e.exam_pack_id = ap.id and e.status = 'active' and e.expires_at > now())
  from public.subjects s
  cross join active_pack ap
  left join public.module_offerings mo on mo.subject_id = s.id and mo.exam_pack_id = ap.id
  order by s.sort_order, s.name;
end;
$$;

create or replace function public.get_admin_practice_sets_v2(requested_subject_id uuid)
returns table (
  practice_set_id uuid,
  practice_type public.practice_type,
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
  select ps.id, ps.practice_type, ps.set_number, ps.status, ps.expected_question_count,
    case when ps.practice_type = 'oral' then
      (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status <> 'archived' and (q.supersedes_question_id is null or q.status = 'published'))
    else
      (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status <> 'archived' and (q.supersedes_question_id is null or q.status = 'published'))
    end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'draft') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'draft') end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'review') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'review') end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'published') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'published') end,
    case when ps.practice_type = 'oral' then (select count(*) from public.oral_questions q where q.practice_set_id = ps.id and q.status = 'archived') else (select count(*) from public.questions q where q.practice_set_id = ps.id and q.status = 'archived') end,
    case when ps.practice_type = 'oral' then
      (select count(distinct r.question_id) from public.oral_responses r join public.oral_questions q on q.id = r.question_id where q.practice_set_id = ps.id)
    else
      (select count(distinct aa.question_id) from public.attempt_answers aa join public.questions q on q.id = aa.question_id where q.practice_set_id = ps.id)
    end,
    ps.published_at, ps.updated_at
  from public.practice_sets ps
  where ps.subject_id = requested_subject_id
    and ps.exam_pack_id = (select ep.id from public.exam_packs ep where ep.is_active = true order by ep.active_from desc, ep.created_at desc limit 1)
  order by ps.set_number;
end;
$$;

create or replace function public.admin_get_practice_set_validation_v2(requested_practice_set_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_set public.practice_sets%rowtype;
  active_count integer;
  bad_position_count integer;
  missing_review_count integer;
  duplicate_text_count integer;
  pending_revision_count integer;
  errors text[] := array[]::text[];
begin
  perform public.admin_assert_access();
  select * into target_set from public.practice_sets where id = requested_practice_set_id;
  if not found then raise exception 'Practice set not found'; end if;

  if target_set.practice_type = 'objective' then
    return public.admin_get_practice_set_validation(requested_practice_set_id);
  end if;

  select count(*) into active_count from public.oral_questions
  where practice_set_id = target_set.id and status <> 'archived'
    and (supersedes_question_id is null or status = 'published');

  select count(*) into bad_position_count from (
    select batch_position from public.oral_questions
    where practice_set_id = target_set.id and status <> 'archived'
      and (supersedes_question_id is null or status = 'published')
    group by batch_position having batch_position is null or count(*) > 1
  ) positions;

  select count(*) into missing_review_count from public.oral_questions
  where practice_set_id = target_set.id and status <> 'archived'
    and (supersedes_question_id is null or status = 'published')
    and (length(btrim(question_text)) = 0 or length(btrim(model_answer)) = 0
      or cardinality(key_points) = 0
      or exists (select 1 from unnest(key_points) point where length(btrim(point)) = 0));

  select count(*) into duplicate_text_count from (
    select lower(regexp_replace(btrim(question_text), '\\s+', ' ', 'g'))
    from public.oral_questions
    where practice_set_id = target_set.id and status <> 'archived'
      and (supersedes_question_id is null or status = 'published')
    group by lower(regexp_replace(btrim(question_text), '\\s+', ' ', 'g')) having count(*) > 1
  ) duplicates;

  select count(*) into pending_revision_count from public.oral_questions
  where practice_set_id = target_set.id and status <> 'archived' and supersedes_question_id is not null;

  if active_count <> target_set.expected_question_count then errors := array_append(errors, format('Expected %s questions but found %s.', target_set.expected_question_count, active_count)); end if;
  if bad_position_count > 0 then errors := array_append(errors, format('%s question positions are missing or duplicated.', bad_position_count)); end if;
  if missing_review_count > 0 then errors := array_append(errors, format('%s oral questions need a model answer and at least one key point.', missing_review_count)); end if;
  if duplicate_text_count > 0 then errors := array_append(errors, format('%s question texts are duplicated.', duplicate_text_count)); end if;
  if target_set.status <> 'published' and pending_revision_count > 0 then errors := array_append(errors, 'Question corrections can only belong to an already published set.'); end if;

  return jsonb_build_object('ready', cardinality(errors) = 0, 'errors', to_jsonb(errors),
    'question_count', active_count, 'expected_question_count', target_set.expected_question_count,
    'status', target_set.status, 'practice_type', target_set.practice_type);
end;
$$;

create or replace function public.admin_create_module_typed(
  requested_name text,
  requested_slug text,
  requested_sort_order integer,
  requested_price_kobo integer,
  requested_currency text default 'NGN',
  requested_batch_size integer default null,
  requested_pass_mark_percent integer default 70,
  requested_lifecycle_status text default 'draft',
  requested_practice_type text default 'objective'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  active_pack public.exam_packs%rowtype;
  created_subject public.subjects%rowtype;
  normalized_type public.practice_type;
  normalized_status public.module_lifecycle_status;
  normalized_batch_size integer;
begin
  perform public.admin_assert_access();
  if btrim(coalesce(requested_name, '')) = '' then raise exception 'Module name is required'; end if;
  if lower(btrim(requested_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Module slug must contain lowercase letters, numbers, and single hyphens only'; end if;
  if requested_practice_type not in ('objective', 'oral') then raise exception 'Choose objective or oral practice'; end if;
  if requested_lifecycle_status not in ('draft', 'coming_soon') then raise exception 'A new module must begin as draft or coming soon'; end if;
  if requested_price_kobo is null or requested_price_kobo <= 0 then raise exception 'Module price must be greater than zero'; end if;
  normalized_type := requested_practice_type::public.practice_type;
  normalized_status := requested_lifecycle_status::public.module_lifecycle_status;
  normalized_batch_size := coalesce(requested_batch_size, case when normalized_type = 'oral' then 5 else 30 end);
  if normalized_batch_size < 1 or normalized_batch_size > 200 then raise exception 'Expected questions must be between 1 and 200'; end if;
  if requested_pass_mark_percent < 1 or requested_pass_mark_percent > 100 then raise exception 'Pass mark must be between 1 and 100'; end if;

  select * into active_pack from public.exam_packs where is_active = true order by active_from desc, created_at desc limit 1;
  if not found then raise exception 'No active examination edition was found'; end if;

  insert into public.subjects (name, slug, description, sort_order, is_active, batch_size, pass_mark_percent, lifecycle_status, practice_type)
  values (btrim(requested_name), lower(btrim(requested_slug)), '', coalesce(requested_sort_order, 100),
    normalized_status = 'coming_soon', normalized_batch_size, requested_pass_mark_percent, normalized_status, normalized_type)
  returning * into created_subject;

  insert into public.module_offerings (exam_pack_id, subject_id, price_kobo, currency, is_active)
  values (active_pack.id, created_subject.id, requested_price_kobo, upper(coalesce(nullif(btrim(requested_currency), ''), 'NGN')), false);

  perform public.admin_write_audit('CREATE', 'module', created_subject.id,
    jsonb_build_object('name', created_subject.name, 'slug', created_subject.slug,
      'lifecycle_status', created_subject.lifecycle_status, 'practice_type', normalized_type,
      'price_kobo', requested_price_kobo));
  return jsonb_build_object('subject_id', created_subject.id, 'name', created_subject.name,
    'slug', created_subject.slug, 'practice_type', normalized_type);
end;
$$;

create or replace function public.admin_update_module_v2(
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
  select * into target_subject from public.subjects where id = requested_subject_id for update;
  if not found then raise exception 'Module not found'; end if;
  if btrim(coalesce(requested_name, '')) = '' then raise exception 'Module name is required'; end if;
  if requested_price_kobo is null or requested_price_kobo <= 0 then raise exception 'Module price must be greater than zero'; end if;
  if requested_batch_size < 1 or requested_batch_size > 200 then raise exception 'Expected questions must be between 1 and 200'; end if;
  if requested_pass_mark_percent < 1 or requested_pass_mark_percent > 100 then raise exception 'Pass mark must be between 1 and 100'; end if;
  if requested_lifecycle_status not in ('draft', 'coming_soon', 'active', 'retired') then raise exception 'Invalid module status'; end if;
  next_status := requested_lifecycle_status::public.module_lifecycle_status;
  select ep.id into active_pack_id from public.exam_packs ep where ep.is_active = true order by ep.active_from desc, ep.created_at desc limit 1;
  if active_pack_id is null then raise exception 'No active examination edition was found'; end if;

  if target_subject.practice_type = 'oral' then
    select count(*) into published_count from public.oral_questions where subject_id = requested_subject_id and exam_pack_id = active_pack_id and status = 'published';
  else
    select count(*) into published_count from public.questions where subject_id = requested_subject_id and exam_pack_id = active_pack_id and status = 'published';
  end if;
  if next_status = 'active' and published_count = 0 then raise exception 'Publish a complete practice set before activating this module'; end if;
  if next_status in ('draft', 'coming_soon') and published_count > 0 then raise exception 'Archive every published practice set before changing this module'; end if;

  select (select count(*) from public.module_entitlements me where me.subject_id = requested_subject_id and me.exam_pack_id = active_pack_id and me.status = 'active' and me.expires_at > now())
    + (select count(*) from public.entitlements e where e.exam_pack_id = active_pack_id and e.status = 'active' and e.expires_at > now()) into active_access_count;
  if next_status = 'retired' and active_access_count > 0 then raise exception 'This module still has active access. Stop new sales instead of retiring it'; end if;
  if requested_available_for_purchase and next_status <> 'active' then raise exception 'Only an active module can be offered for purchase'; end if;

  update public.subjects set name = btrim(requested_name), sort_order = coalesce(requested_sort_order, sort_order),
    batch_size = requested_batch_size, pass_mark_percent = requested_pass_mark_percent,
    lifecycle_status = next_status, is_active = next_status in ('active', 'coming_soon')
  where id = requested_subject_id;
  insert into public.module_offerings (exam_pack_id, subject_id, price_kobo, currency, is_active)
  values (active_pack_id, requested_subject_id, requested_price_kobo,
    upper(coalesce(nullif(btrim(requested_currency), ''), 'NGN')), requested_available_for_purchase and next_status = 'active')
  on conflict (exam_pack_id, subject_id) do update set price_kobo = excluded.price_kobo,
    currency = excluded.currency, is_active = excluded.is_active;
  perform public.admin_write_audit('UPDATE', 'module', requested_subject_id,
    jsonb_build_object('name', btrim(requested_name), 'practice_type', target_subject.practice_type,
      'lifecycle_status', next_status, 'price_kobo', requested_price_kobo,
      'available_for_purchase', requested_available_for_purchase and next_status = 'active'));
  return jsonb_build_object('subject_id', requested_subject_id, 'updated', true, 'practice_type', target_subject.practice_type);
end;
$$;

create or replace function public.admin_transition_practice_set_v2(requested_practice_set_id uuid, requested_status text)
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
  sales_were_enabled boolean := false;
  remaining_published integer;
begin
  perform public.admin_assert_access();
  if requested_status not in ('draft', 'review', 'published', 'archived') then raise exception 'Invalid practice-set status'; end if;
  next_status := requested_status::public.practice_set_status;
  select * into target_set from public.practice_sets where id = requested_practice_set_id for update;
  if not found then raise exception 'Practice set not found'; end if;
  select * into target_subject from public.subjects where id = target_set.subject_id for update;
  if target_set.status = 'archived' then raise exception 'An archived practice set cannot be reopened'; end if;
  if target_set.status = 'published' and next_status <> 'archived' then raise exception 'A published practice set can only be archived'; end if;
  if target_set.status = 'draft' and next_status = 'published' then raise exception 'Send the practice set to review before publishing it'; end if;
  if next_status in ('review', 'published') then
    validation := public.admin_get_practice_set_validation_v2(target_set.id);
    if not coalesce((validation->>'ready')::boolean, false) then
      raise exception 'Practice set is not ready: %', array_to_string(array(select jsonb_array_elements_text(validation->'errors')), ' ');
    end if;
  end if;
  select coalesce(is_active, false) into sales_were_enabled from public.module_offerings
  where exam_pack_id = target_set.exam_pack_id and subject_id = target_set.subject_id for update;

  if target_set.practice_type = 'oral' then
    if next_status = 'draft' then update public.oral_questions set status = 'draft', updated_by = auth.uid() where practice_set_id = target_set.id and status = 'review';
    elsif next_status = 'review' then update public.oral_questions set status = 'review', updated_by = auth.uid() where practice_set_id = target_set.id and status = 'draft';
    elsif next_status = 'published' then update public.oral_questions set status = 'published', updated_by = auth.uid() where practice_set_id = target_set.id and status in ('draft', 'review');
    elsif next_status = 'archived' then update public.oral_questions set status = 'archived', updated_by = auth.uid() where practice_set_id = target_set.id and status <> 'archived';
    end if;
  else
    if next_status = 'draft' then update public.questions set status = 'draft', updated_by = auth.uid() where practice_set_id = target_set.id and status = 'review';
    elsif next_status = 'review' then update public.questions set status = 'review', updated_by = auth.uid() where practice_set_id = target_set.id and status = 'draft';
    elsif next_status = 'published' then update public.questions set status = 'published', updated_by = auth.uid() where practice_set_id = target_set.id and status in ('draft', 'review');
    elsif next_status = 'archived' then update public.questions set status = 'archived', updated_by = auth.uid() where practice_set_id = target_set.id and status <> 'archived';
    end if;
  end if;

  if next_status = 'published' then
    update public.subjects set lifecycle_status = 'active', is_active = true where id = target_set.subject_id;
  elsif next_status = 'archived' then
    if target_set.practice_type = 'oral' then select count(*) into remaining_published from public.oral_questions where exam_pack_id = target_set.exam_pack_id and subject_id = target_set.subject_id and status = 'published';
    else select count(*) into remaining_published from public.questions where exam_pack_id = target_set.exam_pack_id and subject_id = target_set.subject_id and status = 'published'; end if;
    if remaining_published = 0 then
      update public.subjects set lifecycle_status = 'coming_soon', is_active = true where id = target_set.subject_id;
      update public.module_offerings set is_active = false where exam_pack_id = target_set.exam_pack_id and subject_id = target_set.subject_id;
    end if;
  end if;

  update public.practice_sets set status = next_status, updated_by = auth.uid(),
    published_at = case when next_status = 'published' then coalesce(published_at, now()) else published_at end,
    archived_at = case when next_status = 'archived' then now() else null end
  where id = target_set.id returning * into target_set;
  if next_status = 'published' then update public.module_offerings set is_active = sales_were_enabled where exam_pack_id = target_set.exam_pack_id and subject_id = target_set.subject_id; end if;
  perform public.admin_write_audit(upper(next_status::text), 'practice_set', target_set.id,
    jsonb_build_object('subject_id', target_set.subject_id, 'set_number', target_set.set_number,
      'status', next_status, 'practice_type', target_set.practice_type));
  return to_jsonb(target_set);
end;
$$;

create or replace function public.admin_delete_empty_practice_set_v2(requested_practice_set_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare target_set public.practice_sets%rowtype;
begin
  perform public.admin_assert_access();
  select * into target_set from public.practice_sets where id = requested_practice_set_id for update;
  if not found then raise exception 'Practice set not found'; end if;
  if exists (select 1 from public.questions where practice_set_id = target_set.id)
     or exists (select 1 from public.oral_questions where practice_set_id = target_set.id)
     or exists (select 1 from public.oral_attempts where practice_set_id = target_set.id) then
    raise exception 'Only an empty unused practice set can be permanently deleted';
  end if;
  perform public.admin_write_audit('DELETE', 'practice_set', target_set.id,
    jsonb_build_object('set_number', target_set.set_number, 'subject_id', target_set.subject_id, 'practice_type', target_set.practice_type));
  delete from public.practice_sets where id = target_set.id;
  return true;
end;
$$;

create or replace function public.admin_delete_empty_module_v2(requested_subject_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare dependency_count bigint;
begin
  perform public.admin_assert_access();
  perform 1 from public.subjects where id = requested_subject_id for update;
  if not found then raise exception 'Module not found'; end if;
  select (select count(*) from public.questions where subject_id = requested_subject_id)
    + (select count(*) from public.oral_questions where subject_id = requested_subject_id)
    + (select count(*) from public.attempts where subject_id = requested_subject_id)
    + (select count(*) from public.oral_attempts where subject_id = requested_subject_id)
    + (select count(*) from public.payment_orders where subject_id = requested_subject_id)
    + (select count(*) from public.module_entitlements where subject_id = requested_subject_id)
  into dependency_count;
  if dependency_count > 0 then raise exception 'Only an unused module can be permanently deleted'; end if;
  perform public.admin_write_audit('DELETE', 'module', requested_subject_id, '{}'::jsonb);
  delete from public.module_offerings where subject_id = requested_subject_id;
  delete from public.practice_sets where subject_id = requested_subject_id;
  delete from public.subjects where id = requested_subject_id;
  return true;
end;
$$;

create or replace function public.admin_validate_oral_question_payload(requested_question jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare requested_position integer; points jsonb;
begin
  if btrim(coalesce(requested_question->>'question_text', '')) = '' then raise exception 'Question text is required'; end if;
  if btrim(coalesce(requested_question->>'model_answer', '')) = '' then raise exception 'Model answer is required'; end if;
  points := coalesce(requested_question->'key_points', '[]'::jsonb);
  if jsonb_typeof(points) <> 'array' or jsonb_array_length(points) < 1 then raise exception 'Add at least one key point'; end if;
  if exists (select 1 from jsonb_array_elements_text(points) point where btrim(point) = '') then raise exception 'Key points cannot be blank'; end if;
  if (select count(distinct lower(btrim(point))) from jsonb_array_elements_text(points) point) <> jsonb_array_length(points) then raise exception 'Key points must be different from one another'; end if;
  if coalesce(requested_question->>'difficulty', 'medium') not in ('easy', 'medium', 'hard') then raise exception 'Difficulty must be easy, medium, or hard'; end if;
  begin requested_position := (requested_question->>'batch_position')::integer;
  exception when invalid_text_representation then raise exception 'Question position must be a positive whole number'; end;
  if requested_position is null or requested_position < 1 then raise exception 'Question position must be a positive whole number'; end if;
end;
$$;

create or replace function public.admin_save_oral_question(requested_question jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_set public.practice_sets%rowtype; existing public.oral_questions%rowtype; saved public.oral_questions%rowtype;
  requested_id uuid; requested_position integer := (requested_question->>'batch_position')::integer;
  requested_text text := btrim(requested_question->>'question_text'); next_status public.question_status;
begin
  perform public.admin_assert_access(); perform public.admin_validate_oral_question_payload(requested_question);
  select * into target_set from public.practice_sets where id = (requested_question->>'practice_set_id')::uuid for update;
  if not found or target_set.practice_type <> 'oral' then raise exception 'Oral practice set not found'; end if;
  if target_set.status in ('published', 'archived') then raise exception 'Published oral questions must be corrected with a revision'; end if;
  next_status := case when target_set.status = 'review' then 'review'::public.question_status else 'draft'::public.question_status end;
  if nullif(requested_question->>'id', '') is not null then
    requested_id := (requested_question->>'id')::uuid;
    select * into existing from public.oral_questions where id = requested_id and practice_set_id = target_set.id for update;
    if not found then raise exception 'Oral question not found in this practice set'; end if;
    if existing.status in ('published', 'archived') or exists (select 1 from public.oral_responses where question_id = existing.id) then raise exception 'This oral question has history and must be corrected with a revision'; end if;
  end if;
  if exists (select 1 from public.oral_questions q where q.practice_set_id = target_set.id and q.status <> 'archived' and q.batch_position = requested_position and q.id is distinct from requested_id) then raise exception 'Another question already uses position %', requested_position; end if;
  if exists (select 1 from public.oral_questions q where q.practice_set_id = target_set.id and q.status <> 'archived' and lower(regexp_replace(btrim(q.question_text), '\\s+', ' ', 'g')) = lower(regexp_replace(requested_text, '\\s+', ' ', 'g')) and q.id is distinct from requested_id) then raise exception 'This question already exists in the practice set'; end if;
  if requested_id is null then
    insert into public.oral_questions (exam_pack_id, subject_id, practice_set_id, difficulty, question_text, model_answer, key_points, reference_note, source_note, status, batch_position, created_by, updated_by)
    values (target_set.exam_pack_id, target_set.subject_id, target_set.id,
      coalesce(requested_question->>'difficulty', 'medium')::public.difficulty_level, requested_text,
      btrim(requested_question->>'model_answer'), array(select btrim(value) from jsonb_array_elements_text(requested_question->'key_points') value),
      btrim(coalesce(requested_question->>'reference_note', '')), coalesce(nullif(btrim(coalesce(requested_question->>'source_note', '')), ''), 'Admin content manager'),
      next_status, requested_position, auth.uid(), auth.uid()) returning * into saved;
  else
    update public.oral_questions set batch_position = requested_position,
      difficulty = coalesce(requested_question->>'difficulty', 'medium')::public.difficulty_level,
      question_text = requested_text, model_answer = btrim(requested_question->>'model_answer'),
      key_points = array(select btrim(value) from jsonb_array_elements_text(requested_question->'key_points') value),
      reference_note = btrim(coalesce(requested_question->>'reference_note', '')),
      source_note = coalesce(nullif(btrim(coalesce(requested_question->>'source_note', '')), ''), source_note),
      status = next_status, updated_by = auth.uid() where id = requested_id returning * into saved;
  end if;
  perform public.admin_write_audit(case when requested_id is null then 'CREATE' else 'UPDATE' end, 'oral_question', saved.id,
    jsonb_build_object('practice_set_id', saved.practice_set_id, 'batch_position', saved.batch_position));
  return to_jsonb(saved);
end;
$$;

create or replace function public.admin_create_oral_question_revision(requested_question jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare original public.oral_questions%rowtype; revised public.oral_questions%rowtype;
begin
  perform public.admin_assert_access(); perform public.admin_validate_oral_question_payload(requested_question);
  select * into original from public.oral_questions where id = (requested_question->>'id')::uuid for update;
  if not found or original.status <> 'published' then raise exception 'Only a published oral question can be corrected'; end if;
  if exists (select 1 from public.oral_questions where supersedes_question_id = original.id and status <> 'archived') then raise exception 'A correction for this question is already awaiting publication'; end if;
  insert into public.oral_questions (exam_pack_id, subject_id, practice_set_id, difficulty, question_text, model_answer, key_points, reference_note, source_note, status, batch_position, supersedes_question_id, revision_number, created_by, updated_by)
  values (original.exam_pack_id, original.subject_id, original.practice_set_id,
    coalesce(requested_question->>'difficulty', original.difficulty::text)::public.difficulty_level,
    btrim(requested_question->>'question_text'), btrim(requested_question->>'model_answer'),
    array(select btrim(value) from jsonb_array_elements_text(requested_question->'key_points') value),
    btrim(coalesce(requested_question->>'reference_note', '')),
    coalesce(nullif(btrim(coalesce(requested_question->>'source_note', '')), ''), original.source_note),
    'review', original.batch_position, original.id, original.revision_number + 1, auth.uid(), auth.uid()) returning * into revised;
  perform public.admin_write_audit('CREATE_REVISION', 'oral_question', revised.id, jsonb_build_object('supersedes_question_id', original.id));
  return to_jsonb(revised);
end;
$$;

create or replace function public.admin_update_oral_question_revision(requested_question jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare revised public.oral_questions%rowtype;
begin
  perform public.admin_assert_access(); perform public.admin_validate_oral_question_payload(requested_question);
  select * into revised from public.oral_questions where id = (requested_question->>'id')::uuid for update;
  if not found or revised.supersedes_question_id is null or revised.status not in ('draft', 'review') then raise exception 'Pending oral question correction not found'; end if;
  update public.oral_questions set difficulty = coalesce(requested_question->>'difficulty', revised.difficulty::text)::public.difficulty_level,
    question_text = btrim(requested_question->>'question_text'), model_answer = btrim(requested_question->>'model_answer'),
    key_points = array(select btrim(value) from jsonb_array_elements_text(requested_question->'key_points') value),
    reference_note = btrim(coalesce(requested_question->>'reference_note', '')),
    source_note = coalesce(nullif(btrim(coalesce(requested_question->>'source_note', '')), ''), revised.source_note),
    status = 'review', updated_by = auth.uid() where id = revised.id returning * into revised;
  perform public.admin_write_audit('UPDATE_REVISION', 'oral_question', revised.id, jsonb_build_object('supersedes_question_id', revised.supersedes_question_id));
  return to_jsonb(revised);
end;
$$;

create or replace function public.admin_publish_oral_question_revision(requested_question_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare revised public.oral_questions%rowtype; original public.oral_questions%rowtype;
begin
  perform public.admin_assert_access();
  select * into revised from public.oral_questions where id = requested_question_id for update;
  if not found or revised.supersedes_question_id is null or revised.status <> 'review' then raise exception 'Pending oral question correction not found'; end if;
  select * into original from public.oral_questions where id = revised.supersedes_question_id for update;
  if not found or original.status <> 'published' then raise exception 'The original published oral question is unavailable'; end if;
  perform public.admin_validate_oral_question_payload(to_jsonb(revised));
  if exists (select 1 from public.oral_questions q where q.practice_set_id = revised.practice_set_id and q.status = 'published' and q.id <> original.id and lower(regexp_replace(btrim(q.question_text), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(revised.question_text), '\\s+', ' ', 'g'))) then raise exception 'This correction duplicates another published question in the practice set'; end if;
  update public.oral_questions set status = 'archived', updated_by = auth.uid() where id = original.id;
  update public.oral_questions set status = 'published', updated_by = auth.uid() where id = revised.id returning * into revised;
  perform public.admin_write_audit('PUBLISH_REVISION', 'oral_question', revised.id, jsonb_build_object('archived_question_id', original.id));
  return to_jsonb(revised);
end;
$$;

create or replace function public.admin_archive_oral_question(requested_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare target public.oral_questions%rowtype;
begin
  perform public.admin_assert_access(); select * into target from public.oral_questions where id = requested_question_id for update;
  if not found then raise exception 'Oral question not found'; end if;
  if target.status = 'published' then raise exception 'Replace a published oral question or archive its entire practice set'; end if;
  update public.oral_questions set status = 'archived', updated_by = auth.uid() where id = target.id;
  perform public.admin_write_audit('ARCHIVE', 'oral_question', target.id, jsonb_build_object('practice_set_id', target.practice_set_id, 'batch_position', target.batch_position));
  return true;
end;
$$;

create or replace function public.admin_delete_draft_oral_question(requested_question_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare target public.oral_questions%rowtype;
begin
  perform public.admin_assert_access(); select * into target from public.oral_questions where id = requested_question_id for update;
  if not found then raise exception 'Oral question not found'; end if;
  if target.status not in ('draft', 'review') or exists (select 1 from public.oral_responses where question_id = target.id) then raise exception 'Only an unused draft or review oral question can be permanently deleted'; end if;
  perform public.admin_write_audit('DELETE', 'oral_question', target.id, jsonb_build_object('practice_set_id', target.practice_set_id, 'batch_position', target.batch_position, 'status', target.status));
  delete from public.oral_questions where id = target.id; return true;
end;
$$;

create or replace function public.admin_import_oral_questions(
  requested_practice_set_id uuid,
  requested_questions jsonb,
  requested_file_name text default null,
  requested_file_checksum text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare target_set public.practice_sets%rowtype; item jsonb; item_number integer := 0; base_position integer := 0; requested_position integer; imported_count integer := 0;
  normalized_checksum text := lower(btrim(coalesce(requested_file_checksum, ''))); normalized_file_name text := left(btrim(coalesce(requested_file_name, '')), 255);
begin
  perform public.admin_assert_access();
  if jsonb_typeof(requested_questions) <> 'array' or jsonb_array_length(requested_questions) < 1 or jsonb_array_length(requested_questions) > 200 then raise exception 'Import between 1 and 200 questions at a time'; end if;
  if normalized_checksum <> '' and normalized_checksum !~ '^[a-f0-9]{64}$' then raise exception 'The import file checksum is invalid'; end if;
  select * into target_set from public.practice_sets where id = requested_practice_set_id for update;
  if not found or target_set.practice_type <> 'oral' then raise exception 'Oral practice set not found'; end if;
  if target_set.status in ('published', 'archived') then raise exception 'Questions can only be imported into a draft or review practice set'; end if;
  if normalized_checksum <> '' and exists (select 1 from public.admin_audit_logs where action = 'IMPORT' and entity_type = 'practice_set' and entity_id = target_set.id and metadata->>'file_checksum' = normalized_checksum) then raise exception 'This file has already been imported into this practice set'; end if;
  select coalesce(max(batch_position), 0) into base_position from public.oral_questions where practice_set_id = target_set.id and status <> 'archived';
  for item in select value from jsonb_array_elements(requested_questions) loop
    item_number := item_number + 1;
    if nullif(item->>'batch_position', '') is null then item := jsonb_set(item, '{batch_position}', to_jsonb(base_position + item_number), true); end if;
    item := jsonb_set(item, '{practice_set_id}', to_jsonb(target_set.id::text), true);
    perform public.admin_validate_oral_question_payload(item); requested_position := (item->>'batch_position')::integer;
    if exists (select 1 from public.oral_questions q where q.practice_set_id = target_set.id and q.status <> 'archived' and q.batch_position = requested_position) then raise exception 'Import row % uses an existing question position %', item_number, requested_position; end if;
    if exists (select 1 from public.oral_questions q where q.practice_set_id = target_set.id and q.status <> 'archived' and lower(regexp_replace(btrim(q.question_text), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(item->>'question_text'), '\\s+', ' ', 'g'))) then raise exception 'Import row % duplicates an existing question', item_number; end if;
    insert into public.oral_questions (exam_pack_id, subject_id, practice_set_id, difficulty, question_text, model_answer, key_points, reference_note, source_note, status, batch_position, created_by, updated_by)
    values (target_set.exam_pack_id, target_set.subject_id, target_set.id,
      coalesce(item->>'difficulty', 'medium')::public.difficulty_level, btrim(item->>'question_text'), btrim(item->>'model_answer'),
      array(select btrim(value) from jsonb_array_elements_text(item->'key_points') value), btrim(coalesce(item->>'reference_note', '')),
      coalesce(nullif(btrim(coalesce(item->>'source_note', '')), ''), 'Admin bulk import'),
      case when target_set.status = 'review' then 'review'::public.question_status else 'draft'::public.question_status end,
      requested_position, auth.uid(), auth.uid());
    imported_count := imported_count + 1;
  end loop;
  perform public.admin_write_audit('IMPORT', 'practice_set', target_set.id,
    jsonb_strip_nulls(jsonb_build_object('question_count', imported_count, 'practice_type', 'oral',
      'file_name', nullif(normalized_file_name, ''), 'file_checksum', nullif(normalized_checksum, ''))));
  return jsonb_build_object('imported_count', imported_count, 'file_checksum', nullif(normalized_checksum, ''));
end;
$$;

-- Late requests may advance a timed-out question, but may not replace its last autosave.
create or replace function public.advance_oral_attempt(
  requested_attempt_id uuid,
  requested_question_id uuid,
  requested_response_text text default '',
  requested_reason text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate(); v_attempt public.oral_attempts; v_response public.oral_responses;
  v_now timestamptz := clock_timestamp(); v_text text := coalesce(requested_response_text, ''); v_final_status public.oral_response_status;
begin
  if requested_reason not in ('manual', 'timeout') then raise exception 'Invalid oral practice advance reason'; end if;
  if length(v_text) > 20000 then raise exception 'Your answer is too long'; end if;
  select * into v_attempt from public.oral_attempts where id = requested_attempt_id and user_id = v_user_id for update;
  if v_attempt.id is null then raise exception 'Oral practice attempt was not found'; end if;
  if v_attempt.status <> 'active' then return public.build_oral_attempt_payload(v_attempt.id); end if;
  select * into v_response from public.oral_responses where attempt_id = v_attempt.id and display_order = v_attempt.current_position and status = 'active' for update;
  if v_response.id is null then raise exception 'The current oral question is unavailable'; end if;
  if v_response.question_id <> requested_question_id then return public.build_oral_attempt_payload(v_attempt.id); end if;
  if v_now >= v_response.deadline_at then
    v_final_status := 'timed_out'; v_text := v_response.response_text;
  elsif length(btrim(v_text)) = 0 then v_final_status := 'skipped';
  else v_final_status := 'answered'; end if;
  update public.oral_responses set response_text = v_text, status = v_final_status, locked_at = v_now, saved_at = v_now,
    time_spent_seconds = least(v_attempt.seconds_per_question, greatest(0, floor(extract(epoch from (v_now - v_response.started_at)))::integer)) where id = v_response.id;
  if v_attempt.current_position >= v_attempt.total_questions then
    update public.oral_attempts set status = 'completed', completed_at = v_now where id = v_attempt.id;
  else
    update public.oral_attempts set current_position = current_position + 1 where id = v_attempt.id;
    update public.oral_responses set status = 'active', started_at = v_now,
      deadline_at = v_now + make_interval(secs => v_attempt.seconds_per_question)
    where attempt_id = v_attempt.id and display_order = v_attempt.current_position + 1 and status = 'pending';
    if not found then raise exception 'The next oral question is unavailable'; end if;
  end if;
  return public.build_oral_attempt_payload(v_attempt.id);
end;
$$;

revoke all on function public.get_admin_content_modules_v2() from public, anon;
revoke all on function public.get_admin_practice_sets_v2(uuid) from public, anon;
revoke all on function public.admin_get_practice_set_validation_v2(uuid) from public, anon;
revoke all on function public.admin_create_module_typed(text,text,integer,integer,text,integer,integer,text,text) from public, anon;
revoke all on function public.admin_update_module_v2(uuid,text,integer,integer,text,integer,integer,text,boolean) from public, anon;
revoke all on function public.admin_transition_practice_set_v2(uuid,text) from public, anon;
revoke all on function public.admin_delete_empty_practice_set_v2(uuid) from public, anon;
revoke all on function public.admin_delete_empty_module_v2(uuid) from public, anon;
revoke all on function public.admin_validate_oral_question_payload(jsonb) from public, anon, authenticated;
revoke all on function public.admin_save_oral_question(jsonb) from public, anon;
revoke all on function public.admin_create_oral_question_revision(jsonb) from public, anon;
revoke all on function public.admin_update_oral_question_revision(jsonb) from public, anon;
revoke all on function public.admin_publish_oral_question_revision(uuid) from public, anon;
revoke all on function public.admin_archive_oral_question(uuid) from public, anon;
revoke all on function public.admin_delete_draft_oral_question(uuid) from public, anon;
revoke all on function public.admin_import_oral_questions(uuid,jsonb,text,text) from public, anon;

grant execute on function public.get_admin_content_modules_v2() to authenticated;
grant execute on function public.get_admin_practice_sets_v2(uuid) to authenticated;
grant execute on function public.admin_get_practice_set_validation_v2(uuid) to authenticated;
grant execute on function public.admin_create_module_typed(text,text,integer,integer,text,integer,integer,text,text) to authenticated;
grant execute on function public.admin_update_module_v2(uuid,text,integer,integer,text,integer,integer,text,boolean) to authenticated;
grant execute on function public.admin_transition_practice_set_v2(uuid,text) to authenticated;
grant execute on function public.admin_delete_empty_practice_set_v2(uuid) to authenticated;
grant execute on function public.admin_delete_empty_module_v2(uuid) to authenticated;
grant execute on function public.admin_save_oral_question(jsonb) to authenticated;
grant execute on function public.admin_create_oral_question_revision(jsonb) to authenticated;
grant execute on function public.admin_update_oral_question_revision(jsonb) to authenticated;
grant execute on function public.admin_publish_oral_question_revision(uuid) to authenticated;
grant execute on function public.admin_archive_oral_question(uuid) to authenticated;
grant execute on function public.admin_delete_draft_oral_question(uuid) to authenticated;
grant execute on function public.admin_import_oral_questions(uuid,jsonb,text,text) to authenticated;

revoke all on function public.advance_oral_attempt(uuid,uuid,text,text) from public, anon;
grant execute on function public.advance_oral_attempt(uuid,uuid,text,text) to authenticated;
