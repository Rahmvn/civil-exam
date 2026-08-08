create or replace function public.get_purchase_pricing_catalog_v1()
returns table (
  plan_id uuid,
  plan_code text,
  plan_type text,
  display_name text,
  short_description text,
  supporting_text text,
  included_bullets jsonb,
  savings_label text,
  cta_label text,
  featured boolean,
  sort_order integer,
  module_count integer,
  module_practice_type public.practice_type,
  current_available_module_count integer,
  durations jsonb,
  eligible_modules jsonb,
  is_available boolean,
  unavailable_reason text,
  unavailable_message text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with active_pack as (
    select ep.*
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  legacy_access as (
    select max(e.expires_at) as expires_at
    from public.entitlements e
    join active_pack ap on ap.id = e.exam_pack_id
    where e.user_id = (select auth.uid())
      and e.status = 'active'
      and e.expires_at > now()
  ),
  module_access as (
    select me.subject_id, max(me.expires_at) as expires_at
    from public.module_entitlements me
    join active_pack ap on ap.id = me.exam_pack_id
    where me.user_id = (select auth.uid())
      and me.status = 'active'
      and me.expires_at > now()
    group by me.subject_id
  ),
  published as (
    select ps.subject_id, count(*)::integer as batch_count
    from public.practice_sets ps
    join active_pack ap on ap.id = ps.exam_pack_id
    where ps.status = 'published'
      and (
        exists (
          select 1
          from public.questions q
          where q.practice_set_id = ps.id
            and q.status = 'published'
        )
        or exists (
          select 1
          from public.oral_questions oq
          where oq.practice_set_id = ps.id
            and oq.status = 'published'
        )
      )
    group by ps.subject_id
  ),
  eligible_modules as (
    select
      s.id as subject_id,
      s.name as subject_name,
      s.slug as subject_slug,
      s.practice_type,
      (la.expires_at is not null or ma.expires_at is not null) as has_module_access,
      greatest(la.expires_at, ma.expires_at) as access_expires_at
    from public.subjects s
    cross join active_pack ap
    left join public.module_offerings mo
      on mo.exam_pack_id = ap.id
      and mo.subject_id = s.id
    left join legacy_access la on true
    left join module_access ma on ma.subject_id = s.id
    left join published p on p.subject_id = s.id
    where coalesce(mo.is_active, false) = true
      and s.is_active = true
      and s.lifecycle_status = 'active'
      and s.candidate_availability = 'available'
      and coalesce(p.batch_count, 0) > 0
  ),
  module_summary as (
    select
      count(*)::integer as all_count,
      count(*) filter (where practice_type = 'objective')::integer as objective_count,
      count(*) filter (where practice_type = 'oral')::integer as oral_count
    from eligible_modules
  ),
  plans as (
    select plan.*
    from public.purchase_plans plan
    where plan.enabled = true
  ),
  plan_modules as (
    select
      plan.id as plan_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'subject_id', module.subject_id,
            'subject_name', module.subject_name,
            'subject_slug', module.subject_slug,
            'practice_type', module.practice_type,
            'has_module_access', module.has_module_access,
            'access_expires_at', module.access_expires_at
          )
          order by module.subject_name
        ) filter (where module.subject_id is not null),
        '[]'::jsonb
      ) as modules,
      count(module.subject_id)::integer as matching_count
    from plans plan
    left join eligible_modules module
      on (
        plan.plan_type in ('pick_n_modules', 'complete_bundle')
        or module.practice_type = plan.module_practice_type
      )
    group by plan.id
  ),
  calculated_durations as (
    select
      plan.id as plan_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'duration_months', price.duration_months,
            'price_kobo',
              case
                when plan.plan_type = 'complete_bundle' then
                  case price.duration_months
                    when 1 then summary.all_count * plan.complete_bundle_monthly_price_per_module_kobo
                    when 3 then public.round_price_kobo(
                      floor((summary.all_count * plan.complete_bundle_monthly_price_per_module_kobo * 3) * 0.86)::integer,
                      plan.complete_bundle_rounding_increment_kobo
                    )
                    when 6 then public.round_price_kobo(
                      floor((summary.all_count * plan.complete_bundle_monthly_price_per_module_kobo * 6) * 0.735)::integer,
                      plan.complete_bundle_rounding_increment_kobo
                    )
                  end
                else price.price_kobo
              end,
            'list_price_kobo',
              case
                when plan.plan_type = 'complete_bundle' then
                  summary.all_count * plan.complete_bundle_monthly_price_per_module_kobo * price.duration_months
                else price.list_price_kobo
              end,
            'currency', price.currency,
            'discount_label', price.discount_label,
            'generated_by_rule', price.generated_by_rule
          )
          order by price.duration_months
        ) filter (where price.id is not null and price.enabled = true),
        '[]'::jsonb
      ) as durations
    from plans plan
    join public.purchase_plan_prices price on price.purchase_plan_id = plan.id
    cross join module_summary summary
    group by plan.id, plan.plan_type, plan.complete_bundle_monthly_price_per_module_kobo,
      plan.complete_bundle_rounding_increment_kobo, summary.all_count
  ),
  evaluated as (
    select
      plan.*,
      coalesce(plan_modules.modules, '[]'::jsonb) as modules,
      coalesce(plan_modules.matching_count, 0) as matching_count,
      coalesce(durations.durations, '[]'::jsonb) as durations,
      summary.all_count,
      case
        when jsonb_array_length(coalesce(durations.durations, '[]'::jsonb)) = 0
          then 'no_enabled_durations'
        when plan.plan_type = 'single_module' and coalesce(plan_modules.matching_count, 0) = 0
          then 'no_matching_modules'
        when plan.plan_type = 'pick_n_modules' and coalesce(plan_modules.matching_count, 0) < plan.module_count
          then 'not_enough_modules'
        when plan.plan_type = 'complete_bundle' and summary.all_count = 0
          then 'no_modules_available'
        else 'available'
      end as reason
    from plans plan
    cross join module_summary summary
    left join plan_modules on plan_modules.plan_id = plan.id
    left join calculated_durations durations on durations.plan_id = plan.id
  )
  select
    evaluated.id,
    evaluated.code,
    evaluated.plan_type,
    evaluated.display_name,
    evaluated.short_description,
    evaluated.supporting_text,
    evaluated.included_bullets,
    evaluated.savings_label,
    evaluated.cta_label,
    evaluated.featured,
    evaluated.sort_order,
    evaluated.module_count,
    evaluated.module_practice_type,
    evaluated.all_count,
    evaluated.durations,
    evaluated.modules,
    evaluated.reason = 'available',
    evaluated.reason,
    case evaluated.reason
      when 'available' then null
      when 'no_enabled_durations' then 'This plan is not open for purchase right now.'
      when 'no_matching_modules' then 'No matching modules are available for this plan.'
      when 'not_enough_modules' then 'Not enough modules are available for this bundle.'
      when 'no_modules_available' then 'No modules are available for this bundle.'
      else 'This plan is not available right now.'
    end
  from evaluated
  order by evaluated.sort_order, evaluated.display_name;
end;
$$;

grant execute on function public.get_purchase_pricing_catalog_v1() to anon, authenticated;
