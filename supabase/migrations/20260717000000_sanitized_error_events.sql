-- Store only classified operational metadata; never raw error messages.
create table if not exists public.app_error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context text not null check (char_length(context) between 1 and 120),
  problem_code text not null check (char_length(problem_code) between 1 and 80),
  page_path text check (page_path is null or char_length(page_path) <= 300),
  http_status integer check (http_status is null or http_status between 100 and 599),
  created_at timestamptz not null default now()
);

create index if not exists app_error_events_created_idx
  on public.app_error_events (created_at desc);
create index if not exists app_error_events_code_created_idx
  on public.app_error_events (problem_code, created_at desc);

alter table public.app_error_events enable row level security;

drop policy if exists "app_error_events_admin_read" on public.app_error_events;
create policy "app_error_events_admin_read"
on public.app_error_events for select
using (public.is_admin());

create or replace function public.record_app_error(
  requested_context text,
  requested_problem_code text,
  requested_page_path text default null,
  requested_http_status integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id uuid;
begin
  if v_user_id is null then return null; end if;
  if char_length(btrim(coalesce(requested_context, ''))) not between 1 and 120 then return null; end if;
  if char_length(btrim(coalesce(requested_problem_code, ''))) not between 1 and 80 then return null; end if;
  if requested_page_path is not null and char_length(requested_page_path) > 300 then return null; end if;
  if requested_http_status is not null and requested_http_status not between 100 and 599 then return null; end if;

  if (
    select count(*) from public.app_error_events
    where user_id = v_user_id and created_at > now() - interval '1 hour'
  ) >= 50 then
    return null;
  end if;

  insert into public.app_error_events (user_id, context, problem_code, page_path, http_status)
  values (
    v_user_id,
    btrim(requested_context),
    btrim(requested_problem_code),
    nullif(btrim(coalesce(requested_page_path, '')), ''),
    requested_http_status
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_app_error(text, text, text, integer) from public;
grant execute on function public.record_app_error(text, text, text, integer) to authenticated;
grant select on public.app_error_events to authenticated;
