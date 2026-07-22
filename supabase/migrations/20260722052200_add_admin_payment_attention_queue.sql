create or replace function public.get_admin_payment_attention(requested_limit integer default 100)
returns table (
  payment_order_id uuid,
  user_id uuid,
  requester_name text,
  requester_email text,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  provider_reference text,
  amount_kobo integer,
  currency text,
  paid_at timestamptz,
  created_at timestamptz,
  provider_status text,
  fulfillment_status text,
  fulfillment_error text,
  review_status text,
  attention_type text,
  entitlement_status public.payment_status,
  access_expires_at timestamptz,
  support_request_id uuid,
  support_request_status text
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
    po.id,
    po.user_id,
    p.full_name,
    p.email,
    po.subject_id,
    s.name,
    s.slug,
    po.provider_reference,
    po.amount_kobo,
    po.currency,
    po.paid_at,
    po.created_at,
    po.provider_status,
    po.fulfillment_status,
    po.fulfillment_error,
    po.review_status,
    case
      when po.review_status = 'disputed' then 'dispute'
      when po.review_status = 'refund_pending' then 'refund_pending'
      when po.provider_status = 'success'
        and po.review_status = 'clear'
        and not (
          po.fulfillment_status = 'fulfilled'
          or coalesce(me.status = 'active' and me.expires_at > now(), false)
        ) then 'access_issue'
      else 'processing_delayed'
    end,
    me.status,
    me.expires_at,
    sr.id,
    sr.status
  from public.payment_orders po
  join public.profiles p on p.id = po.user_id
  join public.subjects s on s.id = po.subject_id
  left join lateral (
    select candidate_entitlement.status, candidate_entitlement.expires_at
    from public.module_entitlements candidate_entitlement
    where candidate_entitlement.payment_order_id = po.id
    order by candidate_entitlement.created_at desc
    limit 1
  ) me on true
  left join lateral (
    select candidate_request.id, candidate_request.status
    from public.support_requests candidate_request
    where candidate_request.user_id = po.user_id
      and candidate_request.payment_reference = po.provider_reference
    order by
      case candidate_request.status when 'received' then 1 when 'in_review' then 2 else 3 end,
      candidate_request.created_at desc
    limit 1
  ) sr on true
  where
    po.review_status in ('refund_pending', 'disputed')
    or (
      po.provider_status = 'success'
      and po.review_status = 'clear'
      and not (
        po.fulfillment_status = 'fulfilled'
        or coalesce(me.status = 'active' and me.expires_at > now(), false)
      )
    )
    or (
      po.provider_status in ('ongoing', 'pending', 'processing', 'queued')
      and po.created_at < now() - interval '15 minutes'
    )
  order by
    case
      when po.provider_status = 'success' and po.review_status = 'clear' then 1
      when po.review_status = 'disputed' then 2
      when po.review_status = 'refund_pending' then 3
      else 4
    end,
    coalesce(po.paid_at, po.created_at) asc
  limit greatest(1, least(coalesce(requested_limit, 100), 200));
end;
$$;

revoke all on function public.get_admin_payment_attention(integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_admin_payment_attention(integer)
to authenticated;
