-- Recover missing profile rows for authenticated users whose auth account exists
-- but whose public.profiles row was not created by the signup trigger.

create or replace function public.ensure_my_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  auth_user auth.users;
  profile_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select *
  into profile_row
  from public.profiles
  where id = auth.uid();

  if profile_row.id is not null then
    return profile_row;
  end if;

  select *
  into auth_user
  from auth.users
  where id = auth.uid();

  if auth_user.id is null then
    raise exception 'Authenticated user record was not found';
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    auth_user.id,
    coalesce(auth_user.email, ''),
    coalesce(auth_user.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  select *
  into profile_row
  from public.profiles
  where id = auth.uid();

  return profile_row;
end;
$$;

grant execute on function public.ensure_my_profile() to authenticated;
