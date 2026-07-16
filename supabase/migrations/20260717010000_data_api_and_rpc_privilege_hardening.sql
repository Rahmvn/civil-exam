-- Data API grants are an explicit API boundary; RLS remains the row-level
-- authorization layer for every browser-readable table below.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
-- PostgreSQL's built-in PUBLIC function grant is global, so it must be
-- revoked globally before schema-specific API-role defaults are applied.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;

revoke all privileges on all tables in schema public from anon, authenticated, service_role;

-- The signed-in application reads these tables directly. Candidate/admin row
-- visibility is still constrained by their existing RLS policies.
grant select on table
  public.profiles,
  public.subjects,
  public.exam_packs,
  public.attempts,
  public.attempt_answers,
  public.questions,
  public.oral_questions,
  public.admin_audit_logs,
  public.support_requests,
  public.app_error_events
to authenticated;

-- Candidate profile editing is intentionally limited to the fields currently
-- written by the browser. Identity and authorization columns remain read-only.
grant update (phone_number, state_code, organization_name)
on table public.profiles to authenticated;

-- Trusted Edge Functions and local operational tooling use the service role.
-- Privileges are listed explicitly rather than relying on project defaults.
grant select on table
  public.profiles,
  public.exam_packs,
  public.subjects,
  public.questions,
  public.entitlements,
  public.attempts,
  public.attempt_answers,
  public.module_offerings,
  public.module_entitlements,
  public.payment_orders,
  public.user_module_progress,
  public.practice_sets,
  public.oral_questions,
  public.oral_attempts,
  public.oral_responses
to service_role;

grant insert, update, delete on table
  public.profiles,
  public.exam_packs,
  public.subjects,
  public.questions,
  public.entitlements,
  public.attempts,
  public.attempt_answers,
  public.module_offerings,
  public.module_entitlements,
  public.payment_orders,
  public.user_module_progress,
  public.practice_sets,
  public.oral_questions,
  public.oral_attempts,
  public.oral_responses
to service_role;

-- Functions are not protected by RLS. Revoke every exact public-schema
-- signature first, then expose only the supported RPC entry points below.
do $$
declare
  function_record record;
begin
  for function_record in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated, service_role',
      function_record.signature
    );
  end loop;
end;
$$;

-- Keep temporary objects behind trusted schema objects for every privileged
-- function without changing function bodies or product behavior.
do $$
declare
  function_record record;
begin
  for function_record in
    select p.oid::regprocedure as signature
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef
  loop
    execute format(
      'alter function %s set search_path = public, pg_temp',
      function_record.signature
    );
  end loop;
end;
$$;

-- Candidate and shared authenticated RPCs.
grant execute on function public.ensure_my_profile() to authenticated;
grant execute on function public.get_active_pack() to authenticated;
grant execute on function public.get_batch_access_state(text, integer) to authenticated;
grant execute on function public.get_candidate_summary() to authenticated;
grant execute on function public.get_module_access_catalog() to authenticated;
grant execute on function public.get_module_batch_access(text) to authenticated;
grant execute on function public.get_module_progress() to authenticated;
grant execute on function public.get_payment_history(integer) to authenticated;
grant execute on function public.get_practice_questions(uuid, integer, integer) to authenticated;
grant execute on function public.get_review_queue(integer) to authenticated;
grant execute on function public.get_subject_performance() to authenticated;
grant execute on function public.get_attempt_review(uuid) to authenticated;
grant execute on function public.start_practice_batch(text, integer) to authenticated;
grant execute on function public.submit_attempt(public.attempt_mode, uuid, jsonb, integer) to authenticated;
grant execute on function public.submit_attempt_idempotent(public.attempt_mode, uuid, jsonb, integer, uuid) to authenticated;
grant execute on function public.has_active_entitlement(uuid) to authenticated;
grant execute on function public.has_active_module_entitlement(uuid, uuid) to authenticated;
grant execute on function public.create_support_request(text, text, text, text, text) to authenticated;
grant execute on function public.record_app_error(text, text, text, integer) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Oral-practice RPCs.
grant execute on function public.advance_oral_attempt(uuid, uuid, text, text) to authenticated;
grant execute on function public.get_active_oral_attempt(text, integer) to authenticated;
grant execute on function public.get_oral_attempt_review(uuid) to authenticated;
grant execute on function public.get_oral_attempt_state(uuid) to authenticated;
grant execute on function public.get_oral_practice_set_access(text) to authenticated;
grant execute on function public.save_oral_response_draft(uuid, uuid, text) to authenticated;
grant execute on function public.save_oral_self_rating(uuid, text) to authenticated;
grant execute on function public.start_or_resume_oral_attempt(text, integer, integer) to authenticated;

-- Admin RPCs remain callable by signed-in users and enforce admin membership
-- inside their SECURITY DEFINER bodies.
grant execute on function public.get_admin_question_counts() to authenticated;
grant execute on function public.get_admin_content_modules() to authenticated;
grant execute on function public.get_admin_content_modules_v2() to authenticated;
grant execute on function public.get_admin_practice_sets(uuid) to authenticated;
grant execute on function public.get_admin_practice_sets_v2(uuid) to authenticated;
grant execute on function public.admin_get_practice_set_validation(uuid) to authenticated;
grant execute on function public.admin_get_practice_set_validation_v2(uuid) to authenticated;
grant execute on function public.admin_create_module(text, text, integer, integer, text, integer, integer, text) to authenticated;
grant execute on function public.admin_create_module_typed(text, text, integer, integer, text, integer, integer, text, text) to authenticated;
grant execute on function public.admin_update_module(uuid, text, integer, integer, text, integer, integer, text, boolean) to authenticated;
grant execute on function public.admin_update_module_v2(uuid, text, integer, integer, text, integer, integer, text, boolean) to authenticated;
grant execute on function public.admin_delete_empty_module(uuid) to authenticated;
grant execute on function public.admin_delete_empty_module_v2(uuid) to authenticated;
grant execute on function public.admin_create_practice_set(uuid, integer) to authenticated;
grant execute on function public.admin_update_practice_set(uuid, integer) to authenticated;
grant execute on function public.admin_transition_practice_set(uuid, text) to authenticated;
grant execute on function public.admin_transition_practice_set_v2(uuid, text) to authenticated;
grant execute on function public.admin_delete_empty_practice_set(uuid) to authenticated;
grant execute on function public.admin_delete_empty_practice_set_v2(uuid) to authenticated;
grant execute on function public.admin_save_question(jsonb) to authenticated;
grant execute on function public.admin_create_question_revision(jsonb) to authenticated;
grant execute on function public.admin_update_question_revision(jsonb) to authenticated;
grant execute on function public.admin_publish_question_revision(uuid) to authenticated;
grant execute on function public.admin_archive_question(uuid) to authenticated;
grant execute on function public.admin_delete_draft_question(uuid) to authenticated;
grant execute on function public.admin_import_questions(uuid, jsonb, text, text) to authenticated;
grant execute on function public.admin_save_oral_question(jsonb) to authenticated;
grant execute on function public.admin_create_oral_question_revision(jsonb) to authenticated;
grant execute on function public.admin_update_oral_question_revision(jsonb) to authenticated;
grant execute on function public.admin_publish_oral_question_revision(uuid) to authenticated;
grant execute on function public.admin_archive_oral_question(uuid) to authenticated;
grant execute on function public.admin_delete_draft_oral_question(uuid) to authenticated;
grant execute on function public.admin_import_oral_questions(uuid, jsonb, text, text) to authenticated;
grant execute on function public.get_admin_support_requests(integer) to authenticated;
grant execute on function public.update_support_request(uuid, text, text) to authenticated;

-- Payment activation is a server-only RPC invoked after provider verification.
grant execute on function public.activate_module_purchase(text, jsonb) to service_role;
