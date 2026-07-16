-- Indexes correspond to current browser/RPC predicates and ordering. Existing
-- unique indexes already cover attempt_answers(attempt_id), payment history,
-- module access, support history, and oral-practice lookups.
create index if not exists attempts_user_started_idx
  on public.attempts (user_id, started_at desc);

create index if not exists attempts_user_pack_subject_batch_completed_idx
  on public.attempts (user_id, exam_pack_id, subject_id, batch_number, completed_at desc);

create index if not exists attempts_subject_id_idx
  on public.attempts (subject_id);

create index if not exists attempt_answers_user_question_answered_idx
  on public.attempt_answers (user_id, question_id, answered_at desc);

create index if not exists attempt_answers_question_id_idx
  on public.attempt_answers (question_id);

create index if not exists questions_pack_subject_batch_status_position_idx
  on public.questions (exam_pack_id, subject_id, batch_number, status, batch_position);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);

create index if not exists app_error_events_user_created_idx
  on public.app_error_events (user_id, created_at desc);

-- Each replacement keeps the original predicate and command semantics. The
-- authenticated role avoids anonymous evaluation, while SELECT wrappers let
-- Postgres initialize auth/admin helpers once per statement where possible.
drop policy if exists "admin_audit_logs_admin_only" on public.admin_audit_logs;
create policy "admin_audit_logs_admin_only"
on public.admin_audit_logs for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "app_error_events_admin_read" on public.app_error_events;
create policy "app_error_events_admin_read"
on public.app_error_events for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "attempt_answers_insert_own" on public.attempt_answers;
create policy "attempt_answers_insert_own"
on public.attempt_answers for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "attempt_answers_select_own" on public.attempt_answers;
create policy "attempt_answers_select_own"
on public.attempt_answers for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "attempts_insert_own" on public.attempts;
create policy "attempts_insert_own"
on public.attempts for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "attempts_select_own" on public.attempts;
create policy "attempts_select_own"
on public.attempts for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "admins_manage_entitlements" on public.entitlements;
create policy "admins_manage_entitlements"
on public.entitlements for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "entitlements_select_own_or_admin" on public.entitlements;
create policy "entitlements_select_own_or_admin"
on public.entitlements for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "admins_manage_exam_packs" on public.exam_packs;
create policy "admins_manage_exam_packs"
on public.exam_packs for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "exam_packs_read_active" on public.exam_packs;
create policy "exam_packs_read_active"
on public.exam_packs for select
to authenticated
using (is_active or (select public.is_admin()));

drop policy if exists "admins_manage_module_entitlements" on public.module_entitlements;
create policy "admins_manage_module_entitlements"
on public.module_entitlements for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "module_entitlements_select_own_or_admin" on public.module_entitlements;
create policy "module_entitlements_select_own_or_admin"
on public.module_entitlements for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "admins_manage_module_offerings" on public.module_offerings;
create policy "admins_manage_module_offerings"
on public.module_offerings for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "module_offerings_read_active" on public.module_offerings;
create policy "module_offerings_read_active"
on public.module_offerings for select
to authenticated
using (is_active = true or (select public.is_admin()));

drop policy if exists "oral_attempts_admin_only" on public.oral_attempts;
create policy "oral_attempts_admin_only"
on public.oral_attempts for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "oral_questions_admin_only" on public.oral_questions;
create policy "oral_questions_admin_only"
on public.oral_questions for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "oral_responses_admin_only" on public.oral_responses;
create policy "oral_responses_admin_only"
on public.oral_responses for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "admins_manage_payment_orders" on public.payment_orders;
create policy "admins_manage_payment_orders"
on public.payment_orders for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "payment_orders_select_own_or_admin" on public.payment_orders;
create policy "payment_orders_select_own_or_admin"
on public.payment_orders for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "practice_sets_admin_only" on public.practice_sets;
create policy "practice_sets_admin_only"
on public.practice_sets for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "admins_manage_profiles" on public.profiles;
create policy "admins_manage_profiles"
on public.profiles for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and role = (
    select profile_role.role
    from public.profiles as profile_role
    where profile_role.id = (select auth.uid())
  )
);

drop policy if exists "admins_manage_questions" on public.questions;
create policy "admins_manage_questions"
on public.questions for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "questions_read_admin_only" on public.questions;
create policy "questions_read_admin_only"
on public.questions for select
to authenticated
using ((select public.is_admin()));

drop policy if exists "admins_manage_subjects" on public.subjects;
create policy "admins_manage_subjects"
on public.subjects for all
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "subjects_read_active" on public.subjects;
create policy "subjects_read_active"
on public.subjects for select
to authenticated
using (is_active or (select public.is_admin()));

drop policy if exists "support_requests_admin_update" on public.support_requests;
create policy "support_requests_admin_update"
on public.support_requests for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "support_requests_select_own_or_admin" on public.support_requests;
create policy "support_requests_select_own_or_admin"
on public.support_requests for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "user_module_progress_insert_own" on public.user_module_progress;
create policy "user_module_progress_insert_own"
on public.user_module_progress for insert
to authenticated
with check (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "user_module_progress_select_own_or_admin" on public.user_module_progress;
create policy "user_module_progress_select_own_or_admin"
on public.user_module_progress for select
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "user_module_progress_update_own_or_admin" on public.user_module_progress;
create policy "user_module_progress_update_own_or_admin"
on public.user_module_progress for update
to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()))
with check (user_id = (select auth.uid()) or (select public.is_admin()));
