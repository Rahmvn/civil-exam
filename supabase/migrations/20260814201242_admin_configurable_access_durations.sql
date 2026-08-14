-- Admin-configurable calendar-month access durations.
-- Historical orders retain their immutable duration/price/module snapshots.

create table public.purchase_durations (
  id uuid primary key default gen_random_uuid(),
  months integer not null unique check (months > 0),
  enabled boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchase_durations_catalog_idx
  on public.purchase_durations (enabled, sort_order, months);

create trigger purchase_durations_touch_updated_at
before update on public.purchase_durations
for each row execute function public.touch_updated_at();

create or replace function public.prevent_purchase_duration_month_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.months <> old.months then
    raise exception 'Access duration months cannot be changed after creation';
  end if;
  return new;
end;
$$;

create trigger purchase_durations_preserve_months
before update of months on public.purchase_durations
for each row execute function public.prevent_purchase_duration_month_change();

alter table public.purchase_durations enable row level security;
revoke all on table public.purchase_durations from public, anon, authenticated;
grant select, insert, update on table public.purchase_durations to service_role;

insert into public.purchase_durations (months, enabled, sort_order)
values
  (1, true, 10),
  (2, true, 20),
  (3, true, 30),
  (6, false, 60)
on conflict (months) do update
set enabled = excluded.enabled,
    sort_order = excluded.sort_order;

alter table public.purchase_plan_prices
  drop constraint if exists purchase_plan_prices_duration_months_check,
  add column complete_bundle_unit_price_kobo integer,
  add constraint purchase_plan_prices_duration_catalog_fkey
    foreign key (duration_months) references public.purchase_durations(months),
  add constraint purchase_plan_prices_complete_unit_check
    check (complete_bundle_unit_price_kobo is null or complete_bundle_unit_price_kobo > 0);

insert into public.purchase_plan_prices (
  purchase_plan_id, duration_months, price_kobo, list_price_kobo,
  currency, discount_label, generated_by_rule, enabled,
  complete_bundle_unit_price_kobo
)
select
  plan.id,
  fixture.duration_months,
  fixture.price_kobo,
  fixture.price_kobo,
  'NGN',
  '',
  false,
  true,
  null
from (
  values
    ('individual_objective', 1, 250000),
    ('individual_objective', 2, 450000),
    ('individual_objective', 3, 650000),
    ('individual_oral', 1, 350000),
    ('individual_oral', 2, 650000),
    ('individual_oral', 3, 900000),
    ('three_module_bundle', 1, 600000),
    ('three_module_bundle', 2, 1100000),
    ('three_module_bundle', 3, 1550000)
) as fixture(plan_code, duration_months, price_kobo)
join public.purchase_plans plan on plan.code = fixture.plan_code
on conflict (purchase_plan_id, duration_months) do update
set price_kobo = excluded.price_kobo,
    list_price_kobo = excluded.list_price_kobo,
    currency = excluded.currency,
    discount_label = '',
    generated_by_rule = false,
    enabled = true,
    complete_bundle_unit_price_kobo = null;

insert into public.purchase_plan_prices (
  purchase_plan_id, duration_months, price_kobo, list_price_kobo,
  currency, discount_label, generated_by_rule, enabled,
  complete_bundle_unit_price_kobo
)
select
  plan.id,
  fixture.duration_months,
  null,
  null,
  'NGN',
  '',
  true,
  true,
  fixture.unit_price_kobo
from (
  values
    (1, 150000),
    (2, 277777),
    (3, 388888),
    (6, 666666)
) as fixture(duration_months, unit_price_kobo)
cross join public.purchase_plans plan
where plan.code = 'complete_bundle'
on conflict (purchase_plan_id, duration_months) do update
set price_kobo = null,
    list_price_kobo = null,
    currency = excluded.currency,
    discount_label = '',
    generated_by_rule = true,
    enabled = true,
    complete_bundle_unit_price_kobo = excluded.complete_bundle_unit_price_kobo;

create or replace function public.calculate_configured_plan_price_kobo(
  requested_plan_type text,
  requested_fixed_price_kobo integer,
  requested_complete_unit_price_kobo integer,
  requested_module_count integer,
  requested_rounding_increment_kobo integer
)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when requested_plan_type = 'complete_bundle' then
      case
        when coalesce(requested_complete_unit_price_kobo, 0) <= 0
          or coalesce(requested_module_count, 0) <= 0 then null
        else public.round_price_kobo(
          requested_complete_unit_price_kobo * requested_module_count,
          requested_rounding_increment_kobo
        )
      end
    else requested_fixed_price_kobo
  end;
$$;

create or replace function public.get_admin_purchase_durations()
returns table (
  duration_id uuid,
  months integer,
  enabled boolean,
  sort_order integer,
  used_by_orders boolean,
  configured_plan_count integer,
  enabled_plan_count integer,
  created_at timestamptz,
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
  select
    duration.id,
    duration.months,
    duration.enabled,
    duration.sort_order,
    exists (
      select 1 from public.payment_orders po
      where po.purchase_type = 'pricing_plan'
        and po.duration_months = duration.months
    ),
    count(*) filter (
      where plan.enabled = true
        and price.enabled = true
        and (
          (plan.plan_type = 'complete_bundle' and price.complete_bundle_unit_price_kobo > 0)
          or (plan.plan_type <> 'complete_bundle' and price.price_kobo > 0)
        )
    )::integer,
    count(*) filter (where plan.enabled = true)::integer,
    duration.created_at,
    duration.updated_at
  from public.purchase_durations duration
  cross join public.purchase_plans plan
  left join public.purchase_plan_prices price
    on price.purchase_plan_id = plan.id
   and price.duration_months = duration.months
  group by duration.id
  order by duration.sort_order, duration.months;
end;
$$;

create or replace function public.admin_create_purchase_duration(
  requested_months integer,
  requested_sort_order integer default 100
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_duration public.purchase_durations%rowtype;
begin
  perform public.admin_assert_access();

  if requested_months is null or requested_months <= 0 then
    raise exception 'Access duration must be a positive whole number of months';
  end if;

  if exists (select 1 from public.purchase_durations where months = requested_months) then
    raise exception 'That access duration already exists';
  end if;

  insert into public.purchase_durations (months, enabled, sort_order)
  values (requested_months, false, coalesce(requested_sort_order, 100))
  returning * into created_duration;

  perform public.admin_write_audit(
    'CREATE_PURCHASE_DURATION',
    'purchase_duration',
    created_duration.id,
    jsonb_build_object(
      'months', created_duration.months,
      'enabled', false,
      'sort_order', created_duration.sort_order
    )
  );

  return created_duration.id;
end;
$$;

create or replace function public.admin_update_purchase_duration(
  requested_months integer,
  requested_enabled boolean,
  requested_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_duration public.purchase_durations%rowtype;
  missing_plan_count integer;
begin
  perform public.admin_assert_access();

  select * into target_duration
  from public.purchase_durations
  where months = requested_months
  for update;

  if not found then
    raise exception 'Access duration was not found';
  end if;

  if coalesce(requested_enabled, false) then
    select count(*)::integer into missing_plan_count
    from public.purchase_plans plan
    where plan.enabled = true
      and not exists (
        select 1
        from public.purchase_plan_prices price
        where price.purchase_plan_id = plan.id
          and price.duration_months = target_duration.months
          and price.enabled = true
          and (
            (plan.plan_type = 'complete_bundle' and price.complete_bundle_unit_price_kobo > 0)
            or (plan.plan_type <> 'complete_bundle' and price.price_kobo > 0)
          )
      );

    if missing_plan_count > 0 then
      raise exception 'Configure an enabled price for every enabled plan before showing this duration';
    end if;
  end if;

  update public.purchase_durations
  set enabled = coalesce(requested_enabled, false),
      sort_order = coalesce(requested_sort_order, target_duration.sort_order)
  where id = target_duration.id;

  perform public.admin_write_audit(
    'UPDATE_PURCHASE_DURATION',
    'purchase_duration',
    target_duration.id,
    jsonb_build_object(
      'months', target_duration.months,
      'previous_enabled', target_duration.enabled,
      'enabled', coalesce(requested_enabled, false),
      'previous_sort_order', target_duration.sort_order,
      'sort_order', coalesce(requested_sort_order, target_duration.sort_order)
    )
  );

  return target_duration.id;
end;
$$;

create or replace function public.get_current_purchasable_module_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with active_pack as (
    select ep.id
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  )
  select count(*)::integer
  from public.subjects subject
  join public.module_offerings offering on offering.subject_id = subject.id
  join active_pack pack on pack.id = offering.exam_pack_id
  where subject.is_active = true
    and subject.lifecycle_status = 'active'
    and subject.candidate_availability = 'available'
    and offering.is_active = true
    and offering.currency = 'NGN'
    and exists (
      select 1
      from public.practice_sets practice_set
      where practice_set.exam_pack_id = offering.exam_pack_id
        and practice_set.subject_id = subject.id
        and practice_set.status = 'published'
        and (
          exists (
            select 1 from public.questions question
            where question.practice_set_id = practice_set.id
              and question.status = 'published'
          )
          or exists (
            select 1 from public.oral_questions oral_question
            where oral_question.practice_set_id = practice_set.id
              and oral_question.status = 'published'
          )
        )
    );
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
  with module_summary as (
    select public.get_current_purchasable_module_count() as module_count
  ),
  raw_prices as (
    select
      plan.id as plan_id,
      duration.id as duration_id,
      duration.months,
      duration.enabled as duration_enabled,
      duration.sort_order as duration_sort_order,
      price.id as price_id,
      price.currency,
      price.generated_by_rule,
      price.enabled as price_enabled,
      price.complete_bundle_unit_price_kobo,
      public.calculate_configured_plan_price_kobo(
        plan.plan_type,
        price.price_kobo,
        price.complete_bundle_unit_price_kobo,
        summary.module_count,
        plan.complete_bundle_rounding_increment_kobo
      ) as current_price_kobo
    from public.purchase_plans plan
    cross join public.purchase_durations duration
    cross join module_summary summary
    left join public.purchase_plan_prices price
      on price.purchase_plan_id = plan.id
     and price.duration_months = duration.months
  ),
  priced as (
    select
      raw.*,
      case
        when one_month.current_price_kobo > 0
          then one_month.current_price_kobo * raw.months
        else raw.current_price_kobo
      end as comparison_price_kobo
    from raw_prices raw
    left join raw_prices one_month
      on one_month.plan_id = raw.plan_id
     and one_month.months = 1
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
    summary.module_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'price_id', priced.price_id,
          'duration_id', priced.duration_id,
          'duration_months', priced.months,
          'duration_enabled', priced.duration_enabled,
          'duration_sort_order', priced.duration_sort_order,
          'price_kobo', priced.current_price_kobo,
          'list_price_kobo', priced.comparison_price_kobo,
          'currency', coalesce(priced.currency, 'NGN'),
          'discount_label', case
            when priced.comparison_price_kobo > priced.current_price_kobo then
              'Save about ' || round(
                ((priced.comparison_price_kobo - priced.current_price_kobo)::numeric
                  * 100) / priced.comparison_price_kobo
              )::integer || '%'
            else ''
          end,
          'generated_by_rule', coalesce(priced.generated_by_rule, plan.plan_type = 'complete_bundle'),
          'complete_bundle_unit_price_kobo', priced.complete_bundle_unit_price_kobo,
          'enabled', coalesce(priced.price_enabled, false),
          'is_customer_visible', plan.enabled
            and priced.duration_enabled
            and coalesce(priced.price_enabled, false)
            and priced.current_price_kobo > 0
        )
        order by priced.duration_sort_order, priced.months
      ),
      '[]'::jsonb
    ),
    plan.updated_at
  from public.purchase_plans plan
  cross join module_summary summary
  join priced on priced.plan_id = plan.id
  group by plan.id, summary.module_count
  order by plan.sort_order, plan.display_name;
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
  target_duration public.purchase_durations%rowtype;
  target_price public.purchase_plan_prices%rowtype;
  current_module_count integer;
  complete_unit_price_kobo integer;
  calculated_complete_price_kobo integer;
  previous_price_kobo integer;
begin
  perform public.admin_assert_access();

  select * into target_plan
  from public.purchase_plans
  where code = requested_plan_code
  for update;

  if not found then
    raise exception 'Pricing plan was not found';
  end if;

  select * into target_duration
  from public.purchase_durations
  where months = requested_duration_months;

  if not found then
    raise exception 'Create this access duration before configuring its price';
  end if;

  if requested_price_kobo is null or requested_price_kobo <= 0 then
    raise exception 'Enter a valid price';
  end if;

  if requested_price_kobo % 50000 <> 0 then
    raise exception 'Prices should be rounded to the nearest NGN 500';
  end if;

  if target_duration.enabled and target_plan.enabled and not coalesce(requested_enabled, false) then
    raise exception 'Disable the access duration before hiding an enabled plan price';
  end if;

  select * into target_price
  from public.purchase_plan_prices
  where purchase_plan_id = target_plan.id
    and duration_months = requested_duration_months
  for update;

  previous_price_kobo := public.calculate_configured_plan_price_kobo(
    target_plan.plan_type,
    target_price.price_kobo,
    target_price.complete_bundle_unit_price_kobo,
    public.get_current_purchasable_module_count(),
    target_plan.complete_bundle_rounding_increment_kobo
  );

  if target_plan.plan_type = 'complete_bundle' then
    current_module_count := public.get_current_purchasable_module_count();
    if current_module_count <= 0 then
      raise exception 'No modules are currently available for Complete Bundle pricing';
    end if;

    complete_unit_price_kobo := case
      when previous_price_kobo = requested_price_kobo
        and target_price.complete_bundle_unit_price_kobo > 0
        then target_price.complete_bundle_unit_price_kobo
      else greatest(floor(requested_price_kobo::numeric / current_module_count)::integer, 1)
    end;
    calculated_complete_price_kobo := public.round_price_kobo(
      complete_unit_price_kobo * current_module_count,
      target_plan.complete_bundle_rounding_increment_kobo
    );

    if calculated_complete_price_kobo <> requested_price_kobo then
      raise exception 'Complete Bundle price cannot be represented safely for the current module count';
    end if;
  else
    complete_unit_price_kobo := null;
  end if;

  insert into public.purchase_plan_prices (
    purchase_plan_id,
    duration_months,
    price_kobo,
    list_price_kobo,
    currency,
    discount_label,
    generated_by_rule,
    enabled,
    complete_bundle_unit_price_kobo
  ) values (
    target_plan.id,
    requested_duration_months,
    case when target_plan.plan_type = 'complete_bundle' then null else requested_price_kobo end,
    case when target_plan.plan_type = 'complete_bundle' then null else requested_price_kobo end,
    'NGN',
    '',
    target_plan.plan_type = 'complete_bundle',
    coalesce(requested_enabled, false),
    complete_unit_price_kobo
  )
  on conflict (purchase_plan_id, duration_months) do update
  set price_kobo = excluded.price_kobo,
      list_price_kobo = excluded.list_price_kobo,
      currency = excluded.currency,
      discount_label = '',
      generated_by_rule = excluded.generated_by_rule,
      enabled = excluded.enabled,
      complete_bundle_unit_price_kobo = excluded.complete_bundle_unit_price_kobo
  returning * into target_price;

  perform public.admin_write_audit(
    'UPDATE_PRICING_PRICE',
    'purchase_plan',
    target_plan.id,
    jsonb_build_object(
      'plan_code', target_plan.code,
      'duration_months', requested_duration_months,
      'previous_price_kobo', previous_price_kobo,
      'price_kobo', requested_price_kobo,
      'enabled', coalesce(requested_enabled, false),
      'complete_bundle_module_count', case
        when target_plan.plan_type = 'complete_bundle' then current_module_count
        else null
      end
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
  return query
  with active_pack as (
    select ep.*
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  legacy_access as (
    select max(entitlement.expires_at) as expires_at
    from public.entitlements entitlement
    join active_pack pack on pack.id = entitlement.exam_pack_id
    where entitlement.user_id = (select auth.uid())
      and entitlement.status = 'active'
      and entitlement.expires_at > now()
  ),
  module_access as (
    select entitlement.subject_id, max(entitlement.expires_at) as expires_at
    from public.module_entitlements entitlement
    join active_pack pack on pack.id = entitlement.exam_pack_id
    where entitlement.user_id = (select auth.uid())
      and entitlement.status = 'active'
      and entitlement.expires_at > now()
    group by entitlement.subject_id
  ),
  published as (
    select practice_set.subject_id, count(*)::integer as batch_count
    from public.practice_sets practice_set
    join active_pack pack on pack.id = practice_set.exam_pack_id
    where practice_set.status = 'published'
      and (
        exists (
          select 1 from public.questions question
          where question.practice_set_id = practice_set.id
            and question.status = 'published'
        )
        or exists (
          select 1 from public.oral_questions oral_question
          where oral_question.practice_set_id = practice_set.id
            and oral_question.status = 'published'
        )
      )
    group by practice_set.subject_id
  ),
  eligible_modules as (
    select
      subject.id as subject_id,
      subject.name as subject_name,
      subject.slug as subject_slug,
      subject.practice_type,
      (legacy.expires_at is not null or module_entitlement.expires_at is not null) as has_module_access,
      greatest(legacy.expires_at, module_entitlement.expires_at) as access_expires_at
    from public.subjects subject
    cross join active_pack pack
    left join public.module_offerings offering
      on offering.exam_pack_id = pack.id
     and offering.subject_id = subject.id
    left join legacy_access legacy on true
    left join module_access module_entitlement on module_entitlement.subject_id = subject.id
    left join published on published.subject_id = subject.id
    where coalesce(offering.is_active, false) = true
      and subject.is_active = true
      and subject.lifecycle_status = 'active'
      and subject.candidate_availability = 'available'
      and coalesce(published.batch_count, 0) > 0
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
          ) order by module.subject_name
        ) filter (where module.subject_id is not null),
        '[]'::jsonb
      ) as modules,
      count(module.subject_id)::integer as matching_count
    from plans plan
    left join eligible_modules module
      on plan.plan_type in ('pick_n_modules', 'complete_bundle')
      or module.practice_type = plan.module_practice_type
    group by plan.id
  ),
  raw_prices as (
    select
      plan.id as plan_id,
      duration.id as duration_id,
      duration.months,
      duration.sort_order as duration_sort_order,
      price.currency,
      price.generated_by_rule,
      public.calculate_configured_plan_price_kobo(
        plan.plan_type,
        price.price_kobo,
        price.complete_bundle_unit_price_kobo,
        summary.all_count,
        plan.complete_bundle_rounding_increment_kobo
      ) as amount_kobo
    from plans plan
    join public.purchase_plan_prices price on price.purchase_plan_id = plan.id
    join public.purchase_durations duration
      on duration.months = price.duration_months
     and duration.enabled = true
    cross join module_summary summary
    where price.enabled = true
  ),
  priced_rows as (
    select
      raw.*,
      case
        when one_month.amount_kobo > 0 then one_month.amount_kobo * raw.months
        else raw.amount_kobo
      end as list_price_kobo
    from raw_prices raw
    left join raw_prices one_month
      on one_month.plan_id = raw.plan_id
     and one_month.months = 1
  ),
  calculated_durations as (
    select
      plan.id as plan_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'duration_id', price.duration_id,
            'duration_months', price.months,
            'price_kobo', price.amount_kobo,
            'list_price_kobo', price.list_price_kobo,
            'currency', price.currency,
            'discount_label', case
              when price.list_price_kobo > price.amount_kobo then
                'Save about ' || round(
                  ((price.list_price_kobo - price.amount_kobo)::numeric * 100)
                    / price.list_price_kobo
                )::integer || '%'
              else ''
            end,
            'generated_by_rule', price.generated_by_rule,
            'enabled', true
          ) order by price.duration_sort_order, price.months
        ) filter (where price.amount_kobo > 0),
        '[]'::jsonb
      ) as durations
    from plans plan
    left join priced_rows price on price.plan_id = plan.id
    group by plan.id
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

create or replace function public.get_purchase_plan_checkout_price(
  requested_plan_code text,
  requested_duration_months integer,
  requested_module_count integer
)
returns table (
  purchase_plan_id uuid,
  plan_code text,
  duration_months integer,
  amount_kobo integer,
  list_price_kobo integer,
  currency text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target_plan public.purchase_plans%rowtype;
  target_duration public.purchase_durations%rowtype;
  target_price public.purchase_plan_prices%rowtype;
  one_month_price public.purchase_plan_prices%rowtype;
  resolved_amount integer;
  resolved_one_month_amount integer;
  safe_module_count integer;
begin
  select plan.* into target_plan
  from public.purchase_plans plan
  where plan.code = requested_plan_code;

  if target_plan.id is null or not target_plan.enabled then
    raise exception 'This pricing plan is not currently available';
  end if;

  select duration.* into target_duration
  from public.purchase_durations duration
  where duration.months = requested_duration_months;

  if target_duration.id is null or not target_duration.enabled then
    raise exception 'This access duration is not currently available';
  end if;

  select price.* into target_price
  from public.purchase_plan_prices price
  where price.purchase_plan_id = target_plan.id
    and price.duration_months = target_duration.months;

  if target_price.id is null or not target_price.enabled then
    raise exception 'This access duration does not have an active price';
  end if;

  safe_module_count := case
    when target_plan.plan_type = 'complete_bundle' then requested_module_count
    else coalesce(target_plan.module_count, requested_module_count)
  end;

  resolved_amount := public.calculate_configured_plan_price_kobo(
    target_plan.plan_type,
    target_price.price_kobo,
    target_price.complete_bundle_unit_price_kobo,
    safe_module_count,
    target_plan.complete_bundle_rounding_increment_kobo
  );

  if resolved_amount is null or resolved_amount <= 0 then
    raise exception 'This pricing plan does not have a valid price';
  end if;

  select price.* into one_month_price
  from public.purchase_plan_prices price
  where price.purchase_plan_id = target_plan.id
    and price.duration_months = 1
    and price.enabled = true;

  resolved_one_month_amount := public.calculate_configured_plan_price_kobo(
    target_plan.plan_type,
    one_month_price.price_kobo,
    one_month_price.complete_bundle_unit_price_kobo,
    safe_module_count,
    target_plan.complete_bundle_rounding_increment_kobo
  );

  return query select
    target_plan.id,
    target_plan.code,
    target_duration.months,
    resolved_amount,
    case
      when resolved_one_month_amount > 0 then resolved_one_month_amount * target_duration.months
      else resolved_amount
    end,
    target_price.currency;
end;
$$;

alter table public.payment_orders
  drop constraint if exists payment_orders_duration_months_check,
  drop constraint if exists payment_orders_purchase_context_check;

alter table public.payment_orders
  add constraint payment_orders_duration_months_check
    check (duration_months is null or duration_months > 0),
  add constraint payment_orders_purchase_context_check
    check (
      (purchase_type = 'single_module'
        and subject_id is not null
        and module_offering_id is not null
        and purchase_offer_id is null
        and purchase_plan_id is null
        and duration_months is null)
      or
      (purchase_type = 'bundle_offer'
        and subject_id is null
        and module_offering_id is null
        and purchase_offer_id is not null
        and purchase_plan_id is null
        and duration_months is null)
      or
      (purchase_type = 'pricing_plan'
        and subject_id is null
        and module_offering_id is null
        and purchase_offer_id is null
        and purchase_plan_id is not null
        and plan_code is not null
        and duration_months is not null
        and duration_months > 0
        and purchase_snapshot <> '{}'::jsonb)
    );

revoke all on function public.prevent_purchase_duration_month_change() from public, anon, authenticated;
revoke all on function public.calculate_configured_plan_price_kobo(text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.get_current_purchasable_module_count() from public, anon, authenticated;
revoke all on function public.get_admin_purchase_durations() from public, anon;
revoke all on function public.admin_create_purchase_duration(integer, integer) from public, anon;
revoke all on function public.admin_update_purchase_duration(integer, boolean, integer) from public, anon;
revoke all on function public.get_purchase_plan_checkout_price(text, integer, integer) from public, anon, authenticated;

grant execute on function public.get_admin_purchase_durations() to authenticated;
grant execute on function public.admin_create_purchase_duration(integer, integer) to authenticated;
grant execute on function public.admin_update_purchase_duration(integer, boolean, integer) to authenticated;
grant execute on function public.get_purchase_plan_checkout_price(text, integer, integer) to service_role;
grant execute on function public.get_purchase_pricing_catalog_v1() to anon, authenticated;

create or replace function public.activate_module_purchase(
  requested_reference text,
  payment_payload jsonb default '{}'::jsonb
)
returns table (
  order_id uuid,
  subject_id uuid,
  subject_name text,
  subject_slug text,
  expires_at timestamptz,
  already_active boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.payment_orders;
  v_pack public.exam_packs;
  v_item record;
  v_existing public.module_entitlements;
  v_historical public.module_entitlements;
  v_entitlement_id uuid;
  v_pack_expires_at timestamptz;
  v_base_expires_at timestamptz;
  v_item_expires_at timestamptz;
  v_item_starts_at timestamptz;
  v_already_active boolean;
  v_item_count integer;
  v_order_access_starts_at timestamptz;
  v_order_access_expires_at timestamptz;
  v_activated_at timestamptz := clock_timestamp();
  v_activation_kind text;
  v_outcome public.payment_order_item_access_outcomes;
begin
  select payment_order.* into v_order
  from public.payment_orders payment_order
  where payment_order.provider_reference = requested_reference
  for update;

  if v_order.id is null then
    raise exception 'Payment order was not found';
  end if;

  if v_order.purchase_type = 'pricing_plan'
    and (
      v_order.purchase_plan_id is null
      or v_order.plan_code is null
      or v_order.duration_months is null
      or v_order.duration_months <= 0
    ) then
    raise exception 'Duration pricing order is missing its plan or duration snapshot';
  end if;

  if v_order.fulfillment_status = 'fulfilled' then
    return query
    select
      v_order.id,
      item.subject_id,
      subject.name,
      subject.slug,
      coalesce(outcome.after_expires_at, v_order.access_expires_at),
      true
    from public.payment_order_items item
    join public.subjects subject on subject.id = item.subject_id
    left join public.payment_order_item_access_outcomes outcome
      on outcome.payment_order_item_id = item.id
    where item.payment_order_id = v_order.id
    order by subject.sort_order, subject.name;
    return;
  end if;

  select pack.* into v_pack
  from public.exam_packs pack
  where pack.id = v_order.exam_pack_id;

  if v_order.purchase_type = 'single_module'
    and v_order.subject_id is not null
    and v_order.module_offering_id is not null then
    insert into public.payment_order_items (
      payment_order_id,
      subject_id,
      module_offering_id,
      list_price_kobo,
      allocated_amount_kobo
    ) values (
      v_order.id,
      v_order.subject_id,
      v_order.module_offering_id,
      v_order.list_price_kobo,
      v_order.amount_kobo
    )
    on conflict on constraint payment_order_items_payment_order_id_subject_id_key do nothing;
  end if;

  select count(*) into v_item_count
  from public.payment_order_items item
  where item.payment_order_id = v_order.id;

  if v_pack.id is null or v_item_count = 0 then
    raise exception 'Payment order is not linked to available modules';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment-order:' || v_order.id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    v_order.user_id::text || ':' || v_order.exam_pack_id::text || ':' || locked.subject_id::text,
    0
  ))
  from (
    select item.subject_id
    from public.payment_order_items item
    where item.payment_order_id = v_order.id
    order by item.subject_id
  ) locked;

  perform public.assert_modules_not_under_payment_review(
    v_order.user_id,
    v_order.exam_pack_id,
    array(
      select item.subject_id
      from public.payment_order_items item
      where item.payment_order_id = v_order.id
      order by item.subject_id
    )
  );

  update public.module_entitlements entitlement
  set status = 'expired', updated_at = now()
  where entitlement.user_id = v_order.user_id
    and entitlement.exam_pack_id = v_order.exam_pack_id
    and entitlement.subject_id in (
      select item.subject_id
      from public.payment_order_items item
      where item.payment_order_id = v_order.id
    )
    and entitlement.status = 'active'
    and entitlement.expires_at <= now();

  v_pack_expires_at := (v_pack.active_until::text || ' 23:59:59.999+00')::timestamptz;
  v_order_access_starts_at := coalesce(v_order.access_starts_at, v_activated_at);

  for v_item in
    select item.id as item_id, item.subject_id, subject.name, subject.slug
    from public.payment_order_items item
    join public.subjects subject on subject.id = item.subject_id
    where item.payment_order_id = v_order.id
    order by subject.sort_order, subject.name, item.id
  loop
    v_outcome := null;
    select outcome.* into v_outcome
    from public.payment_order_item_access_outcomes outcome
    where outcome.payment_order_item_id = v_item.item_id;

    if v_outcome.id is not null then
      return query select
        v_order.id,
        v_item.subject_id,
        v_item.name,
        v_item.slug,
        v_outcome.after_expires_at,
        v_outcome.activation_kind = 'extension';
      v_order_access_expires_at := greatest(
        coalesce(v_order_access_expires_at, v_outcome.after_expires_at),
        v_outcome.after_expires_at
      );
      continue;
    end if;

    v_existing := null;
    select entitlement.* into v_existing
    from public.module_entitlements entitlement
    where entitlement.user_id = v_order.user_id
      and entitlement.exam_pack_id = v_order.exam_pack_id
      and entitlement.subject_id = v_item.subject_id
      and entitlement.status = 'active'
      and entitlement.expires_at > v_activated_at
    order by entitlement.expires_at desc
    limit 1
    for update;

    v_already_active := v_existing.id is not null;

    if v_order.purchase_type = 'pricing_plan' then
      if v_existing.id is not null then
        v_activation_kind := 'extension';
        v_entitlement_id := v_existing.id;
        v_base_expires_at := greatest(v_activated_at, v_existing.expires_at);
        v_item_starts_at := v_existing.starts_at;
        v_item_expires_at := v_base_expires_at + make_interval(months => v_order.duration_months);

        update public.module_entitlements entitlement
        set expires_at = v_item_expires_at,
            metadata = coalesce(entitlement.metadata, '{}'::jsonb) || jsonb_build_object(
              'provider', v_order.provider,
              'reference', v_order.provider_reference,
              'purchase_type', v_order.purchase_type,
              'purchase_plan_id', v_order.purchase_plan_id,
              'plan_code', v_order.plan_code,
              'duration_months', v_order.duration_months,
              'last_extension_order_id', v_order.id,
              'last_extended_at', v_activated_at,
              'pricing_plan_order_ids',
                coalesce(entitlement.metadata->'pricing_plan_order_ids', '[]'::jsonb)
                  || to_jsonb(v_order.id::text)
            ),
            updated_at = now()
        where entitlement.id = v_entitlement_id;
      else
        v_historical := null;
        select entitlement.* into v_historical
        from public.module_entitlements entitlement
        where entitlement.user_id = v_order.user_id
          and entitlement.exam_pack_id = v_order.exam_pack_id
          and entitlement.subject_id = v_item.subject_id
        order by entitlement.expires_at desc, entitlement.created_at desc
        limit 1;

        v_activation_kind := case when v_historical.id is null then 'new' else 'reactivation' end;
        v_base_expires_at := v_activated_at;
        v_item_starts_at := v_activated_at;
        v_item_expires_at := v_base_expires_at + make_interval(months => v_order.duration_months);

        insert into public.module_entitlements (
          user_id,
          exam_pack_id,
          subject_id,
          payment_order_id,
          status,
          starts_at,
          expires_at,
          metadata
        ) values (
          v_order.user_id,
          v_order.exam_pack_id,
          v_item.subject_id,
          v_order.id,
          'active',
          v_item_starts_at,
          v_item_expires_at,
          jsonb_build_object(
            'provider', v_order.provider,
            'reference', v_order.provider_reference,
            'purchase_type', v_order.purchase_type,
            'purchase_plan_id', v_order.purchase_plan_id,
            'plan_code', v_order.plan_code,
            'duration_months', v_order.duration_months,
            'pricing_plan_order_ids', jsonb_build_array(v_order.id::text)
          )
        ) returning id into v_entitlement_id;
      end if;

      insert into public.payment_order_item_access_outcomes (
        payment_order_item_id,
        payment_order_id,
        user_id,
        exam_pack_id,
        subject_id,
        entitlement_id,
        activation_kind,
        activated_at,
        duration_months,
        before_status,
        before_starts_at,
        before_expires_at,
        after_status,
        after_starts_at,
        after_expires_at
      ) values (
        v_item.item_id,
        v_order.id,
        v_order.user_id,
        v_order.exam_pack_id,
        v_item.subject_id,
        v_entitlement_id,
        v_activation_kind,
        v_activated_at,
        v_order.duration_months,
        v_existing.status,
        v_existing.starts_at,
        v_existing.expires_at,
        'active',
        v_item_starts_at,
        v_item_expires_at
      );
    else
      v_item_expires_at := coalesce(v_existing.expires_at, v_pack_expires_at);
      if not v_already_active then
        insert into public.module_entitlements (
          user_id,
          exam_pack_id,
          subject_id,
          payment_order_id,
          status,
          starts_at,
          expires_at,
          metadata
        ) values (
          v_order.user_id,
          v_order.exam_pack_id,
          v_item.subject_id,
          v_order.id,
          'active',
          v_activated_at,
          v_item_expires_at,
          jsonb_build_object(
            'provider', v_order.provider,
            'reference', v_order.provider_reference,
            'purchase_type', v_order.purchase_type,
            'purchase_offer_id', v_order.purchase_offer_id
          )
        );
      end if;
    end if;

    v_order_access_expires_at := greatest(
      coalesce(v_order_access_expires_at, v_item_expires_at),
      v_item_expires_at
    );

    return query select
      v_order.id,
      v_item.subject_id,
      v_item.name,
      v_item.slug,
      v_item_expires_at,
      v_already_active;
  end loop;

  update public.payment_orders payment_order
  set status = 'active',
      paid_at = coalesce(payment_order.paid_at, v_activated_at),
      provider_status = 'success',
      provider_payload = coalesce(payment_payload, '{}'::jsonb),
      provider_checked_at = coalesce(payment_order.provider_checked_at, now()),
      fulfillment_status = 'fulfilled',
      fulfillment_error = null,
      access_starts_at = case
        when payment_order.purchase_type = 'pricing_plan'
          then coalesce(payment_order.access_starts_at, v_order_access_starts_at)
        else payment_order.access_starts_at
      end,
      access_expires_at = case
        when payment_order.purchase_type = 'pricing_plan' then v_order_access_expires_at
        else payment_order.access_expires_at
      end,
      updated_at = now()
  where payment_order.id = v_order.id;
end;
$$;

revoke all on function public.activate_module_purchase(text, jsonb)
from public, anon, authenticated;
grant execute on function public.activate_module_purchase(text, jsonb) to service_role;
