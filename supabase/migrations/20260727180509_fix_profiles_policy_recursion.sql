-- The previous profile policies called public.is_admin() and also selected
-- from public.profiles inside the profiles UPDATE check. On profiles itself,
-- that can recurse through RLS and fail candidate profile updates with 42P17.
--
-- Candidate-facing profile access is own-row only. Admin profile reads and
-- joins should go through SECURITY DEFINER admin RPCs instead of direct table
-- RLS on profiles.
drop policy if exists "admins_manage_profiles" on public.profiles;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));
