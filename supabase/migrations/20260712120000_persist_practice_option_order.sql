alter table public.attempt_answers
  add column if not exists option_order text[] not null default array['A', 'B', 'C', 'D']::text[];

alter table public.attempt_answers
  drop constraint if exists attempt_answers_option_order_check;

alter table public.attempt_answers
  add constraint attempt_answers_option_order_check
  check (
    cardinality(option_order) = 4
    and option_order @> array['A', 'B', 'C', 'D']::text[]
  );

create or replace function public.submit_attempt(
  submitted_mode public.attempt_mode,
  submitted_subject_id uuid,
  submitted_answers jsonb,
  submitted_batch_number integer default null
)
returns table (
  attempt_id uuid,
  score integer,
  total_questions integer,
  review jsonb,
  batch_number integer,
  score_percent integer,
  passed boolean,
  retry_number integer,
  next_action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx record;
  v_attempt_id uuid;
  v_answer_row record;
  v_question_row public.questions;
  v_module_progress_id uuid;
  v_score integer := 0;
  v_total_questions integer := 0;
  v_score_percent integer := 0;
  v_passed boolean := false;
  v_next_action text := 'review_only';
  v_review jsonb := '[]'::jsonb;
  v_user_id uuid := auth.uid();
  v_next_published_batch integer;
  v_selected_option text;
  v_option_order text[];
begin
  select *
  into v_ctx
  from public.resolve_practice_batch_context(
    requested_subject_id => submit_attempt.submitted_subject_id,
    requested_subject_slug => null,
    requested_batch_number => submit_attempt.submitted_batch_number,
    allow_free_lock => false
  );

  if v_ctx.subject_id is null then
    raise exception 'Choose a module before starting practice';
  end if;

  if submitted_answers is null
     or jsonb_typeof(submitted_answers) <> 'array'
     or jsonb_array_length(submitted_answers) = 0 then
    raise exception 'Answer at least one question before submitting.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(submitted_answers) as submitted_answer
    where not exists (
      select 1
      from public.questions as q
      where q.id = (submitted_answer->>'question_id')::uuid
        and q.exam_pack_id = v_ctx.exam_pack_id
        and q.subject_id = v_ctx.subject_id
        and q.status = 'published'
        and q.batch_number = v_ctx.batch_number
    )
  ) then
    raise exception 'This practice set is no longer available. Start again from the dashboard.';
  end if;

  insert into public.attempts (
    user_id,
    exam_pack_id,
    mode,
    subject_id,
    service_level,
    batch_number,
    retry_number,
    is_free_attempt
  )
  values (
    v_user_id,
    v_ctx.exam_pack_id,
    submitted_mode,
    v_ctx.subject_id,
    null,
    v_ctx.batch_number,
    v_ctx.retry_number,
    v_ctx.is_free_attempt
  )
  returning id into v_attempt_id;

  for v_answer_row in
    select
      payload.submitted_answer,
      payload.ordinality::integer as ordinal_position
    from jsonb_array_elements(submitted_answers) with ordinality as payload(submitted_answer, ordinality)
  loop
    select q.*
    into v_question_row
    from public.questions as q
    where q.id = (v_answer_row.submitted_answer->>'question_id')::uuid
      and q.exam_pack_id = v_ctx.exam_pack_id
      and q.subject_id = v_ctx.subject_id
      and q.status = 'published'
      and q.batch_number = v_ctx.batch_number;

    if v_question_row.id is null then
      continue;
    end if;

    v_selected_option := nullif(upper(btrim(coalesce(v_answer_row.submitted_answer->>'selected_option', ''))), '');

    select array_agg(upper(option_key) order by option_position)
    into v_option_order
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(v_answer_row.submitted_answer->'option_order') = 'array'
          then v_answer_row.submitted_answer->'option_order'
        else '["A", "B", "C", "D"]'::jsonb
      end
    ) with ordinality as options(option_key, option_position);

    if cardinality(v_option_order) <> 4
       or not (v_option_order @> array['A', 'B', 'C', 'D']::text[]) then
      v_option_order := array['A', 'B', 'C', 'D']::text[];
    end if;

    v_total_questions := v_total_questions + 1;

    if v_selected_option = v_question_row.correct_option then
      v_score := v_score + 1;
    end if;

    insert into public.attempt_answers (
      attempt_id,
      user_id,
      question_id,
      selected_option,
      is_correct,
      time_spent_seconds,
      display_order,
      option_order
    )
    values (
      v_attempt_id,
      v_user_id,
      v_question_row.id,
      v_selected_option,
      coalesce(v_selected_option = v_question_row.correct_option, false),
      greatest(coalesce((v_answer_row.submitted_answer->>'time_spent_seconds')::integer, 0), 0),
      coalesce((v_answer_row.submitted_answer->>'display_order')::integer, v_answer_row.ordinal_position),
      v_option_order
    );

    v_review := v_review || jsonb_build_object(
      'question_id', v_question_row.id,
      'selected_option', v_selected_option,
      'correct_option', v_question_row.correct_option,
      'is_correct', coalesce(v_selected_option = v_question_row.correct_option, false),
      'explanation', v_question_row.explanation,
      'reference_note', v_question_row.reference_note,
      'display_order', coalesce((v_answer_row.submitted_answer->>'display_order')::integer, v_answer_row.ordinal_position),
      'option_order', to_jsonb(v_option_order)
    );
  end loop;

  if v_total_questions > 0 then
    v_score_percent := round((v_score::numeric * 100) / v_total_questions)::integer;
  end if;

  v_passed := v_total_questions > 0 and v_score_percent >= coalesce(v_ctx.pass_mark_percent, 70);

  update public.attempts as a
  set completed_at = now(),
      score = v_score,
      total_questions = v_total_questions,
      score_percent = v_score_percent,
      passed = v_passed
  where a.id = v_attempt_id;

  select ump.id
  into v_module_progress_id
  from public.user_module_progress as ump
  where ump.user_id = v_user_id
    and ump.exam_pack_id = v_ctx.exam_pack_id
    and ump.subject_id = v_ctx.subject_id
  limit 1;

  select min(q.batch_number)
  into v_next_published_batch
  from public.questions as q
  where q.exam_pack_id = v_ctx.exam_pack_id
    and q.subject_id = v_ctx.subject_id
    and q.status = 'published'
    and q.batch_number > v_ctx.batch_number;

  if v_ctx.is_free_attempt then
    update public.user_module_progress as ump
    set
      free_first_attempt_completed = true,
      free_retry_consumed = case
        when v_ctx.retry_number >= 1 then true
        else ump.free_retry_consumed
      end,
      last_attempt_id = v_attempt_id,
      last_attempted_at = now(),
      current_batch_number = 1,
      highest_unlocked_batch_number = greatest(coalesce(ump.highest_unlocked_batch_number, 1), 1)
    where ump.id = v_module_progress_id;

    v_next_action := case
      when v_passed then 'unlock_full_access'
      when v_ctx.retry_number >= 1 then 'unlock_full_access'
      else 'retry_free_batch'
    end;
  else
    update public.user_module_progress as ump
    set
      last_attempt_id = v_attempt_id,
      last_attempted_at = now(),
      current_batch_number = case
        when v_passed and v_next_published_batch is not null then v_next_published_batch
        else v_ctx.batch_number
      end,
      highest_unlocked_batch_number = case
        when v_passed and v_next_published_batch is not null
          then greatest(coalesce(ump.highest_unlocked_batch_number, 1), v_next_published_batch)
        else greatest(coalesce(ump.highest_unlocked_batch_number, 1), v_ctx.batch_number)
      end
    where ump.id = v_module_progress_id;

    v_next_action := case
      when v_passed and v_next_published_batch is not null then 'next_batch'
      when v_passed then 'module_complete'
      when v_next_published_batch is not null then 'retry_or_next'
      else 'review_only'
    end;
  end if;

  return query
  select
    v_attempt_id,
    v_score,
    v_total_questions,
    v_review,
    v_ctx.batch_number,
    v_score_percent,
    v_passed,
    v_ctx.retry_number,
    v_next_action;
end;
$$;

drop function if exists public.get_attempt_review(uuid);

create or replace function public.get_attempt_review(
  requested_attempt_id uuid default null
)
returns table (
  attempt_id uuid,
  completed_at timestamptz,
  score integer,
  total_questions integer,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  question_id uuid,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  selected_option text,
  correct_option text,
  is_correct boolean,
  explanation text,
  reference_note text,
  batch_number integer,
  score_percent integer,
  passed boolean,
  retry_number integer,
  display_order integer,
  option_order text[],
  pass_mark_percent integer,
  next_action text,
  next_batch_number integer,
  can_retry boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with target_attempt as (
    select
      a.id,
      a.completed_at,
      a.score,
      a.total_questions,
      a.subject_id,
      a.batch_number,
      a.score_percent,
      a.passed,
      a.retry_number,
      a.is_free_attempt
    from public.attempts as a
    where a.user_id = auth.uid()
      and a.completed_at is not null
      and (get_attempt_review.requested_attempt_id is null or a.id = get_attempt_review.requested_attempt_id)
    order by a.completed_at desc
    limit 1
  ),
  next_batch as (
    select
      ta.id as attempt_id,
      min(q.batch_number) as next_batch_number
    from target_attempt as ta
    join public.attempts as a on a.id = ta.id
    join public.questions as q
      on q.exam_pack_id = a.exam_pack_id
     and q.subject_id = a.subject_id
     and q.status = 'published'
     and q.batch_number > ta.batch_number
    group by ta.id
  )
  select
    ta.id as attempt_id,
    ta.completed_at,
    ta.score,
    ta.total_questions,
    ta.subject_id,
    s.name as subject_name,
    s.slug as subject_slug,
    q.id as question_id,
    q.question_text,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d,
    aa.selected_option,
    q.correct_option,
    aa.is_correct,
    q.explanation,
    q.reference_note,
    ta.batch_number,
    ta.score_percent,
    ta.passed,
    ta.retry_number,
    aa.display_order,
    aa.option_order,
    coalesce(s.pass_mark_percent, 70) as pass_mark_percent,
    case
      when ta.is_free_attempt and ta.passed then 'unlock_full_access'
      when ta.is_free_attempt and not ta.passed and ta.retry_number >= 1 then 'unlock_full_access'
      when ta.is_free_attempt and not ta.passed then 'retry_free_batch'
      when ta.passed and nb.next_batch_number is not null then 'next_batch'
      when ta.passed then 'module_complete'
      when nb.next_batch_number is not null then 'retry_or_next'
      else 'review_only'
    end as next_action,
    nb.next_batch_number,
    case
      when ta.is_free_attempt and ta.passed then false
      when ta.is_free_attempt and not ta.passed and ta.retry_number >= 1 then false
      else true
    end as can_retry
  from target_attempt as ta
  join public.attempt_answers as aa on aa.attempt_id = ta.id
  join public.questions as q on q.id = aa.question_id
  join public.subjects as s on s.id = q.subject_id
  left join next_batch as nb on nb.attempt_id = ta.id
  order by coalesce(aa.display_order, 999999), aa.answered_at;
$$;
