-- Read a known objective session without creating or replacing one. Route
-- mounting and browser history must never behave like a Start action.
create or replace function public.get_objective_practice_session(
  requested_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.objective_practice_sessions%rowtype;
  v_subject_slug text;
  v_questions jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select session.*
  into v_session
  from public.objective_practice_sessions as session
  where session.id = requested_session_id
    and session.user_id = v_user_id;

  if not found then
    raise exception 'This practice session could not be found';
  end if;

  select subject.slug into v_subject_slug
  from public.subjects as subject
  where subject.id = v_session.subject_id;

  if v_session.status = 'active'
     and v_session.deadline_at + interval '2 minutes' >= clock_timestamp() then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', question.id,
        'practice_session_id', v_session.id,
        'practice_set_id', v_session.practice_set_id,
        'subject_id', question.subject_id,
        'subject_name', subject.name,
        'subject_slug', subject.slug,
        'service_level', question.service_level,
        'difficulty', question.difficulty,
        'question_text', question.question_text,
        'option_a', question.option_a,
        'option_b', question.option_b,
        'option_c', question.option_c,
        'option_d', question.option_d,
        'correct_option', null,
        'explanation', null,
        'reference_note', question.reference_note,
        'batch_number', v_session.batch_number,
        'batch_size', cardinality(v_session.question_ids),
        'pass_mark_percent', v_session.pass_mark_percent,
        'is_free_attempt', v_session.is_free_attempt,
        'retry_number', v_session.retry_number,
        'display_order', question_order.ordinality
      ) order by question_order.ordinality
    ), '[]'::jsonb)
    into v_questions
    from unnest(v_session.question_ids) with ordinality as question_order(question_id, ordinality)
    join public.questions as question on question.id = question_order.question_id
    join public.subjects as subject on subject.id = question.subject_id;
  end if;

  return jsonb_build_object(
    'practice_session_id', v_session.id,
    'status', case
      when v_session.status = 'active'
        and v_session.deadline_at + interval '2 minutes' < clock_timestamp()
      then 'expired'
      else v_session.status
    end,
    'subject_slug', v_subject_slug,
    'batch_number', v_session.batch_number,
    'questions', v_questions,
    'time_limit_seconds', v_session.time_limit_seconds,
    'started_at', v_session.started_at,
    'deadline_at', v_session.deadline_at,
    'server_now', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_objective_practice_session(uuid) from public, anon;
grant execute on function public.get_objective_practice_session(uuid) to authenticated;
