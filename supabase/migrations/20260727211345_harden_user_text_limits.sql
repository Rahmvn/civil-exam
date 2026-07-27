-- Launch hardening for user-controlled text fields.
-- OWASP guidance is to enforce size and format limits server-side, not only
-- in the browser. These constraints keep support/admin screens and autosave
-- paths resilient against oversized or noisy user input.

alter table public.profiles
  drop constraint if exists profiles_phone_number_safe,
  drop constraint if exists profiles_state_code_safe,
  drop constraint if exists profiles_organization_name_safe;

alter table public.profiles
  add constraint profiles_phone_number_safe check (
    phone_number is null
    or (
      char_length(btrim(phone_number)) between 7 and 20
      and btrim(phone_number) ~ '^[0-9+() -]+$'
    )
  ),
  add constraint profiles_state_code_safe check (
    state_code is null
    or state_code in (
      'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
      'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti',
      'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano',
      'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
      'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
      'Taraba', 'Yobe', 'Zamfara'
    )
  ),
  add constraint profiles_organization_name_safe check (
    organization_name is null
    or (
      char_length(btrim(organization_name)) between 2 and 120
      and organization_name !~ '[[:cntrl:]]'
    )
  );

alter table public.oral_responses
  drop constraint if exists oral_responses_response_text_check,
  drop constraint if exists oral_responses_response_text_safe;

alter table public.oral_responses
  add constraint oral_responses_response_text_safe
  check (char_length(response_text) <= 5000) not valid;

create or replace function public.advance_oral_attempt(
  requested_attempt_id uuid,
  requested_question_id uuid,
  requested_response_text text default '',
  requested_reason text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt public.oral_attempts;
  v_response public.oral_responses;
  v_now timestamptz := clock_timestamp();
  v_text text := coalesce(requested_response_text, '');
  v_final_status public.oral_response_status;
begin
  if requested_reason not in ('manual', 'timeout') then
    raise exception 'Invalid oral practice advance reason';
  end if;

  if char_length(v_text) > 5000 then
    raise exception 'Your answer is too long';
  end if;

  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id
  for update;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  if v_attempt.status <> 'active' then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  select * into v_response
  from public.oral_responses
  where attempt_id = v_attempt.id
    and display_order = v_attempt.current_position
    and status = 'active'
  for update;

  if v_response.id is null then
    raise exception 'The current oral question is unavailable';
  end if;

  -- A repeated Next or timeout request returns the already-advanced state.
  if v_response.question_id <> requested_question_id then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  v_final_status := case
    when v_now >= v_response.deadline_at then 'timed_out'::public.oral_response_status
    when length(btrim(v_text)) = 0 then 'skipped'::public.oral_response_status
    else 'answered'::public.oral_response_status
  end;

  update public.oral_responses
  set response_text = case
        when v_final_status = 'timed_out'::public.oral_response_status then v_response.response_text
        else v_text
      end,
      status = v_final_status,
      locked_at = v_now,
      saved_at = v_now,
      time_spent_seconds = least(
        v_attempt.seconds_per_question,
        greatest(0, floor(extract(epoch from (v_now - v_response.started_at)))::integer)
      )
  where id = v_response.id;

  if v_attempt.current_position >= v_attempt.total_questions then
    update public.oral_attempts
    set status = 'completed',
        completed_at = v_now
    where id = v_attempt.id;
  else
    update public.oral_attempts
    set current_position = current_position + 1
    where id = v_attempt.id;

    update public.oral_responses
    set status = 'active',
        started_at = v_now,
        deadline_at = v_now + make_interval(secs => v_attempt.seconds_per_question)
    where attempt_id = v_attempt.id
      and display_order = v_attempt.current_position + 1
      and status = 'pending';

    if not found then
      raise exception 'The next oral question is unavailable';
    end if;
  end if;

  return public.build_oral_attempt_payload(v_attempt.id);
end;
$$;

create or replace function public.save_oral_response_draft(
  requested_attempt_id uuid,
  requested_question_id uuid,
  requested_response_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt public.oral_attempts;
  v_response public.oral_responses;
  v_text text := coalesce(requested_response_text, '');
  v_now timestamptz := clock_timestamp();
begin
  if char_length(v_text) > 5000 then
    raise exception 'Your answer is too long';
  end if;

  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id
  for update;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  if v_attempt.status <> 'active' then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  select * into v_response
  from public.oral_responses
  where attempt_id = v_attempt.id
    and display_order = v_attempt.current_position
    and status = 'active'
  for update;

  if v_response.question_id <> requested_question_id then
    return public.build_oral_attempt_payload(v_attempt.id);
  end if;

  if v_now >= v_response.deadline_at then
    return public.advance_oral_attempt(
      v_attempt.id,
      v_response.question_id,
      v_response.response_text,
      'timeout'
    );
  end if;

  update public.oral_responses
  set response_text = v_text,
      saved_at = v_now
  where id = v_response.id;

  return public.build_oral_attempt_payload(v_attempt.id);
end;
$$;
