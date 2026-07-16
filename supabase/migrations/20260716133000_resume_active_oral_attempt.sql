-- Resume the existing active oral attempt even when the candidate enters from
-- another oral set. The one-active-attempt constraint still prevents parallel
-- oral sessions; this only turns the conflict into a recoverable resume flow.

create or replace function public.start_or_resume_oral_attempt(
  requested_subject_slug text,
  requested_set_number integer default 1,
  requested_seconds_per_question integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_pack public.exam_packs;
  v_subject public.subjects;
  v_set public.practice_sets;
  v_active_attempt public.oral_attempts;
  v_attempt_id uuid;
  v_question_count integer;
  v_is_paid boolean;
  v_selected_free_subject_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if requested_seconds_per_question not in (180, 300) then
    raise exception 'Choose either 3 or 5 minutes per question';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':oral-practice', 0));

  select * into v_pack
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if v_pack.id is null then
    raise exception 'No active exam pack is configured';
  end if;

  select * into v_subject
  from public.subjects
  where slug = requested_subject_slug
    and is_active = true
    and practice_type = 'oral'
  limit 1;

  if v_subject.id is null then
    raise exception 'This oral practice module is unavailable';
  end if;

  select * into v_set
  from public.practice_sets
  where exam_pack_id = v_pack.id
    and subject_id = v_subject.id
    and set_number = greatest(coalesce(requested_set_number, 1), 1)
    and practice_type = 'oral'
    and status = 'published'
  limit 1;

  if v_set.id is null then
    raise exception 'This oral practice set is unavailable';
  end if;

  select * into v_active_attempt
  from public.oral_attempts
  where user_id = v_user_id
    and status = 'active'
  order by started_at desc
  limit 1
  for update;

  if v_active_attempt.id is not null then
    return public.get_oral_attempt_state(v_active_attempt.id);
  end if;

  select count(*)::integer into v_question_count
  from public.oral_questions
  where practice_set_id = v_set.id
    and status = 'published';

  if v_question_count = 0 or v_question_count <> v_set.expected_question_count then
    raise exception 'This oral practice set is not ready yet';
  end if;

  v_is_paid := public.has_active_module_entitlement(v_pack.id, v_subject.id);

  if not v_is_paid then
    select subject_id into v_selected_free_subject_id
    from public.user_module_progress
    where user_id = v_user_id
      and exam_pack_id = v_pack.id
      and selected_for_free_access = true
    limit 1;

    if v_selected_free_subject_id is not null and v_selected_free_subject_id <> v_subject.id then
      raise exception 'Your free practice is already assigned to another module';
    end if;

    if v_set.set_number <> 1 then
      raise exception 'Unlock this module to use more oral practice sets';
    end if;

    if exists (
      select 1
      from public.oral_attempts
      where user_id = v_user_id
        and exam_pack_id = v_pack.id
        and subject_id = v_subject.id
        and practice_set_id = v_set.id
        and status = 'completed'
    ) then
      raise exception 'Your free oral practice is complete. Unlock this module to practise again';
    end if;

    insert into public.user_module_progress (
      user_id,
      exam_pack_id,
      subject_id,
      current_batch_number,
      highest_unlocked_batch_number,
      selected_for_free_access
    ) values (
      v_user_id,
      v_pack.id,
      v_subject.id,
      1,
      1,
      true
    )
    on conflict (user_id, exam_pack_id, subject_id)
    do update set selected_for_free_access = true, updated_at = now();
  end if;

  insert into public.oral_attempts (
    user_id,
    exam_pack_id,
    subject_id,
    practice_set_id,
    seconds_per_question,
    current_position,
    total_questions
  ) values (
    v_user_id,
    v_pack.id,
    v_subject.id,
    v_set.id,
    requested_seconds_per_question,
    1,
    v_question_count
  )
  returning id into v_attempt_id;

  insert into public.oral_responses (
    attempt_id,
    user_id,
    question_id,
    display_order,
    question_text_snapshot,
    model_answer_snapshot,
    key_points_snapshot,
    reference_note_snapshot,
    status,
    started_at,
    deadline_at
  )
  select
    v_attempt_id,
    v_user_id,
    q.id,
    row_number() over (order by q.batch_position, q.id)::integer,
    q.question_text,
    q.model_answer,
    q.key_points,
    q.reference_note,
    case when row_number() over (order by q.batch_position, q.id) = 1
      then 'active'::public.oral_response_status
      else 'pending'::public.oral_response_status
    end,
    case when row_number() over (order by q.batch_position, q.id) = 1 then v_now else null end,
    case when row_number() over (order by q.batch_position, q.id) = 1
      then v_now + make_interval(secs => requested_seconds_per_question)
      else null
    end
  from public.oral_questions as q
  where q.practice_set_id = v_set.id
    and q.status = 'published'
  order by q.batch_position, q.id;

  return public.build_oral_attempt_payload(v_attempt_id);
end;
$$;

revoke all on function public.start_or_resume_oral_attempt(text, integer, integer) from public, anon;
grant execute on function public.start_or_resume_oral_attempt(text, integer, integer) to authenticated;
