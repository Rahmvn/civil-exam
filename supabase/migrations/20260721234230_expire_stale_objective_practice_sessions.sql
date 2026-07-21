-- Do not resume an objective session after its exam deadline and submission
-- transport grace have elapsed. The older allocation expiry is intentionally
-- longer and is not a valid timer-resume boundary.
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
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  update public.objective_practice_sessions
  set status = 'abandoned'
  where user_id = auth.uid()
    and status = 'active'
    and deadline_at + interval '2 minutes' < clock_timestamp();

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
    'server_now', clock_timestamp()
  );
end;
$$;

revoke all on function public.start_objective_practice_session_v2(uuid, text, integer, boolean) from public, anon;
grant execute on function public.start_objective_practice_session_v2(uuid, text, integer, boolean) to authenticated;
