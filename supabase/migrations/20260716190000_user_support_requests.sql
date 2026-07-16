create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('account', 'access', 'payment', 'practice', 'content', 'technical')),
  subject text not null check (char_length(btrim(subject)) between 5 and 120),
  description text not null check (char_length(btrim(description)) between 20 and 2000),
  payment_reference text check (payment_reference is null or char_length(payment_reference) <= 120),
  page_path text check (page_path is null or char_length(page_path) <= 300),
  status text not null default 'received' check (status in ('received', 'in_review', 'resolved', 'closed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_requests_user_created_idx
  on public.support_requests (user_id, created_at desc);

create index if not exists support_requests_status_created_idx
  on public.support_requests (status, created_at asc);

alter table public.support_requests enable row level security;

drop policy if exists "support_requests_select_own_or_admin" on public.support_requests;
create policy "support_requests_select_own_or_admin"
on public.support_requests for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "support_requests_admin_update" on public.support_requests;
create policy "support_requests_admin_update"
on public.support_requests for update
using (public.is_admin())
with check (public.is_admin());

create or replace function public.create_support_request(
  requested_category text,
  requested_subject text,
  requested_description text,
  requested_payment_reference text default null,
  requested_page_path text default null
)
returns public.support_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.support_requests;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if requested_category not in ('account', 'access', 'payment', 'practice', 'content', 'technical') then
    raise exception 'Choose a valid help category';
  end if;

  if char_length(btrim(coalesce(requested_subject, ''))) not between 5 and 120 then
    raise exception 'Describe the issue in 5 to 120 characters';
  end if;

  if char_length(btrim(coalesce(requested_description, ''))) not between 20 and 2000 then
    raise exception 'Add between 20 and 2000 characters of detail';
  end if;

  if requested_payment_reference is not null and char_length(btrim(requested_payment_reference)) > 120 then
    raise exception 'Payment reference is too long';
  end if;

  if requested_page_path is not null and char_length(requested_page_path) > 300 then
    raise exception 'Page path is too long';
  end if;

  if (
    select count(*)
    from public.support_requests
    where user_id = v_user_id
      and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'You have sent several requests recently. Please wait before sending another';
  end if;

  insert into public.support_requests (
    user_id,
    category,
    subject,
    description,
    payment_reference,
    page_path
  ) values (
    v_user_id,
    requested_category,
    btrim(requested_subject),
    btrim(requested_description),
    nullif(btrim(coalesce(requested_payment_reference, '')), ''),
    nullif(btrim(coalesce(requested_page_path, '')), '')
  )
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.create_support_request(text, text, text, text, text) from public;
grant execute on function public.create_support_request(text, text, text, text, text) to authenticated;

grant select on public.support_requests to authenticated;
grant update on public.support_requests to authenticated;
