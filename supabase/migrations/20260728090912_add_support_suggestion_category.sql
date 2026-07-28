alter table public.support_requests
  drop constraint if exists support_requests_category_check;

alter table public.support_requests
  add constraint support_requests_category_check
  check (category in ('account', 'access', 'payment', 'practice', 'content', 'technical', 'suggestion'));

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
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.support_requests;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if requested_category not in ('account', 'access', 'payment', 'practice', 'content', 'technical', 'suggestion') then
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

create or replace function public.create_support_request_v2(
  requested_category text,
  requested_subject text,
  requested_description text,
  requested_payment_reference text default null,
  requested_page_path text default null,
  requested_subject_id uuid default null
)
returns public.support_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.support_requests;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if requested_category not in ('account', 'access', 'payment', 'practice', 'content', 'technical', 'suggestion') then
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
  if requested_subject_id is not null and not exists (
    select 1 from public.subjects where id = requested_subject_id and is_active = true
  ) then
    raise exception 'Choose a valid module';
  end if;
  if requested_category in ('access', 'practice', 'content') and requested_subject_id is null then
    raise exception 'Choose the affected module';
  end if;
  if (select count(*) from public.support_requests where user_id = v_user_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You have sent several requests recently. Please wait before sending another';
  end if;

  insert into public.support_requests (
    user_id, category, subject, description, payment_reference, page_path, subject_id
  ) values (
    v_user_id,
    requested_category,
    btrim(requested_subject),
    btrim(requested_description),
    nullif(btrim(coalesce(requested_payment_reference, '')), ''),
    nullif(btrim(coalesce(requested_page_path, '')), ''),
    requested_subject_id
  ) returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.create_support_request_v2(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_request_v2(text, text, text, text, text, uuid) to authenticated;
