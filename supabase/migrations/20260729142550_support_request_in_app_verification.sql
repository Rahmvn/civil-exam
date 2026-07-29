alter table public.support_requests
  add column if not exists request_source text not null default 'in_app',
  add column if not exists verification_status text not null default 'logged_in_user';

alter table public.support_requests
  drop constraint if exists support_requests_request_source_check;

alter table public.support_requests
  add constraint support_requests_request_source_check
  check (request_source in ('in_app', 'email', 'whatsapp', 'admin_manual'));

alter table public.support_requests
  drop constraint if exists support_requests_verification_status_check;

alter table public.support_requests
  add constraint support_requests_verification_status_check
  check (verification_status in ('unverified', 'logged_in_user', 'email_otp_verified', 'phone_otp_verified', 'admin_reviewed'));

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
    user_id, category, subject, description, payment_reference, page_path, subject_id,
    request_source, verification_status
  ) values (
    v_user_id,
    requested_category,
    btrim(requested_subject),
    btrim(requested_description),
    nullif(btrim(coalesce(requested_payment_reference, '')), ''),
    nullif(btrim(coalesce(requested_page_path, '')), ''),
    requested_subject_id,
    'in_app',
    'logged_in_user'
  ) returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.create_support_request_v2(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_request_v2(text, text, text, text, text, uuid) to authenticated;

drop function if exists public.get_admin_support_requests(integer);

create function public.get_admin_support_requests(requested_limit integer default 100)
returns table (
  id uuid,
  user_id uuid,
  requester_name text,
  requester_email text,
  category text,
  subject text,
  description text,
  payment_reference text,
  page_path text,
  request_source text,
  verification_status text,
  status text,
  resolution_note text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  return query
  select
    sr.id,
    sr.user_id,
    p.full_name,
    p.email,
    sr.category,
    sr.subject,
    sr.description,
    sr.payment_reference,
    sr.page_path,
    sr.request_source,
    sr.verification_status,
    sr.status,
    sr.resolution_note,
    sr.created_at,
    sr.updated_at
  from public.support_requests sr
  left join public.profiles p on p.id = sr.user_id
  order by
    case sr.status when 'received' then 1 when 'in_review' then 2 when 'resolved' then 3 else 4 end,
    sr.created_at asc
  limit greatest(1, least(coalesce(requested_limit, 100), 200));
end;
$$;

create or replace function public.get_admin_support_queue(
  requested_status text default 'open',
  requested_query text default null,
  requested_limit integer default 25,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(requested_status, 'open')));
  v_query text := nullif(btrim(coalesce(requested_query, '')), '');
  v_limit integer := greatest(10, least(coalesce(requested_limit, 25), 50));
  v_offset integer := greatest(0, coalesce(requested_offset, 0));
  v_total integer;
  v_items jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if v_status not in ('all', 'open', 'received', 'in_review', 'resolved', 'closed') then
    raise exception 'Choose a valid support status';
  end if;
  if char_length(coalesce(v_query, '')) > 120 then raise exception 'Support search is too long'; end if;

  select jsonb_build_object(
    'open', count(*) filter (where sr.status in ('received', 'in_review')),
    'received', count(*) filter (where sr.status = 'received'),
    'in_review', count(*) filter (where sr.status = 'in_review'),
    'resolved', count(*) filter (where sr.status = 'resolved'),
    'closed', count(*) filter (where sr.status = 'closed'),
    'all', count(*)
  ) into v_counts from public.support_requests sr;

  select count(*)::integer into v_total
  from public.support_requests sr
  left join public.profiles p on p.id = sr.user_id
  left join public.subjects s on s.id = sr.subject_id
  where (v_status = 'all' or (v_status = 'open' and sr.status in ('received', 'in_review')) or sr.status = v_status)
    and (v_query is null or concat_ws(' ', sr.subject, sr.description, p.full_name, p.email, sr.payment_reference, s.name)
      ilike '%' || v_query || '%');

  select coalesce(jsonb_agg(to_jsonb(queue_row)), '[]'::jsonb) into v_items
  from (
    select sr.id, sr.user_id, p.full_name as requester_name, p.email as requester_email,
      sr.category, sr.subject, sr.description, sr.payment_reference, sr.page_path,
      sr.subject_id, s.name as subject_name, s.slug as subject_slug,
      sr.request_source, sr.verification_status,
      sr.status, sr.resolution_note, sr.created_at, sr.updated_at
    from public.support_requests sr
    left join public.profiles p on p.id = sr.user_id
    left join public.subjects s on s.id = sr.subject_id
    where (v_status = 'all' or (v_status = 'open' and sr.status in ('received', 'in_review')) or sr.status = v_status)
      and (v_query is null or concat_ws(' ', sr.subject, sr.description, p.full_name, p.email, sr.payment_reference, s.name)
        ilike '%' || v_query || '%')
    order by case sr.status when 'received' then 1 when 'in_review' then 2 when 'resolved' then 3 else 4 end,
      case when sr.status in ('received', 'in_review') then sr.created_at end asc,
      case when sr.status in ('resolved', 'closed') then sr.updated_at end desc, sr.id
    limit v_limit offset v_offset
  ) queue_row;

  return jsonb_build_object('items', v_items, 'total', v_total, 'counts', v_counts,
    'limit', v_limit, 'offset', v_offset, 'has_more', v_offset + jsonb_array_length(v_items) < v_total);
end;
$$;

revoke all on function public.get_admin_support_requests(integer) from public, anon;
revoke all on function public.get_admin_support_queue(text, text, integer, integer) from public, anon;
grant execute on function public.get_admin_support_requests(integer) to authenticated;
grant execute on function public.get_admin_support_queue(text, text, integer, integer) to authenticated;
