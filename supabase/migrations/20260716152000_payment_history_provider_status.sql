drop function if exists public.get_payment_history(integer);

create or replace function public.get_payment_history(requested_limit integer default 20)
returns table (
  id uuid,
  provider_reference text,
  status public.payment_status,
  amount_kobo integer,
  currency text,
  access_expires_at timestamptz,
  created_at timestamptz,
  paid_at timestamptz,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  is_legacy_full_access boolean,
  provider_status text,
  provider_message text
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from (
    select
      po.id,
      po.provider_reference,
      po.status,
      po.amount_kobo,
      po.currency,
      me.expires_at,
      po.created_at,
      po.paid_at,
      po.subject_id,
      s.name,
      s.slug,
      false,
      lower(nullif(coalesce(
        po.provider_payload #>> '{data,status}',
        po.provider_payload ->> 'status'
      ), '')),
      nullif(coalesce(
        po.provider_payload #>> '{data,gateway_response}',
        po.provider_payload #>> '{data,message}',
        po.provider_payload ->> 'message'
      ), '')
    from public.payment_orders as po
    join public.subjects as s on s.id = po.subject_id
    left join public.module_entitlements as me on me.payment_order_id = po.id
    where po.user_id = auth.uid()
    union all
    select
      e.id,
      e.paystack_reference,
      e.status,
      e.amount_kobo,
      e.currency,
      e.expires_at,
      e.created_at,
      case when e.status = 'active' then e.updated_at else null end,
      null::uuid,
      null::text,
      null::text,
      true,
      lower(nullif(coalesce(
        e.metadata #>> '{data,status}',
        e.metadata ->> 'status'
      ), '')),
      nullif(coalesce(
        e.metadata #>> '{data,gateway_response}',
        e.metadata #>> '{data,message}',
        e.metadata ->> 'message'
      ), '')
    from public.entitlements as e
    where e.user_id = auth.uid()
  ) as history
  order by history.created_at desc
  limit greatest(coalesce(requested_limit, 20), 1);
$$;

grant execute on function public.get_payment_history(integer) to authenticated;
