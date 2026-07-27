-- Deliberate oral exits should end the active attempt, matching objective
-- practice semantics. Accidental refresh/reconnect remains resumable because
-- the browser does not call this RPC.
create or replace function public.abandon_oral_attempt(
  requested_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.oral_assert_candidate();
  v_attempt public.oral_attempts;
begin
  select * into v_attempt
  from public.oral_attempts
  where id = requested_attempt_id
    and user_id = v_user_id
  for update;

  if v_attempt.id is null then
    raise exception 'Oral practice attempt was not found';
  end if;

  if v_attempt.status = 'active' then
    update public.oral_attempts
    set status = 'abandoned'
    where id = v_attempt.id
      and user_id = v_user_id
      and status = 'active'
    returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'status', v_attempt.status
  );
end;
$$;

revoke all on function public.abandon_oral_attempt(uuid) from public, anon;
grant execute on function public.abandon_oral_attempt(uuid) to authenticated;
