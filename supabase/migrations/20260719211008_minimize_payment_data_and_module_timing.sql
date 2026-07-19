-- Keep only payment fields needed for reconciliation and support. Sensitive or
-- masked payment-instrument data belongs with the payment processor.
update public.payment_orders
set provider_payload = case
  when jsonb_typeof(provider_payload -> 'data') = 'object' then
    jsonb_set(
      provider_payload - 'authorization' - 'customer' - 'card',
      '{data}',
      (provider_payload -> 'data') - 'authorization' - 'customer' - 'card' - 'plan' - 'subaccount',
      true
    )
  else provider_payload - 'authorization' - 'customer' - 'card' - 'plan' - 'subaccount'
end
where provider_payload is not null;

update public.entitlements
set metadata = case
  when jsonb_typeof(metadata -> 'data') = 'object' then
    jsonb_set(
      metadata - 'authorization' - 'customer' - 'card',
      '{data}',
      (metadata -> 'data') - 'authorization' - 'customer' - 'card' - 'plan' - 'subaccount',
      true
    )
  else metadata - 'authorization' - 'customer' - 'card' - 'plan' - 'subaccount'
end
where metadata is not null;

create or replace function public.sanitize_stored_payment_payload(payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  cleaned jsonb := '{}'::jsonb;
  entry record;
begin
  if payload is null then return '{}'::jsonb; end if;

  if jsonb_typeof(payload) = 'array' then
    select coalesce(jsonb_agg(public.sanitize_stored_payment_payload(value)), '[]'::jsonb)
    into cleaned
    from jsonb_array_elements(payload);
    return cleaned;
  end if;

  if jsonb_typeof(payload) <> 'object' then return payload; end if;

  for entry in select key, value from jsonb_each(payload)
  loop
    if lower(entry.key) = any(array[
      'authorization', 'customer', 'card', 'plan', 'subaccount',
      'number', 'card_number', 'cvv', 'cvc', 'pin', 'security_code',
      'expiry', 'expiry_month', 'expiry_year', 'exp_month', 'exp_year',
      'bin', 'last4', 'authorization_code', 'signature'
    ]) then
      continue;
    end if;
    cleaned := cleaned || jsonb_build_object(
      entry.key,
      public.sanitize_stored_payment_payload(entry.value)
    );
  end loop;

  if jsonb_typeof(cleaned) <> 'object' then
    return '{}'::jsonb;
  end if;
  return cleaned;
end;
$$;

create or replace function public.sanitize_payment_order_payload_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.provider_payload := public.sanitize_stored_payment_payload(new.provider_payload);
  return new;
end;
$$;

create or replace function public.sanitize_legacy_entitlement_payload_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.metadata := public.sanitize_stored_payment_payload(new.metadata);
  return new;
end;
$$;

update public.payment_orders
set provider_payload = public.sanitize_stored_payment_payload(provider_payload)
where provider_payload is not null;

update public.entitlements
set metadata = public.sanitize_stored_payment_payload(metadata)
where metadata is not null;

drop trigger if exists payment_orders_sanitize_provider_payload on public.payment_orders;
create trigger payment_orders_sanitize_provider_payload
before insert or update of provider_payload on public.payment_orders
for each row execute function public.sanitize_payment_order_payload_trigger();

drop trigger if exists entitlements_sanitize_provider_payload on public.entitlements;
create trigger entitlements_sanitize_provider_payload
before insert or update of metadata on public.entitlements
for each row execute function public.sanitize_legacy_entitlement_payload_trigger();

alter table public.subjects
  add column if not exists objective_time_limit_minutes integer not null default 30,
  add column if not exists oral_allowed_durations_seconds integer[] not null default array[180, 300]::integer[];

alter table public.subjects
  drop constraint if exists subjects_objective_time_limit_valid,
  add constraint subjects_objective_time_limit_valid
    check (objective_time_limit_minutes between 5 and 180),
  drop constraint if exists subjects_oral_durations_valid,
  add constraint subjects_oral_durations_valid
    check (
      oral_allowed_durations_seconds = array[180]::integer[]
      or oral_allowed_durations_seconds = array[300]::integer[]
      or oral_allowed_durations_seconds = array[180, 300]::integer[]
    );

alter table public.objective_practice_sessions
  add column if not exists time_limit_seconds integer,
  add column if not exists deadline_at timestamptz;

-- Sessions created before this migration keep the former 30-minute behavior.
update public.objective_practice_sessions
set time_limit_seconds = coalesce(time_limit_seconds, 1800),
    deadline_at = coalesce(deadline_at, started_at + interval '30 minutes');

alter table public.objective_practice_sessions
  alter column time_limit_seconds set default 1800,
  alter column time_limit_seconds set not null,
  alter column deadline_at set default (now() + interval '30 minutes'),
  alter column deadline_at set not null,
  drop constraint if exists objective_practice_session_time_limit_valid,
  add constraint objective_practice_session_time_limit_valid
    check (time_limit_seconds between 300 and 10800),
  drop constraint if exists objective_practice_session_deadline_valid,
  add constraint objective_practice_session_deadline_valid
    check (deadline_at = started_at + make_interval(secs => time_limit_seconds));

create or replace function public.apply_objective_session_timing()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  configured_minutes integer;
begin
  select objective_time_limit_minutes into configured_minutes
  from public.subjects
  where id = new.subject_id;

  if configured_minutes is null then
    raise exception 'The module practice duration is not configured';
  end if;

  new.time_limit_seconds := configured_minutes * 60;
  new.deadline_at := new.started_at + make_interval(mins => configured_minutes);
  return new;
end;
$$;

drop trigger if exists objective_sessions_apply_timing on public.objective_practice_sessions;
create trigger objective_sessions_apply_timing
before insert on public.objective_practice_sessions
for each row execute function public.apply_objective_session_timing();

create or replace function public.start_objective_practice_session_v2(
  requested_subject_id uuid default null,
  requested_subject_slug text default null,
  requested_batch_number integer default null,
  requested_allow_free_lock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  session_payload jsonb;
  session_record public.objective_practice_sessions%rowtype;
begin
  session_payload := public.start_objective_practice_session(
    requested_subject_id,
    requested_subject_slug,
    requested_batch_number,
    requested_allow_free_lock
  );

  select * into session_record
  from public.objective_practice_sessions
  where id = (session_payload ->> 'practice_session_id')::uuid
    and user_id = auth.uid();

  if not found then
    raise exception 'This practice session could not be prepared';
  end if;

  return session_payload || jsonb_build_object(
    'time_limit_seconds', session_record.time_limit_seconds,
    'started_at', session_record.started_at,
    'deadline_at', session_record.deadline_at,
    'server_now', now()
  );
end;
$$;

create or replace function public.enforce_objective_attempt_deadline()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  session_deadline timestamptz;
begin
  if new.practice_set_id is null or new.mode <> 'timed_mock' then
    return new;
  end if;

  select deadline_at into session_deadline
  from public.objective_practice_sessions
  where user_id = new.user_id
    and practice_set_id = new.practice_set_id
    and status = 'active'
  order by started_at desc
  limit 1;

  -- A short transport grace lets an on-time browser submission reach the server.
  if session_deadline is not null and now() > session_deadline + interval '2 minutes' then
    raise exception 'The time for this practice session has ended. Start a new attempt.';
  end if;

  return new;
end;
$$;

drop trigger if exists attempts_enforce_objective_deadline on public.attempts;
create trigger attempts_enforce_objective_deadline
before insert on public.attempts
for each row execute function public.enforce_objective_attempt_deadline();

alter function public.start_or_resume_oral_attempt(text, integer, integer)
  rename to start_or_resume_oral_attempt_legacy;

create or replace function public.start_or_resume_oral_attempt_v2(
  requested_subject_slug text,
  requested_set_number integer default 1,
  requested_seconds_per_question integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed_durations integer[];
begin
  select oral_allowed_durations_seconds into allowed_durations
  from public.subjects
  where slug = requested_subject_slug
    and practice_type = 'oral';

  if allowed_durations is null then
    raise exception 'This oral practice module is unavailable';
  end if;
  if not (requested_seconds_per_question = any(allowed_durations)) then
    raise exception 'Choose one of the response times configured for this module';
  end if;

  return public.start_or_resume_oral_attempt_legacy(
    requested_subject_slug,
    requested_set_number,
    requested_seconds_per_question
  );
end;
$$;

-- Keep the former RPC name safe during a database-first rolling deployment.
create or replace function public.start_or_resume_oral_attempt(
  requested_subject_slug text,
  requested_set_number integer default 1,
  requested_seconds_per_question integer default 180
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.start_or_resume_oral_attempt_v2(
    requested_subject_slug,
    requested_set_number,
    requested_seconds_per_question
  );
$$;

create or replace function public.admin_update_module_timing(
  requested_subject_id uuid,
  requested_objective_time_limit_minutes integer,
  requested_oral_allowed_durations_seconds integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_subject public.subjects%rowtype;
  normalized_oral_durations integer[];
  active_attempt_count integer;
begin
  perform public.admin_assert_access();

  select * into target_subject
  from public.subjects
  where id = requested_subject_id
  for update;
  if not found then raise exception 'Module not found'; end if;

  if requested_objective_time_limit_minutes not between 5 and 180 then
    raise exception 'Objective practice time must be between 5 and 180 minutes';
  end if;

  select array_agg(distinct duration order by duration)
  into normalized_oral_durations
  from unnest(coalesce(requested_oral_allowed_durations_seconds, array[]::integer[])) duration;

  if normalized_oral_durations is null
     or not (
       normalized_oral_durations = array[180]::integer[]
       or normalized_oral_durations = array[300]::integer[]
       or normalized_oral_durations = array[180, 300]::integer[]
     ) then
    raise exception 'Oral response time must allow 3 minutes, 5 minutes, or both';
  end if;

  select
    (select count(*) from public.objective_practice_sessions
      where subject_id = requested_subject_id and status = 'active')
    + (select count(*) from public.oral_attempts
      where subject_id = requested_subject_id and status = 'active')
  into active_attempt_count;

  update public.subjects
  set objective_time_limit_minutes = requested_objective_time_limit_minutes,
      oral_allowed_durations_seconds = normalized_oral_durations
  where id = requested_subject_id;

  perform public.admin_write_audit(
    'UPDATE_TIMING',
    'module',
    requested_subject_id,
    jsonb_build_object(
      'practice_type', target_subject.practice_type,
      'previous_objective_time_limit_minutes', target_subject.objective_time_limit_minutes,
      'objective_time_limit_minutes', requested_objective_time_limit_minutes,
      'previous_oral_allowed_durations_seconds', target_subject.oral_allowed_durations_seconds,
      'oral_allowed_durations_seconds', normalized_oral_durations,
      'active_attempt_count_unchanged', active_attempt_count
    )
  );

  return jsonb_build_object(
    'subject_id', requested_subject_id,
    'objective_time_limit_minutes', requested_objective_time_limit_minutes,
    'oral_allowed_durations_seconds', normalized_oral_durations,
    'active_attempt_count_unchanged', active_attempt_count
  );
end;
$$;

create or replace function public.admin_create_module_typed_v2(
  requested_name text,
  requested_slug text,
  requested_sort_order integer,
  requested_price_kobo integer,
  requested_currency text default 'NGN',
  requested_batch_size integer default null,
  requested_pass_mark_percent integer default 70,
  requested_lifecycle_status text default 'draft',
  requested_practice_type text default 'objective',
  requested_objective_time_limit_minutes integer default 30,
  requested_oral_allowed_durations_seconds integer[] default array[180, 300]::integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_module jsonb;
  timing_result jsonb;
begin
  created_module := public.admin_create_module_typed(
    requested_name,
    requested_slug,
    requested_sort_order,
    requested_price_kobo,
    requested_currency,
    requested_batch_size,
    requested_pass_mark_percent,
    requested_lifecycle_status,
    requested_practice_type
  );

  timing_result := public.admin_update_module_timing(
    (created_module ->> 'subject_id')::uuid,
    requested_objective_time_limit_minutes,
    requested_oral_allowed_durations_seconds
  );

  return created_module || timing_result;
end;
$$;

create or replace function public.admin_update_module_v3(
  requested_subject_id uuid,
  requested_name text,
  requested_sort_order integer,
  requested_price_kobo integer,
  requested_currency text,
  requested_batch_size integer,
  requested_pass_mark_percent integer,
  requested_lifecycle_status text,
  requested_available_for_purchase boolean,
  requested_objective_time_limit_minutes integer,
  requested_oral_allowed_durations_seconds integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_module jsonb;
  timing_result jsonb;
begin
  updated_module := public.admin_update_module_v2(
    requested_subject_id,
    requested_name,
    requested_sort_order,
    requested_price_kobo,
    requested_currency,
    requested_batch_size,
    requested_pass_mark_percent,
    requested_lifecycle_status,
    requested_available_for_purchase
  );

  timing_result := public.admin_update_module_timing(
    requested_subject_id,
    requested_objective_time_limit_minutes,
    requested_oral_allowed_durations_seconds
  );

  return updated_module || timing_result;
end;
$$;

revoke all on function public.apply_objective_session_timing() from public, anon, authenticated;
revoke all on function public.sanitize_stored_payment_payload(jsonb) from public, anon, authenticated;
revoke all on function public.sanitize_payment_order_payload_trigger() from public, anon, authenticated;
revoke all on function public.sanitize_legacy_entitlement_payload_trigger() from public, anon, authenticated;
revoke all on function public.enforce_objective_attempt_deadline() from public, anon, authenticated;
revoke all on function public.start_objective_practice_session_v2(uuid, text, integer, boolean) from public, anon;
revoke all on function public.start_or_resume_oral_attempt_v2(text, integer, integer) from public, anon;
revoke all on function public.start_or_resume_oral_attempt_legacy(text, integer, integer) from public, anon, authenticated;
revoke all on function public.start_or_resume_oral_attempt(text, integer, integer) from public, anon;
revoke all on function public.admin_update_module_timing(uuid, integer, integer[]) from public, anon;
revoke all on function public.admin_create_module_typed_v2(text, text, integer, integer, text, integer, integer, text, text, integer, integer[]) from public, anon;
revoke all on function public.admin_update_module_v3(uuid, text, integer, integer, text, integer, integer, text, boolean, integer, integer[]) from public, anon;
grant execute on function public.start_objective_practice_session_v2(uuid, text, integer, boolean) to authenticated;
grant execute on function public.start_or_resume_oral_attempt_v2(text, integer, integer) to authenticated;
grant execute on function public.start_or_resume_oral_attempt(text, integer, integer) to authenticated;
grant execute on function public.admin_update_module_timing(uuid, integer, integer[]) to authenticated;
grant execute on function public.admin_create_module_typed_v2(text, text, integer, integer, text, integer, integer, text, text, integer, integer[]) to authenticated;
grant execute on function public.admin_update_module_v3(uuid, text, integer, integer, text, integer, integer, text, boolean, integer, integer[]) to authenticated;
