-- Read-only prelaunch inspection for deleting seeded content and replacing the
-- temporary/fake admin account.
--
-- Replace the email values before running if your emails differ.

with settings as (
  select
    lower('admin@gmail.com') as old_admin_email,
    lower('YOUR_REAL_ADMIN_EMAIL@example.com') as new_admin_email
),
content_counts as (
  select *
  from (
    values
      ('exam_packs', (select count(*) from public.exam_packs)),
      ('subjects', (select count(*) from public.subjects)),
      ('module_offerings', (select count(*) from public.module_offerings)),
      ('practice_sets', (select count(*) from public.practice_sets)),
      ('objective_questions', (select count(*) from public.questions)),
      ('oral_questions', (select count(*) from public.oral_questions)),
      ('admin_audit_logs', (select count(*) from public.admin_audit_logs))
  ) as counts(name, count)
),
admin_accounts as (
  select
    p.id,
    u.email,
    p.full_name,
    p.role::text as role,
    u.last_sign_in_at
  from public.profiles as p
  join auth.users as u on u.id = p.id
  where lower(u.email) in (
    (select old_admin_email from settings),
    (select new_admin_email from settings)
  )
)
select 'content_count' as section, name, count::text as value
from content_counts
union all
select
  'admin_account' as section,
  coalesce(email, id::text) as name,
  concat('role=', role, ', full_name=', coalesce(full_name, ''), ', last_sign_in_at=', coalesce(last_sign_in_at::text, 'never')) as value
from admin_accounts
order by section, name;
