-- Notify every current administrator when a candidate creates a support request.
-- The existing email worker resolves each administrator's current auth email at
-- dispatch time, so profile email changes and delivery retries remain safe.

create or replace function public.enqueue_support_request_admin_notifications()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_requester_name text;
  v_requester_email text;
  v_subject_name text;
  v_admin record;
begin
  select profile.full_name, profile.email
  into v_requester_name, v_requester_email
  from public.profiles profile
  where profile.id = new.user_id;

  if new.subject_id is not null then
    select subject.name into v_subject_name
    from public.subjects subject
    where subject.id = new.subject_id;
  end if;

  for v_admin in
    select profile.id
    from public.profiles profile
    where profile.role = 'admin'
  loop
    perform public.enqueue_transactional_email_event(
      'support-request:' || new.id::text || ':admin:' || v_admin.id::text,
      'admin_support_request',
      v_admin.id,
      null,
      jsonb_strip_nulls(jsonb_build_object(
        'support_request_id', new.id,
        'requester_name', v_requester_name,
        'requester_email', v_requester_email,
        'category', new.category,
        'subject', new.subject,
        'description', new.description,
        'payment_reference', new.payment_reference,
        'page_path', new.page_path,
        'subject_name', v_subject_name,
        'created_at', new.created_at,
        'admin_path', '/admin/help'
      )),
      2::smallint
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.enqueue_support_request_admin_notifications()
from public, anon, authenticated;

drop trigger if exists enqueue_support_request_admin_notifications
on public.support_requests;

create trigger enqueue_support_request_admin_notifications
after insert on public.support_requests
for each row execute function public.enqueue_support_request_admin_notifications();
