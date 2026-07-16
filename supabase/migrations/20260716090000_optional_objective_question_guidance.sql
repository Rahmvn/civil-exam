-- Objective explanations and references are useful guidance, but neither is
-- required to publish a structurally valid question.

alter table public.questions
drop constraint if exists published_questions_need_explanations;

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
    select lower(regexp_replace(trim(question_text), '\s+', ' ', 'g'))
    from public.questions
    where practice_set_id = target_set.id
      and status <> 'archived'
      and (supersedes_question_id is null or status = 'published')
    group by lower(regexp_replace(trim(question_text), '\s+', ' ', 'g'))
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

  -- Keep the second argument for compatibility with existing revision RPCs.
  -- Explanations are optional for both new questions and corrections.
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

revoke all on function public.admin_get_practice_set_validation(uuid) from public, anon;
grant execute on function public.admin_get_practice_set_validation(uuid) to authenticated;
revoke all on function public.admin_validate_question_payload(jsonb, boolean) from public, anon, authenticated;

comment on function public.admin_validate_question_payload(jsonb, boolean) is
  'Validates objective question structure. The legacy boolean argument is retained for RPC compatibility; explanations are optional.';
