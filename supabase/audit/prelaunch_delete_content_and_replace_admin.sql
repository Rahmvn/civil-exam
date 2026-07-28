-- Guarded prelaunch cleanup:
-- 1) promotes your real registered account to admin,
-- 2) removes all seeded module/practice/question content,
-- 3) deletes the temporary/fake admin account.
--
-- This deletes rows, not tables. The schema, upload/admin tools, policies,
-- functions, and app structure remain in place.
--
-- Before running:
-- - Register/sign in once with your real Gmail so auth.users/profiles exist.
-- - Replace NEW_REAL_ADMIN_EMAIL below.
-- - Replace CHANGE_ME with the exact confirmation token.

begin;

select set_config(
  'promotionsure.prelaunch_content_admin_confirmation',
  'DELETE_CONTENT_AND_REPLACE_FAKE_ADMIN_BEFORE_LAUNCH',
  true
);

do $$
declare
  v_confirmation text := current_setting('promotionsure.prelaunch_content_admin_confirmation', true);
  v_old_admin_email text := lower('admin@gmail.com');
  v_new_admin_email text := lower('rahmvn1@gmail.com');
  v_new_admin_id uuid;
  v_old_admin_id uuid;
  v_admin_count integer;
begin
  if v_confirmation <> 'DELETE_CONTENT_AND_REPLACE_FAKE_ADMIN_BEFORE_LAUNCH' then
    raise exception
      'Prelaunch content/admin cleanup blocked. Replace CHANGE_ME with the exact confirmation token.';
  end if;

  if v_new_admin_email = lower('NEW_REAL_ADMIN_EMAIL@example.com') then
    raise exception 'Set v_new_admin_email to your real registered Gmail before running.';
  end if;

  select u.id
  into v_new_admin_id
  from auth.users as u
  where lower(u.email) = v_new_admin_email;

  if v_new_admin_id is null then
    raise exception
      'New admin email % is not registered yet. Create the account first, then rerun this script.',
      v_new_admin_email;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (v_new_admin_id, v_new_admin_email, null, 'admin')
  on conflict (id) do update
    set role = 'admin',
        email = excluded.email,
        updated_at = now();

  select u.id
  into v_old_admin_id
  from auth.users as u
  where lower(u.email) = v_old_admin_email;

  -- Clear runtime/user state again, in case a final smoke test happened.
  delete from public.attempt_answers;
  delete from public.attempt_submission_keys;
  delete from public.objective_practice_sessions;
  delete from public.user_module_progress;
  delete from public.oral_responses;
  delete from public.oral_attempts;
  delete from public.attempts;
  delete from public.module_entitlements;
  delete from public.payment_provider_events;
  delete from public.payment_orders;
  delete from public.entitlements;
  delete from public.support_requests;
  delete from public.app_error_events;
  delete from public.user_legal_acceptances
  where user_id <> v_new_admin_id;
  delete from private.edge_rate_limits;

  -- Clear admin/content audit noise from testing and remove references that can
  -- block content/profile deletion.
  delete from public.admin_audit_logs;

  -- Break version/replacement self-links before deleting restricted rows.
  update public.questions
  set supersedes_question_id = null,
      practice_set_id = null;

  update public.oral_questions
  set supersedes_question_id = null;

  update public.practice_sets
  set replaces_practice_set_id = null,
      replaced_by_practice_set_id = null;

  -- Delete content from children to parents. Published-content protection
  -- triggers are disabled only inside this transaction for the prelaunch wipe.
  alter table public.oral_questions disable trigger oral_questions_protect_published_content;
  alter table public.questions disable trigger questions_protect_published_content;

  delete from public.oral_questions;
  delete from public.questions;

  alter table public.questions enable trigger questions_protect_published_content;
  alter table public.oral_questions enable trigger oral_questions_protect_published_content;

  delete from public.practice_sets;
  delete from public.module_offerings;
  delete from public.subjects;
  delete from public.exam_packs;

  -- Delete the fake admin only after the real admin has been promoted.
  if v_old_admin_id is not null and v_old_admin_id <> v_new_admin_id then
    delete from auth.refresh_tokens
    where user_id = v_old_admin_id::text;

    delete from auth.sessions
    where user_id = v_old_admin_id;

    delete from auth.users
    where id = v_old_admin_id;
  end if;

  select count(*)
  into v_admin_count
  from public.profiles
  where role::text = 'admin';

  if v_admin_count < 1 then
    raise exception 'Cleanup blocked: no admin profile would remain.';
  end if;

  if exists (
    select 1
    from auth.users as u
    where lower(u.email) = v_old_admin_email
  ) then
    raise exception 'Cleanup incomplete: old fake admin account still exists.';
  end if;

  if not exists (
    select 1
    from public.profiles as p
    join auth.users as u on u.id = p.id
    where lower(u.email) = v_new_admin_email
      and p.role::text = 'admin'
  ) then
    raise exception 'Cleanup incomplete: new admin account is not admin.';
  end if;
end $$;

commit;

select *
from (
  values
    ('exam_packs', (select count(*) from public.exam_packs)),
    ('subjects', (select count(*) from public.subjects)),
    ('module_offerings', (select count(*) from public.module_offerings)),
    ('practice_sets', (select count(*) from public.practice_sets)),
    ('objective_questions', (select count(*) from public.questions)),
    ('oral_questions', (select count(*) from public.oral_questions)),
    ('admin_profiles', (select count(*) from public.profiles where role::text = 'admin')),
    ('old_fake_admin_users', (select count(*) from auth.users where lower(email) = lower('admin@gmail.com')))
) as checks(name, count);
