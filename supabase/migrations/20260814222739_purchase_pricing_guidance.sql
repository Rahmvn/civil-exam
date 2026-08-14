-- Advisory Admin pricing guidance. Selling prices remain authoritative in
-- purchase_plan_prices and historical orders retain their immutable snapshots.

alter table public.purchase_durations
  add column recommended_discount_bps integer,
  add constraint purchase_durations_recommended_discount_bps_check
    check (
      recommended_discount_bps is null
      or recommended_discount_bps between 0 and 9900
    );

comment on column public.purchase_durations.recommended_discount_bps is
  'Optional advisory duration discount in basis points. Null requires an explicit Admin-entered guidance percentage.';

update public.purchase_durations
set recommended_discount_bps = case months
  when 1 then 0
  when 2 then 700
  when 3 then 1400
  else null
end;

create or replace function public.calculate_purchase_recommended_price_kobo(
  requested_full_total_kobo integer,
  requested_discount_bps integer,
  requested_rounding_increment_kobo integer default 50000
)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when requested_full_total_kobo is null
      or requested_full_total_kobo <= 0
      or requested_discount_bps is null
      or requested_discount_bps < 0
      or requested_discount_bps >= 10000
      then null
    else greatest(
      (
        round(
          (
            requested_full_total_kobo::numeric
            * (10000 - requested_discount_bps)::numeric
            / 10000
          )
          / greatest(coalesce(requested_rounding_increment_kobo, 50000), 1)::numeric
        )
        * greatest(coalesce(requested_rounding_increment_kobo, 50000), 1)
      )::integer,
      greatest(coalesce(requested_rounding_increment_kobo, 50000), 1)
    )
  end;
$$;

create or replace function public.get_admin_purchase_pricing_guidance()
returns table (
  plan_code text,
  plan_display_name text,
  plan_type text,
  duration_months integer,
  current_available_module_count integer,
  one_month_price_kobo integer,
  full_monthly_total_kobo integer,
  recommended_discount_bps integer,
  recommended_price_kobo integer,
  actual_price_kobo integer,
  actual_saving_kobo integer,
  actual_saving_percent numeric,
  currency text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert_access();

  return query
  with module_summary as (
    select public.get_current_purchasable_module_count() as module_count
  ),
  price_matrix as (
    select
      plan.id as purchase_plan_id,
      plan.code,
      plan.display_name,
      plan.plan_type,
      duration.months,
      duration.sort_order as duration_sort_order,
      duration.recommended_discount_bps,
      coalesce(price.currency, 'NGN') as currency,
      public.calculate_configured_plan_price_kobo(
        plan.plan_type,
        price.price_kobo,
        price.complete_bundle_unit_price_kobo,
        summary.module_count,
        plan.complete_bundle_rounding_increment_kobo
      ) as actual_price_kobo,
      summary.module_count
    from public.purchase_plans plan
    cross join public.purchase_durations duration
    cross join module_summary summary
    left join public.purchase_plan_prices price
      on price.purchase_plan_id = plan.id
     and price.duration_months = duration.months
  ),
  guidance as (
    select
      current_price.*,
      one_month.actual_price_kobo as one_month_price_kobo,
      case
        when one_month.actual_price_kobo > 0
          then one_month.actual_price_kobo * current_price.months
        else null
      end as full_monthly_total_kobo
    from price_matrix current_price
    left join price_matrix one_month
      on one_month.purchase_plan_id = current_price.purchase_plan_id
     and one_month.months = 1
  ),
  recommended as (
    select
      guidance.*,
      public.calculate_purchase_recommended_price_kobo(
        guidance.full_monthly_total_kobo,
        guidance.recommended_discount_bps,
        50000
      ) as recommended_price_kobo
    from guidance
  )
  select
    recommended.code,
    recommended.display_name,
    recommended.plan_type,
    recommended.months,
    recommended.module_count,
    recommended.one_month_price_kobo,
    recommended.full_monthly_total_kobo,
    recommended.recommended_discount_bps,
    recommended.recommended_price_kobo,
    recommended.actual_price_kobo,
    case
      when recommended.full_monthly_total_kobo is not null
        and recommended.actual_price_kobo is not null
        then recommended.full_monthly_total_kobo - recommended.actual_price_kobo
      else null
    end,
    case
      when recommended.full_monthly_total_kobo > 0
        and recommended.actual_price_kobo is not null
        then round(
          (
            recommended.full_monthly_total_kobo - recommended.actual_price_kobo
          )::numeric * 100 / recommended.full_monthly_total_kobo,
          1
        )
      else null
    end,
    recommended.currency
  from recommended
  order by recommended.code, recommended.duration_sort_order, recommended.months;
end;
$$;

revoke all on function public.calculate_purchase_recommended_price_kobo(integer, integer, integer)
from public, anon, authenticated;
revoke all on function public.get_admin_purchase_pricing_guidance()
from public, anon;
grant execute on function public.get_admin_purchase_pricing_guidance()
to authenticated;
