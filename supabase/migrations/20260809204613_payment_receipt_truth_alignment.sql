-- Canonical, historical payment presentation for duration pricing and legacy orders.
-- Important purchase facts come from the immutable order snapshot first. Live
-- subject rows are only a compatibility fallback for pre-snapshot orders.

create or replace function public.build_payment_order_presentation(
  requested_order_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders;
  v_items jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_product_label text;
  v_purchase_scope text;
  v_plan_name text;
  v_plan_type text;
  v_provider_status text;
  v_fulfillment_status text;
  v_record_type text;
  v_access_result_kind text;
  v_receipt_eligible boolean;
  v_extension_count integer := 0;
  v_purchase_intent text := 'purchase';
begin
  select po.* into v_order
  from public.payment_orders po
  where po.id = requested_order_id;

  if v_order.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'subject_id', poi.subject_id,
      'subject_name', coalesce(
        nullif(snapshot_module.module ->> 'subject_name', ''),
        s.name
      ),
      'subject_slug', coalesce(
        nullif(snapshot_module.module ->> 'subject_slug', ''),
        s.slug
      ),
      'practice_type', coalesce(
        nullif(snapshot_module.module ->> 'practice_type', ''),
        s.practice_type::text
      ),
      'list_price_kobo', poi.list_price_kobo,
      'allocated_amount_kobo', poi.allocated_amount_kobo
    )
    order by coalesce(snapshot_module.position, 2147483647), s.sort_order, s.name, poi.id
  ), '[]'::jsonb)
  into v_items
  from public.payment_order_items poi
  join public.subjects s on s.id = poi.subject_id
  left join lateral (
    select snapshot.value as module, snapshot.ordinality::integer as position
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_order.purchase_snapshot -> 'modules') = 'array'
          then v_order.purchase_snapshot -> 'modules'
        else '[]'::jsonb
      end
    ) with ordinality snapshot(value, ordinality)
    where snapshot.value ->> 'subject_id' = poi.subject_id::text
    limit 1
  ) snapshot_module on true
  where poi.payment_order_id = v_order.id;

  v_item_count := jsonb_array_length(v_items);
  if v_item_count = 0 and v_order.subject_id is not null then
    select jsonb_build_array(jsonb_build_object(
      'subject_id', s.id,
      'subject_name', s.name,
      'subject_slug', s.slug,
      'practice_type', s.practice_type::text,
      'list_price_kobo', v_order.list_price_kobo,
      'allocated_amount_kobo', v_order.amount_kobo
    ))
    into v_items
    from public.subjects s
    where s.id = v_order.subject_id;
    v_items := coalesce(v_items, '[]'::jsonb);
    v_item_count := jsonb_array_length(v_items);
  end if;

  if v_order.purchase_type = 'pricing_plan' and v_item_count > 0 then
    select count(*)::integer into v_extension_count
    from public.payment_order_items poi
    where poi.payment_order_id = v_order.id
      and exists (
        select 1
        from public.module_entitlements me
        where me.user_id = v_order.user_id
          and me.exam_pack_id = v_order.exam_pack_id
          and me.subject_id = poi.subject_id
          and me.payment_order_id is distinct from v_order.id
          and coalesce(me.metadata -> 'pricing_plan_order_ids', '[]'::jsonb) ? v_order.id::text
      );

    v_purchase_intent := case
      when v_extension_count = v_item_count then 'extension'
      when v_extension_count > 0 then 'mixed'
      else 'purchase'
    end;
  end if;
  v_plan_name := nullif(v_order.purchase_snapshot ->> 'plan_name', '');
  v_plan_type := nullif(v_order.purchase_snapshot ->> 'plan_type', '');
  if v_order.purchase_type = 'pricing_plan' and (v_plan_name is null or v_plan_type is null) then
    select
      coalesce(v_plan_name, plan.display_name),
      coalesce(v_plan_type, plan.plan_type)
    into v_plan_name, v_plan_type
    from public.purchase_plans plan
    where plan.id = v_order.purchase_plan_id;
  end if;

  v_purchase_scope := case
    when v_order.purchase_type = 'pricing_plan' then coalesce(v_plan_type, 'pricing_plan')
    when v_order.purchase_type = 'single_module' then 'single_module'
    when v_order.purchase_type = 'bundle_offer' then 'bundle_offer'
    else v_order.purchase_type
  end;

  v_product_label := case
    when v_purchase_scope = 'single_module' or (
      v_order.purchase_type = 'pricing_plan' and v_plan_type = 'single_module'
    ) then coalesce(
      nullif(v_items #>> '{0,subject_name}', ''),
      v_plan_name,
      nullif(v_order.purchase_label, ''),
      'Module access'
    )
    else coalesce(
      v_plan_name,
      nullif(v_order.purchase_label, ''),
      case when v_item_count > 1 then v_item_count || '-module access' else 'Module access' end
    )
  end;

  v_provider_status := lower(coalesce(
    nullif(v_order.provider_status, ''),
    case when v_order.status = 'active' then 'success' end,
    'initialized'
  ));
  v_fulfillment_status := case
    when v_order.fulfillment_status = 'fulfilled' then 'fulfilled'
    else v_order.fulfillment_status
  end;

  v_record_type := case
    when v_order.review_status in ('refund_pending', 'disputed', 'access_review') then 'attention'
    when v_provider_status in ('ongoing', 'pending', 'processing', 'queued') then 'attention'
    when v_provider_status = 'success' and v_fulfillment_status <> 'fulfilled' then 'attention'
    else 'history'
  end;

  v_access_result_kind := case
    when v_order.access_expires_at is null then 'not_recorded'
    when v_item_count = 1 then 'exact'
    when v_item_count > 1 then 'latest'
    else 'not_recorded'
  end;

  v_receipt_eligible := v_provider_status = 'success'
    and v_fulfillment_status = 'fulfilled'
    and v_order.review_status in ('clear', 'dispute_resolved');

  return jsonb_build_object(
    'id', v_order.id,
    'user_id', v_order.user_id,
    'provider', v_order.provider,
    'provider_reference', v_order.provider_reference,
    'status', v_order.status,
    'provider_status', v_provider_status,
    'fulfillment_status', v_fulfillment_status,
    'fulfillment_error', v_order.fulfillment_error,
    'review_status', v_order.review_status,
    'refunded_amount_kobo', v_order.refunded_amount_kobo,
    'record_type', v_record_type,
    'receipt_eligible', v_receipt_eligible,
    'purchase_type', v_order.purchase_type,
    'purchase_scope', v_purchase_scope,
    'purchase_label', v_order.purchase_label,
    'product_label', v_product_label,
    'plan_code', coalesce(nullif(v_order.purchase_snapshot ->> 'plan_code', ''), v_order.plan_code),
    'duration_months', coalesce(
      case
        when coalesce(v_order.purchase_snapshot ->> 'duration_months', '') ~ '^\d+$'
          then (v_order.purchase_snapshot ->> 'duration_months')::integer
        else null
      end,
      v_order.duration_months
    ),
    'items', v_items,
    'item_count', v_item_count,
    'purchase_intent', v_purchase_intent,
    'extension_count', v_extension_count,
    'new_access_count', greatest(v_item_count - v_extension_count, 0),
    'amount_kobo', v_order.amount_kobo,
    'list_price_kobo', v_order.list_price_kobo,
    'currency', v_order.currency,
    'created_at', v_order.created_at,
    'paid_at', v_order.paid_at,
    'access_starts_at', v_order.access_starts_at,
    'access_expires_at', v_order.access_expires_at,
    'access_result_kind', v_access_result_kind,
    'pricing_version', v_order.pricing_version
  );
end;
$$;

revoke all on function public.build_payment_order_presentation(uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_payment_order_presentation_for_service(
  requested_reference text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.build_payment_order_presentation(po.id)
  from public.payment_orders po
  where po.provider_reference = requested_reference;
$$;

revoke all on function public.get_payment_order_presentation_for_service(text)
from public, anon, authenticated, service_role;
grant execute on function public.get_payment_order_presentation_for_service(text)
to service_role;

drop function if exists public.get_payment_history(integer);
create function public.get_payment_history(requested_limit integer default 20)
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
  fulfillment_status text,
  record_type text,
  review_status text,
  refunded_amount_kobo integer,
  purchase_type text,
  purchase_label text,
  purchase_scope text,
  product_label text,
  plan_code text,
  duration_months integer,
  items jsonb,
  item_count integer,
  purchase_intent text,
  extension_count integer,
  access_result_kind text,
  receipt_eligible boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
  from (
    select
      po.id,
      po.provider_reference,
      po.status,
      po.amount_kobo,
      po.currency,
      po.access_expires_at,
      po.created_at,
      po.paid_at,
      case when (truth.data ->> 'item_count')::integer = 1
        then (truth.data #>> '{items,0,subject_id}')::uuid else null end,
      case when (truth.data ->> 'item_count')::integer = 1
        then truth.data #>> '{items,0,subject_name}' else null end,
      case when (truth.data ->> 'item_count')::integer = 1
        then truth.data #>> '{items,0,subject_slug}' else null end,
      false,
      truth.data ->> 'provider_status',
      truth.data ->> 'fulfillment_status',
      truth.data ->> 'record_type',
      truth.data ->> 'review_status',
      coalesce((truth.data ->> 'refunded_amount_kobo')::integer, 0),
      truth.data ->> 'purchase_type',
      truth.data ->> 'purchase_label',
      truth.data ->> 'purchase_scope',
      truth.data ->> 'product_label',
      truth.data ->> 'plan_code',
      (truth.data ->> 'duration_months')::integer,
      truth.data -> 'items',
      (truth.data ->> 'item_count')::integer,
      truth.data ->> 'purchase_intent',
      (truth.data ->> 'extension_count')::integer,
      truth.data ->> 'access_result_kind',
      (truth.data ->> 'receipt_eligible')::boolean
    from public.payment_orders po
    cross join lateral (
      select public.build_payment_order_presentation(po.id) as data
    ) truth
    where po.user_id = auth.uid()
      and (truth.data ->> 'provider_status') in (
        'success', 'ongoing', 'pending', 'processing', 'queued', 'reversed',
        'failed', 'abandoned', 'cancelled', 'canceled', 'declined', 'timeout'
      )

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
      'success',
      'fulfilled',
      'history',
      'clear',
      0,
      'legacy_full_access',
      'Legacy full access',
      'legacy_full_access',
      'Legacy full access',
      null::text,
      null::integer,
      '[]'::jsonb,
      0,
      'purchase',
      0,
      'exact',
      true
    from public.entitlements e
    where e.user_id = auth.uid() and e.status = 'active'
  ) visible_payments
  order by visible_payments.created_at desc
  limit greatest(1, least(coalesce(requested_limit, 20), 100));
$$;

revoke all on function public.get_payment_history(integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_payment_history(integer)
to authenticated;

drop function if exists public.get_admin_payment_attention(integer);
create function public.get_admin_payment_attention(requested_limit integer default 100)
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
  support_request_status text,
  purchase_scope text,
  duration_months integer,
  items jsonb
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
    case when (truth.data ->> 'item_count')::integer = 1
      then (truth.data #>> '{items,0,subject_id}')::uuid else null end,
    truth.data ->> 'product_label',
    case when (truth.data ->> 'item_count')::integer = 1
      then truth.data #>> '{items,0,subject_slug}' else null end,
    po.provider_reference,
    po.amount_kobo,
    po.currency,
    po.paid_at,
    po.created_at,
    truth.data ->> 'provider_status',
    truth.data ->> 'fulfillment_status',
    po.fulfillment_error,
    po.review_status,
    case
      when po.review_status = 'access_review' then 'access_review'
      when po.review_status = 'disputed' then 'dispute'
      when po.review_status = 'refund_pending' then 'refund_pending'
      when po.provider_status = 'success'
        and po.review_status = 'clear'
        and po.fulfillment_status <> 'fulfilled' then 'access_issue'
      else 'processing_delayed'
    end,
    entitlement.status,
    po.access_expires_at,
    support.id,
    support.status,
    truth.data ->> 'purchase_scope',
    (truth.data ->> 'duration_months')::integer,
    truth.data -> 'items'
  from public.payment_orders po
  join public.profiles p on p.id = po.user_id
  cross join lateral (
    select public.build_payment_order_presentation(po.id) as data
  ) truth
  left join lateral (
    select candidate_entitlement.status
    from public.module_entitlements candidate_entitlement
    where candidate_entitlement.payment_order_id = po.id
       or coalesce(candidate_entitlement.metadata -> 'pricing_plan_order_ids', '[]'::jsonb) ? po.id::text
    order by candidate_entitlement.updated_at desc
    limit 1
  ) entitlement on true
  left join lateral (
    select candidate_request.id, candidate_request.status
    from public.support_requests candidate_request
    where candidate_request.user_id = po.user_id
      and candidate_request.payment_reference = po.provider_reference
    order by
      case candidate_request.status when 'received' then 1 when 'in_review' then 2 else 3 end,
      candidate_request.created_at desc
    limit 1
  ) support on true
  where
    po.review_status in ('refund_pending', 'disputed', 'access_review')
    or (
      po.provider_status = 'success'
      and po.review_status = 'clear'
      and po.fulfillment_status <> 'fulfilled'
    )
    or (
      po.provider_status in ('ongoing', 'pending', 'processing', 'queued')
      and po.created_at < now() - interval '15 minutes'
    )
  order by
    case
      when po.provider_status = 'success' and po.review_status = 'clear' then 1
      when po.review_status = 'access_review' then 2
      when po.review_status = 'disputed' then 3
      when po.review_status = 'refund_pending' then 4
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
  ) into v_counts
  from public.transactional_email_events;

  with matching as (
    select tee.*, po.provider_reference, po.purchase_label, p.full_name, p.email,
      public.build_payment_order_presentation(tee.payment_order_id) as truth
    from public.transactional_email_events tee
    left join public.payment_orders po on po.id = tee.payment_order_id
    left join public.profiles p on p.id = tee.user_id
    where (v_status = 'all' or tee.status = v_status)
  )
  select count(*)::integer into v_total
  from matching
  where v_query is null or concat_ws(
    ' ', event_type, recipient_email, provider, provider_message_id, error_message,
    provider_reference, purchase_label, full_name, email,
    truth ->> 'product_label', truth ->> 'plan_code'
  ) ilike '%' || v_query || '%';

  with matching as (
    select tee.*, po.provider_reference, po.purchase_type, po.purchase_label,
      po.subject_id, p.full_name as requester_name, p.email as profile_email,
      public.build_payment_order_presentation(tee.payment_order_id) as truth
    from public.transactional_email_events tee
    left join public.payment_orders po on po.id = tee.payment_order_id
    left join public.profiles p on p.id = tee.user_id
    where (v_status = 'all' or tee.status = v_status)
  )
  select coalesce(jsonb_agg(to_jsonb(email_row)), '[]'::jsonb) into v_items
  from (
    select
      id, event_key, event_type, recipient_email, user_id, requester_name,
      profile_email, payment_order_id, provider_reference, purchase_type,
      purchase_label, subject_id,
      truth ->> 'product_label' as product_label,
      truth ->> 'purchase_scope' as purchase_scope,
      (truth ->> 'duration_months')::integer as duration_months,
      truth -> 'items' as items,
      case when (truth ->> 'item_count')::integer = 1
        then truth #>> '{items,0,subject_name}' else null end as subject_name,
      case when (truth ->> 'item_count')::integer = 1
        then truth #>> '{items,0,subject_slug}' else null end as subject_slug,
      provider, provider_message_id, status, error_message, attempted_at,
      sent_at, created_at, updated_at
    from matching
    where v_query is null or concat_ws(
      ' ', event_type, recipient_email, provider, provider_message_id, error_message,
      provider_reference, purchase_label, requester_name, profile_email,
      truth ->> 'product_label', truth ->> 'plan_code'
    ) ilike '%' || v_query || '%'
    order by
      case status when 'failed' then 1 when 'skipped' then 2 when 'pending' then 3 else 4 end,
      coalesce(attempted_at, created_at) desc,
      id
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
