-- Candidate attempt data is private to its owner. Administrators use dedicated,
-- audited security-definer functions for the aggregate data needed by the console.

drop policy if exists "attempts_select_own_or_admin" on public.attempts;
drop policy if exists "attempts_select_own" on public.attempts;

create policy "attempts_select_own"
on public.attempts for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "attempt_answers_select_own_or_admin" on public.attempt_answers;
drop policy if exists "attempt_answers_select_own" on public.attempt_answers;

create policy "attempt_answers_select_own"
on public.attempt_answers for select
to authenticated
using (user_id = auth.uid());
