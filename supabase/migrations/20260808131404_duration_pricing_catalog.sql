-- Duration-based pricing catalog foundation.
--
-- This migration is intentionally additive. It creates the admin-editable
-- pricing plan/catalog layer that future checkout and entitlement migrations
-- will consume, while leaving the existing Paystack checkout path untouched.

create table public.purchase_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  plan_type text not null
    check (plan_type in ('single_module', 'pick_n_modules', 'complete_bundle')),
  display_name text not null
    check (char_length(btrim(display_name)) between 2 and 80),
  short_description text not null default ''
    check (char_length(short_description) <= 240),
  supporting_text text not null default ''
    check (char_length(supporting_text) <= 320),
  included_bullets jsonb not null default '[]'::jsonb
    check (jsonb_typeof(included_bullets) = 'array'),
  savings_label text not null default ''
    check (char_length(savings_label) <= 80),
  cta_label text not null default 'Continue'
    check (char_length(btrim(cta_label)) between 2 and 40),
  featured boolean not null default false,
  sort_order integer not null default 100,
  module_count integer,
  module_practice_type public.practice_type,
  complete_bundle_monthly_price_per_module_kobo integer,
  complete_bundle_rounding_increment_kobo integer not null default 50000,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (plan_type = 'single_module'
      and module_count = 1
      and module_practice_type is not null
      and complete_bundle_monthly_price_per_module_kobo is null)
    or
    (plan_type = 'pick_n_modules'
      and module_count between 2 and 10
      and complete_bundle_monthly_price_per_module_kobo is null)
    or
    (plan_type = 'complete_bundle'
      and module_count is null
      and module_practice_type is null
      and complete_bundle_monthly_price_per_module_kobo > 0)
  ),
  check (complete_bundle_rounding_increment_kobo > 0)
);

create table public.purchase_plan_prices (
  id uuid primary key default gen_random_uuid(),
  purchase_plan_id uuid not null references public.purchase_plans(id) on delete cascade,
  duration_months integer not null check (duration_months in (1, 3, 6)),
  price_kobo integer check (price_kobo > 0),
  list_price_kobo integer check (list_price_kobo > 0),
  currency text not null default 'NGN'
    check (currency = upper(currency) and char_length(currency) = 3),
  discount_label text not null default ''
    check (char_length(discount_label) <= 80),
  generated_by_rule boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_plan_id, duration_months),
  check (
    (generated_by_rule = true and price_kobo is null)
    or
    (generated_by_rule = false and price_kobo is not null)
  ),
  check (list_price_kobo is null or price_kobo is null or price_kobo <= list_price_kobo)
);

create index purchase_plans_enabled_sort_idx
  on public.purchase_plans (enabled, sort_order, display_name);

create index purchase_plan_prices_plan_duration_idx
  on public.purchase_plan_prices (purchase_plan_id, duration_months)
  where enabled = true;

create trigger purchase_plans_touch_updated_at
before update on public.purchase_plans
for each row execute function public.touch_updated_at();

create trigger purchase_plan_prices_touch_updated_at
before update on public.purchase_plan_prices
for each row execute function public.touch_updated_at();

alter table public.purchase_plans enable row level security;
alter table public.purchase_plan_prices enable row level security;

revoke all on table public.purchase_plans from public, anon, authenticated;
revoke all on table public.purchase_plan_prices from public, anon, authenticated;
grant select, insert, update on table public.purchase_plans to service_role;
grant select, insert, update on table public.purchase_plan_prices to service_role;

insert into public.purchase_plans (
  code,
  plan_type,
  display_name,
  short_description,
  supporting_text,
  included_bullets,
  savings_label,
  cta_label,
  featured,
  sort_order,
  module_count,
  module_practice_type,
  complete_bundle_monthly_price_per_module_kobo,
  complete_bundle_rounding_increment_kobo,
  enabled
)
values
  (
    'individual_objective',
    'single_module',
    'Individual Module',
    'Choose one objective module.',
    'Lowest upfront cost for focused practice.',
    '["One selected objective module", "All published practice sets during access", "Retries, review, and progress tracking"]'::jsonb,
    '',
    'Choose module',
    false,
    10,
    1,
    'objective',
    null,
    50000,
    true
  ),
  (
    'individual_oral',
    'single_module',
    'Oral Module',
    'Choose the oral practice module.',
    'Focused oral preparation with timed practice.',
    '["One selected oral module", "Published oral practice sets during access", "Retries, model answers, and review"]'::jsonb,
    '',
    'Choose oral module',
    false,
    20,
    1,
    'oral',
    null,
    50000,
    true
  ),
  (
    'three_module_bundle',
    'pick_n_modules',
    '3-Module Bundle',
    'Choose any 3 available modules.',
    'Better value than buying selected modules separately.',
    '["Any 3 currently available modules", "Same access duration for selected modules", "Lower effective price per module"]'::jsonb,
    'Save compared with buying separately',
    'Choose bundle',
    true,
    30,
    3,
    null,
    null,
    50000,
    true
  ),
  (
    'complete_bundle',
    'complete_bundle',
    'Complete Module Bundle',
    'Access all modules currently available at purchase.',
    'The included module list is fixed at the time of purchase.',
    '["All currently available purchasable modules", "Strongest per-module value", "Future modules are not automatically included"]'::jsonb,
    'Best per-module value',
    'Choose complete bundle',
    true,
    40,
    null,
    null,
    150000,
    50000,
    true
  )
on conflict (code) do update
set plan_type = excluded.plan_type,
    display_name = excluded.display_name,
    short_description = excluded.short_description,
    supporting_text = excluded.supporting_text,
    included_bullets = excluded.included_bullets,
    savings_label = excluded.savings_label,
    cta_label = excluded.cta_label,
    featured = excluded.featured,
    sort_order = excluded.sort_order,
    module_count = excluded.module_count,
    module_practice_type = excluded.module_practice_type,
    complete_bundle_monthly_price_per_module_kobo = excluded.complete_bundle_monthly_price_per_module_kobo,
    complete_bundle_rounding_increment_kobo = excluded.complete_bundle_rounding_increment_kobo,
    enabled = excluded.enabled;

insert into public.purchase_plan_prices (
  purchase_plan_id,
  duration_months,
  price_kobo,
  list_price_kobo,
  currency,
  discount_label,
  generated_by_rule,
  enabled
)
select plan.id, fixture.duration_months, fixture.price_kobo, fixture.list_price_kobo,
  'NGN', fixture.discount_label, fixture.generated_by_rule, true
from (
  values
    ('individual_objective', 1, 250000, 250000, '', false),
    ('individual_objective', 3, 650000, 750000, 'Save about 14%', false),
    ('individual_objective', 6, 1100000, 1500000, 'Save about 26%', false),
    ('individual_oral', 1, 350000, 350000, '', false),
    ('individual_oral', 3, 900000, 1050000, 'Save about 14%', false),
    ('individual_oral', 6, 1550000, 2100000, 'Save about 26%', false),
    ('three_module_bundle', 1, 600000, 750000, 'Save compared with buying separately', false),
    ('three_module_bundle', 3, 1550000, 1800000, 'Save about 14%', false),
    ('three_module_bundle', 6, 2650000, 3600000, 'Save about 26%', false),
    ('complete_bundle', 1, null, null, '', true),
    ('complete_bundle', 3, null, null, 'Save about 14%', true),
    ('complete_bundle', 6, null, null, 'Save about 26%', true)
) as fixture(plan_code, duration_months, price_kobo, list_price_kobo, discount_label, generated_by_rule)
join public.purchase_plans plan on plan.code = fixture.plan_code
on conflict (purchase_plan_id, duration_months) do update
set price_kobo = excluded.price_kobo,
    list_price_kobo = excluded.list_price_kobo,
    currency = excluded.currency,
    discount_label = excluded.discount_label,
    generated_by_rule = excluded.generated_by_rule,
    enabled = excluded.enabled;

create or replace function public.round_price_kobo(
  requested_amount_kobo integer,
  requested_increment_kobo integer default 50000
)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select (
    ceil(
      greatest(coalesce(requested_amount_kobo, 0), 0)::numeric
      / greatest(coalesce(requested_increment_kobo, 50000), 1)::numeric
    )
    * greatest(coalesce(requested_increment_kobo, 50000), 1)
  )::integer;
$$;

create or replace function public.get_admin_purchase_plans()
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
  complete_bundle_monthly_price_per_module_kobo integer,
  complete_bundle_rounding_increment_kobo integer,
  enabled boolean,
  current_available_module_count integer,
  prices jsonb,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert_access();

  return query
  with active_pack as (
    select ep.id
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  purchasable_modules as (
    select s.id, s.practice_type
    from public.subjects s
    join public.module_offerings mo on mo.subject_id = s.id
    join active_pack ap on ap.id = mo.exam_pack_id
    where s.is_active = true
      and s.lifecycle_status = 'active'
      and s.candidate_availability = 'available'
      and mo.is_active = true
      and mo.currency = 'NGN'
      and exists (
        select 1
        from public.practice_sets ps
        where ps.exam_pack_id = mo.exam_pack_id
          and ps.subject_id = s.id
          and ps.status = 'published'
          and (
            exists (select 1 from public.questions q where q.practice_set_id = ps.id and q.status = 'published')
            or exists (select 1 from public.oral_questions oq where oq.practice_set_id = ps.id and oq.status = 'published')
          )
      )
  ),
  module_summary as (
    select count(*)::integer as module_count
    from purchasable_modules
  )
  select
    plan.id,
    plan.code,
    plan.plan_type,
    plan.display_name,
    plan.short_description,
    plan.supporting_text,
    plan.included_bullets,
    plan.savings_label,
    plan.cta_label,
    plan.featured,
    plan.sort_order,
    plan.module_count,
    plan.module_practice_type,
    plan.complete_bundle_monthly_price_per_module_kobo,
    plan.complete_bundle_rounding_increment_kobo,
    plan.enabled,
    coalesce(summary.module_count, 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'price_id', price.id,
          'duration_months', price.duration_months,
          'price_kobo', price.price_kobo,
          'list_price_kobo', price.list_price_kobo,
          'currency', price.currency,
          'discount_label', price.discount_label,
          'generated_by_rule', price.generated_by_rule,
          'enabled', price.enabled
        )
        order by price.duration_months
      ) filter (where price.id is not null),
      '[]'::jsonb
    ),
    plan.updated_at
  from public.purchase_plans plan
  left join public.purchase_plan_prices price on price.purchase_plan_id = plan.id
  cross join module_summary summary
  group by plan.id, summary.module_count
  order by plan.sort_order, plan.display_name;
end;
$$;

create or replace function public.admin_save_purchase_plan(
  requested_plan_code text,
  requested_display_name text,
  requested_short_description text,
  requested_supporting_text text,
  requested_included_bullets jsonb,
  requested_savings_label text,
  requested_cta_label text,
  requested_featured boolean,
  requested_sort_order integer,
  requested_enabled boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_plan public.purchase_plans%rowtype;
  normalized_bullets jsonb;
begin
  perform public.admin_assert_access();

  select *
  into target_plan
  from public.purchase_plans
  where code = requested_plan_code
  for update;

  if not found then
    raise exception 'Pricing plan was not found';
  end if;

  if char_length(btrim(coalesce(requested_display_name, ''))) not between 2 and 80 then
    raise exception 'Plan name must be between 2 and 80 characters';
  end if;

  if char_length(coalesce(requested_short_description, '')) > 240 then
    raise exception 'Plan description is too long';
  end if;

  if char_length(coalesce(requested_supporting_text, '')) > 320 then
    raise exception 'Plan supporting text is too long';
  end if;

  if char_length(btrim(coalesce(requested_cta_label, ''))) not between 2 and 40 then
    raise exception 'Plan button label must be between 2 and 40 characters';
  end if;

  if char_length(coalesce(requested_savings_label, '')) > 80 then
    raise exception 'Savings label is too long';
  end if;

  if requested_included_bullets is null then
    normalized_bullets := '[]'::jsonb;
  elsif jsonb_typeof(requested_included_bullets) <> 'array' then
    raise exception 'Included bullets must be a list';
  else
    select coalesce(jsonb_agg(to_jsonb(left(btrim(value), 120)) order by ordinal), '[]'::jsonb)
    into normalized_bullets
    from jsonb_array_elements_text(requested_included_bullets) with ordinality as item(value, ordinal)
    where btrim(value) <> '';
  end if;

  if jsonb_array_length(normalized_bullets) > 6 then
    raise exception 'Use no more than six included-benefit bullets';
  end if;

  update public.purchase_plans
  set display_name = btrim(requested_display_name),
      short_description = left(coalesce(requested_short_description, ''), 240),
      supporting_text = left(coalesce(requested_supporting_text, ''), 320),
      included_bullets = normalized_bullets,
      savings_label = left(coalesce(requested_savings_label, ''), 80),
      cta_label = btrim(requested_cta_label),
      featured = coalesce(requested_featured, false),
      sort_order = coalesce(requested_sort_order, target_plan.sort_order),
      enabled = coalesce(requested_enabled, false)
  where id = target_plan.id;

  perform public.admin_write_audit(
    'UPDATE_PRICING_PLAN',
    'purchase_plan',
    target_plan.id,
    jsonb_build_object(
      'plan_code', target_plan.code,
      'previous_display_name', target_plan.display_name,
      'display_name', btrim(requested_display_name),
      'previous_enabled', target_plan.enabled,
      'enabled', coalesce(requested_enabled, false)
    )
  );

  return target_plan.id;
end;
$$;

create or replace function public.admin_save_purchase_plan_price(
  requested_plan_code text,
  requested_duration_months integer,
  requested_price_kobo integer,
  requested_list_price_kobo integer,
  requested_discount_label text,
  requested_enabled boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_plan public.purchase_plans%rowtype;
  target_price public.purchase_plan_prices%rowtype;
begin
  perform public.admin_assert_access();

  select *
  into target_plan
  from public.purchase_plans
  where code = requested_plan_code
  for update;

  if not found then
    raise exception 'Pricing plan was not found';
  end if;

  if requested_duration_months not in (1, 3, 6) then
    raise exception 'Choose a supported access duration';
  end if;

  if target_plan.plan_type = 'complete_bundle' then
    raise exception 'Complete Bundle prices are generated from the active module count';
  end if;

  if requested_price_kobo is null or requested_price_kobo <= 0 then
    raise exception 'Enter a valid price';
  end if;

  if requested_price_kobo % 50000 <> 0 then
    raise exception 'Prices should be rounded to the nearest NGN 500';
  end if;

  if requested_list_price_kobo is not null and requested_list_price_kobo < requested_price_kobo then
    raise exception 'List price cannot be lower than the final price';
  end if;

  select *
  into target_price
  from public.purchase_plan_prices
  where purchase_plan_id = target_plan.id
    and duration_months = requested_duration_months
  for update;

  insert into public.purchase_plan_prices (
    purchase_plan_id,
    duration_months,
    price_kobo,
    list_price_kobo,
    currency,
    discount_label,
    generated_by_rule,
    enabled
  )
  values (
    target_plan.id,
    requested_duration_months,
    requested_price_kobo,
    coalesce(requested_list_price_kobo, requested_price_kobo),
    'NGN',
    left(coalesce(requested_discount_label, ''), 80),
    false,
    coalesce(requested_enabled, false)
  )
  on conflict (purchase_plan_id, duration_months) do update
  set price_kobo = excluded.price_kobo,
      list_price_kobo = excluded.list_price_kobo,
      discount_label = excluded.discount_label,
      generated_by_rule = false,
      enabled = excluded.enabled
  returning * into target_price;

  perform public.admin_write_audit(
    'UPDATE_PRICING_PRICE',
    'purchase_plan',
    target_plan.id,
    jsonb_build_object(
      'plan_code', target_plan.code,
      'duration_months', requested_duration_months,
      'price_kobo', requested_price_kobo,
      'list_price_kobo', coalesce(requested_list_price_kobo, requested_price_kobo),
      'enabled', coalesce(requested_enabled, false)
    )
  );

  return target_price.id;
end;
$$;

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
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  return query
  with catalog as (
    select c.*
    from public.get_module_access_catalog_v2() c
    where c.can_purchase = true
  ),
  eligible_modules as (
    select
      c.subject_id,
      c.subject_name,
      c.subject_slug,
      c.practice_type,
      c.has_module_access,
      c.access_expires_at
    from catalog c
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

revoke all on function public.round_price_kobo(integer, integer) from public, anon, authenticated;
revoke all on function public.get_admin_purchase_plans() from public, anon;
revoke all on function public.admin_save_purchase_plan(text, text, text, text, jsonb, text, text, boolean, integer, boolean) from public, anon;
revoke all on function public.admin_save_purchase_plan_price(text, integer, integer, integer, text, boolean) from public, anon;
revoke all on function public.get_purchase_pricing_catalog_v1() from public, anon;

grant execute on function public.get_admin_purchase_plans() to authenticated;
grant execute on function public.admin_save_purchase_plan(text, text, text, text, jsonb, text, text, boolean, integer, boolean) to authenticated;
grant execute on function public.admin_save_purchase_plan_price(text, integer, integer, integer, text, boolean) to authenticated;
grant execute on function public.get_purchase_pricing_catalog_v1() to authenticated;
