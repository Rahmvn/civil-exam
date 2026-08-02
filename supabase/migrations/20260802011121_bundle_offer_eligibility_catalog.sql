drop function if exists public.get_bundle_offer_catalog();

create or replace function public.get_bundle_offer_catalog()
returns table (
  offer_id uuid,
  offer_name text,
  offer_type text,
  selection_count integer,
  price_kobo integer,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  available_module_count integer,
  list_price_kobo integer,
  modules jsonb,
  is_applicable boolean,
  eligibility_reason text,
  eligibility_message text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  return query
  with catalog as (
    select c.*
    from public.get_module_access_catalog_v2() c
    where c.can_purchase = true
  ),
  access_totals as (
    select
      count(*)::integer as purchasable_count,
      count(*) filter (where c.has_module_access)::integer as owned_count
    from catalog c
  ),
  available as (
    select c.*
    from catalog c
    where c.has_module_access = false
  ),
  available_summary as (
    select
      count(*)::integer as module_count,
      coalesce(sum(a.price_kobo), 0)::integer as total_price_kobo,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'subject_id', a.subject_id,
            'subject_name', a.subject_name,
            'subject_slug', a.subject_slug,
            'price_kobo', a.price_kobo,
            'regular_price_kobo', a.regular_price_kobo,
            'currency', a.currency
          ) order by a.subject_name
        ),
        '[]'::jsonb
      ) as modules
    from available a
  ),
  offer_checks as (
    select
      po.id,
      po.name,
      po.offer_type,
      po.selection_count,
      po.price_kobo,
      po.currency,
      po.starts_at,
      po.ends_at,
      summary.module_count,
      summary.total_price_kobo,
      summary.modules,
      totals.owned_count,
      totals.purchasable_count,
      (
        select coalesce(sum(cheapest.price_kobo), 0)::integer
        from (
          select a.price_kobo
          from available a
          order by a.price_kobo, a.subject_id
          limit greatest(coalesce(po.selection_count, 0), 0)
        ) cheapest
      ) as pick_n_list_price_kobo
    from public.purchase_offers po
    join public.exam_packs ep on ep.id = po.exam_pack_id and ep.is_active = true
    cross join available_summary summary
    cross join access_totals totals
    where po.enabled = true
      and (po.starts_at is null or now() >= po.starts_at)
      and (po.ends_at is null or now() < po.ends_at)
      and po.currency = 'NGN'
      and po.offer_type in ('pick_n_modules', 'full_bundle')
  ),
  evaluated as (
    select
      oc.*,
      case
        when oc.offer_type = 'pick_n_modules' and oc.module_count < oc.selection_count
          then 'not_enough_modules_left'
        when oc.offer_type = 'pick_n_modules' and oc.price_kobo >= oc.pick_n_list_price_kobo
          then 'no_current_saving'
        when oc.offer_type = 'full_bundle' and oc.purchasable_count = 0
          then 'no_modules_available'
        when oc.offer_type = 'full_bundle' and oc.module_count = 0
          then 'all_modules_unlocked'
        when oc.offer_type = 'full_bundle' and oc.owned_count > 0
          then 'full_bundle_new_candidates_only'
        when oc.offer_type = 'full_bundle' and oc.price_kobo >= oc.total_price_kobo
          then 'no_current_saving'
        else 'available'
      end as reason
    from offer_checks oc
  )
  select
    e.id,
    e.name,
    e.offer_type,
    e.selection_count,
    e.price_kobo,
    e.currency,
    e.starts_at,
    e.ends_at,
    e.module_count,
    case
      when e.offer_type = 'full_bundle' then e.total_price_kobo
      when e.offer_type = 'pick_n_modules' then e.pick_n_list_price_kobo
      else null
    end,
    e.modules,
    (e.reason = 'available') as is_applicable,
    e.reason as eligibility_reason,
    case e.reason
      when 'available' then null
      when 'not_enough_modules_left' then 'Not enough locked modules left for this bundle.'
      when 'all_modules_unlocked' then 'You have already unlocked the modules in this bundle.'
      when 'full_bundle_new_candidates_only' then 'Full bundle is only available before unlocking individual modules.'
      when 'no_current_saving' then 'This bundle is not cheaper than your available modules right now.'
      when 'no_modules_available' then 'No modules are currently available for this bundle.'
      else 'This bundle is not available for your account right now.'
    end as eligibility_message
  from evaluated e
  order by
    case e.reason when 'available' then 1 else 2 end,
    case e.offer_type when 'pick_n_modules' then 1 else 2 end,
    e.price_kobo;
end;
$$;

revoke all on function public.get_bundle_offer_catalog() from public, anon;
grant execute on function public.get_bundle_offer_catalog() to authenticated;
