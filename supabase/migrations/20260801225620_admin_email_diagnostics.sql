create or replace function public.get_admin_transactional_email_events(
  requested_status text default 'all',
  requested_query text default null,
  requested_limit integer default 50,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(requested_status, 'all')));
  v_query text := nullif(btrim(coalesce(requested_query, '')), '');
  v_limit integer := greatest(10, least(coalesce(requested_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(requested_offset, 0));
  v_total integer;
  v_items jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_status not in ('all', 'pending', 'sent', 'failed', 'skipped') then
    raise exception 'Choose a valid email status';
  end if;

  if char_length(coalesce(v_query, '')) > 120 then
    raise exception 'Email search is too long';
  end if;

  select jsonb_build_object(
    'all', count(*),
    'pending', count(*) filter (where status = 'pending'),
    'sent', count(*) filter (where status = 'sent'),
    'failed', count(*) filter (where status = 'failed'),
    'skipped', count(*) filter (where status = 'skipped')
  )
  into v_counts
  from public.transactional_email_events;

  select count(*)::integer
  into v_total
  from public.transactional_email_events tee
  left join public.payment_orders po on po.id = tee.payment_order_id
  left join public.profiles p on p.id = tee.user_id
  left join public.subjects s on s.id = po.subject_id
  where (v_status = 'all' or tee.status = v_status)
    and (
      v_query is null
      or concat_ws(
        ' ',
        tee.event_type,
        tee.recipient_email,
        tee.provider,
        tee.provider_message_id,
        tee.error_message,
        po.provider_reference,
        po.purchase_label,
        p.full_name,
        p.email,
        s.name,
        s.slug
      ) ilike '%' || v_query || '%'
    );

  select coalesce(jsonb_agg(to_jsonb(email_row)), '[]'::jsonb)
  into v_items
  from (
    select
      tee.id,
      tee.event_key,
      tee.event_type,
      tee.recipient_email,
      tee.user_id,
      p.full_name as requester_name,
      p.email as profile_email,
      tee.payment_order_id,
      po.provider_reference,
      po.purchase_type,
      po.purchase_label,
      po.subject_id,
      s.name as subject_name,
      s.slug as subject_slug,
      tee.provider,
      tee.provider_message_id,
      tee.status,
      tee.error_message,
      tee.attempted_at,
      tee.sent_at,
      tee.created_at,
      tee.updated_at
    from public.transactional_email_events tee
    left join public.payment_orders po on po.id = tee.payment_order_id
    left join public.profiles p on p.id = tee.user_id
    left join public.subjects s on s.id = po.subject_id
    where (v_status = 'all' or tee.status = v_status)
      and (
        v_query is null
        or concat_ws(
          ' ',
          tee.event_type,
          tee.recipient_email,
          tee.provider,
          tee.provider_message_id,
          tee.error_message,
          po.provider_reference,
          po.purchase_label,
          p.full_name,
          p.email,
          s.name,
          s.slug
        ) ilike '%' || v_query || '%'
      )
    order by
      case tee.status when 'failed' then 1 when 'skipped' then 2 when 'pending' then 3 else 4 end,
      coalesce(tee.attempted_at, tee.created_at) desc,
      tee.id
    limit v_limit offset v_offset
  ) email_row;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'counts', v_counts,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_offset + jsonb_array_length(v_items) < v_total
  );
end;
$$;

revoke all on function public.get_admin_transactional_email_events(text, text, integer, integer)
from public, anon, authenticated, service_role;

grant execute on function public.get_admin_transactional_email_events(text, text, integer, integer)
to authenticated;
