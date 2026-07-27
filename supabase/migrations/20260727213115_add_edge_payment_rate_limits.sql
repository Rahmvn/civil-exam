-- Edge Functions use the service role and therefore need their own narrow,
-- atomic abuse counter. Keep the records outside the exposed Data API schema.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.edge_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (
    action in ('payment_initialize', 'payment_verify', 'admin_payment_reconcile')
  ),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count between 1 and 1001),
  updated_at timestamptz not null default now(),
  primary key (user_id, action)
);

revoke all on table private.edge_rate_limits from public, anon, authenticated, service_role;

create or replace function public.consume_edge_rate_limit(
  requested_user_id uuid,
  requested_action text,
  requested_max_requests integer,
  requested_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if requested_user_id is null then
    raise exception 'A rate-limit user is required';
  end if;
  if requested_action not in ('payment_initialize', 'payment_verify', 'admin_payment_reconcile') then
    raise exception 'Unknown rate-limit action';
  end if;
  if requested_max_requests not between 1 and 1000 then
    raise exception 'Invalid rate-limit maximum';
  end if;
  if requested_window_seconds not between 1 and 86400 then
    raise exception 'Invalid rate-limit window';
  end if;

  insert into private.edge_rate_limits as rate_limit (
    user_id,
    action,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    requested_user_id,
    requested_action,
    now(),
    1,
    now()
  )
  on conflict (user_id, action) do update
  set window_started_at = case
        when rate_limit.window_started_at <= now() - make_interval(secs => requested_window_seconds)
          then now()
        else rate_limit.window_started_at
      end,
      request_count = case
        when rate_limit.window_started_at <= now() - make_interval(secs => requested_window_seconds)
          then 1
        else least(rate_limit.request_count + 1, requested_max_requests + 1)
      end,
      updated_at = now()
  returning request_count into v_count;

  return v_count <= requested_max_requests;
end;
$$;

revoke all on function public.consume_edge_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(uuid, text, integer, integer)
  to service_role;
