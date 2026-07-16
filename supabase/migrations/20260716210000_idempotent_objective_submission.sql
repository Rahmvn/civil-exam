create table if not exists public.attempt_submission_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_token uuid not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, submission_token)
);

alter table public.attempt_submission_keys enable row level security;

create or replace function public.submit_attempt_idempotent(
  submitted_mode public.attempt_mode,
  submitted_subject_id uuid,
  submitted_answers jsonb,
  submitted_batch_number integer,
  submitted_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if submitted_token is null then
    raise exception 'Submission token is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || submitted_token::text, 0));

  select response_payload into v_response
  from public.attempt_submission_keys
  where user_id = v_user_id
    and submission_token = submitted_token;

  if v_response is not null then
    return v_response;
  end if;

  select to_jsonb(result) into v_response
  from public.submit_attempt(
    submitted_mode => submit_attempt_idempotent.submitted_mode,
    submitted_subject_id => submit_attempt_idempotent.submitted_subject_id,
    submitted_answers => submit_attempt_idempotent.submitted_answers,
    submitted_batch_number => submit_attempt_idempotent.submitted_batch_number
  ) as result;

  if v_response is null then
    raise exception 'Practice submission did not return a result';
  end if;

  insert into public.attempt_submission_keys (user_id, submission_token, response_payload)
  values (v_user_id, submitted_token, v_response);

  return v_response;
end;
$$;

revoke all on function public.submit_attempt_idempotent(public.attempt_mode, uuid, jsonb, integer, uuid) from public;
grant execute on function public.submit_attempt_idempotent(public.attempt_mode, uuid, jsonb, integer, uuid) to authenticated;
