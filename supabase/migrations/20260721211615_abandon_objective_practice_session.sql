-- Explicit candidate exits close the server allocation. Browser refresh and
-- accidental navigation remain resumable because they do not call this RPC.
create or replace function public.abandon_objective_practice_session(
  requested_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select session.status
  into v_status
  from public.objective_practice_sessions as session
  where session.id = requested_session_id
    and session.user_id = v_user_id
  for update;

  if not found then
    raise exception 'This practice session could not be found';
  end if;

  if v_status = 'active' then
    update public.objective_practice_sessions
    set status = 'abandoned'
    where id = requested_session_id
      and user_id = v_user_id
      and status = 'active';

    v_status := 'abandoned';
  end if;

  return jsonb_build_object(
    'practice_session_id', requested_session_id,
    'status', v_status
  );
end;
$$;

revoke all on function public.abandon_objective_practice_session(uuid) from public, anon;
grant execute on function public.abandon_objective_practice_session(uuid) to authenticated;

-- Trusted backend maintenance and isolated test setup must be able to remove
-- a candidate's server-side sessions without exposing the table to browsers.
grant select, delete on table public.objective_practice_sessions to service_role;

-- Keep SECURITY DEFINER functions introduced after the previous hardening pass
-- on the same fixed search path enforced by the database regression suite.
alter function public.apply_paystack_post_payment_event(text, jsonb)
  set search_path = public, pg_temp;
alter function public.get_payment_history(integer)
  set search_path = public, pg_temp;
alter function public.touch_updated_at()
  set search_path = public, pg_temp;
