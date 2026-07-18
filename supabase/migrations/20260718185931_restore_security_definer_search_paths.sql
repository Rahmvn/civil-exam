-- Keep temporary objects behind application objects for every privileged public
-- function, including functions replaced by lifecycle migrations.
do $$
declare
  target_function record;
begin
  for target_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'alter function %s set search_path = public, pg_temp',
      target_function.signature
    );
  end loop;
end;
$$;

-- The lifecycle redesign revoked this RPC but omitted the matching candidate
-- grant, preventing an authenticated user from submitting a pinned session.
revoke all on function public.submit_objective_practice_session(
  uuid,
  public.attempt_mode,
  jsonb
) from public, anon;
grant execute on function public.submit_objective_practice_session(
  uuid,
  public.attempt_mode,
  jsonb
) to authenticated;
