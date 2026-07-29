create table public.launch_offer_module_prices (
  id uuid primary key default gen_random_uuid(),
  launch_offer_id uuid not null references public.launch_offers(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  discounted_price_kobo integer not null check (discounted_price_kobo > 0),
  currency text not null default 'NGN'
    check (currency = upper(currency) and char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (launch_offer_id, subject_id)
);

create trigger launch_offer_module_prices_touch_updated_at
before update on public.launch_offer_module_prices
for each row execute function public.touch_updated_at();

alter table public.launch_offer_module_prices enable row level security;

revoke all on table public.launch_offer_module_prices from public, anon, authenticated;
grant select, insert, update, delete on table public.launch_offer_module_prices to service_role;

insert into public.launch_offer_module_prices (
  launch_offer_id,
  subject_id,
  discounted_price_kobo,
  currency
)
select
  lo.id,
  mo.subject_id,
  lo.discounted_price_kobo,
  lo.currency
from public.launch_offers lo
join public.exam_packs ep
  on ep.is_active = true
join public.module_offerings mo
  on mo.exam_pack_id = ep.id
join public.subjects s
  on s.id = mo.subject_id
where lo.singleton_key = 'launch'
  and mo.is_active = true
  and mo.currency = lo.currency
  and lo.discounted_price_kobo < mo.price_kobo
  and s.is_active = true
  and s.lifecycle_status = 'active'
on conflict (launch_offer_id, subject_id) do nothing;

create or replace function public.enforce_launch_offer_regular_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_active and exists (
    select 1
    from public.launch_offers lo
    join public.launch_offer_module_prices lop
      on lop.launch_offer_id = lo.id
     and lop.subject_id = new.subject_id
    where lo.singleton_key = 'launch'
      and lo.enabled = true
      and now() < lo.ends_at
      and lop.currency = new.currency
      and lop.discounted_price_kobo >= new.price_kobo
  ) then
    raise exception 'An active module regular price must remain above its configured launch price';
  end if;

  return new;
end;
$$;

drop function public.get_admin_launch_offer();

create function public.get_admin_launch_offer()
returns table (
  id uuid,
  discounted_price_kobo integer,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean,
  status text,
  eligible_module_count integer,
  minimum_regular_price_kobo integer,
  maximum_regular_price_kobo integer,
  module_prices jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
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
  eligible_offerings as (
    select
      s.id as subject_id,
      s.name as subject_name,
      s.slug as subject_slug,
      s.practice_type,
      mo.price_kobo,
      mo.currency
    from public.module_offerings mo
    join active_pack ap on ap.id = mo.exam_pack_id
    join public.subjects s on s.id = mo.subject_id
    where mo.is_active = true
      and mo.currency = 'NGN'
      and s.is_active = true
      and s.lifecycle_status = 'active'
  ),
  offering_summary as (
    select
      count(*)::integer as module_count,
      min(eo.price_kobo)::integer as minimum_price,
      max(eo.price_kobo)::integer as maximum_price
    from eligible_offerings eo
  ),
  configured_prices as (
    select
      lop.launch_offer_id,
      jsonb_agg(
        jsonb_build_object(
          'subject_id', eo.subject_id,
          'subject_name', eo.subject_name,
          'subject_slug', eo.subject_slug,
          'practice_type', eo.practice_type,
          'regular_price_kobo', eo.price_kobo,
          'discounted_price_kobo', lop.discounted_price_kobo,
          'currency', lop.currency
        )
        order by eo.subject_name
      ) as prices,
      min(lop.discounted_price_kobo)::integer as minimum_discounted_price
    from public.launch_offer_module_prices lop
    join eligible_offerings eo on eo.subject_id = lop.subject_id
    group by lop.launch_offer_id
  )
  select
    lo.id,
    coalesce(cp.minimum_discounted_price, lo.discounted_price_kobo),
    coalesce(lo.currency, 'NGN'),
    lo.starts_at,
    lo.ends_at,
    coalesce(lo.enabled, false),
    case
      when lo.id is null then 'not_configured'
      when not lo.enabled and lo.starts_at > now() then 'cancelled'
      when not lo.enabled then 'ended'
      when now() < lo.starts_at then 'scheduled'
      when now() < lo.ends_at then 'live'
      else 'ended'
    end,
    coalesce(os.module_count, 0),
    os.minimum_price,
    os.maximum_price,
    coalesce(cp.prices, '[]'::jsonb),
    lo.created_at,
    lo.updated_at
  from offering_summary os
  left join public.launch_offers lo on lo.singleton_key = 'launch'
  left join configured_prices cp on cp.launch_offer_id = lo.id;
end;
$$;

create or replace function public.admin_configure_launch_offer(
  requested_module_prices jsonb,
  requested_starts_at timestamptz,
  requested_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_offer public.launch_offers%rowtype;
  saved_offer public.launch_offers%rowtype;
  eligible_module_count integer;
  saved_module_prices jsonb;
  minimum_discounted_price integer;
begin
  perform public.admin_assert_access();

  if requested_module_prices is null or jsonb_typeof(requested_module_prices) <> 'array' then
    raise exception 'Launch prices are required for each module';
  end if;

  if requested_starts_at is null or requested_ends_at is null then
    raise exception 'Launch offer start and end times are required';
  end if;

  if requested_starts_at < now() - interval '5 minutes' then
    raise exception 'Launch offer start time cannot be in the past';
  end if;

  if requested_ends_at <= requested_starts_at then
    raise exception 'Launch offer end time must be after its start time';
  end if;

  if requested_ends_at > requested_starts_at + interval '7 days' then
    raise exception 'The one-time launch offer cannot run for more than seven days';
  end if;

  select *
  into current_offer
  from public.launch_offers
  where singleton_key = 'launch'
  for update;

  if found and current_offer.starts_at <= now() then
    raise exception 'The one-time launch offer has already started and cannot be rescheduled';
  end if;

  with active_pack as (
    select ep.id
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  eligible_offerings as (
    select
      mo.subject_id,
      mo.price_kobo,
      mo.currency
    from public.module_offerings mo
    join active_pack ap on ap.id = mo.exam_pack_id
    join public.subjects s on s.id = mo.subject_id
    where mo.is_active = true
      and mo.currency = 'NGN'
      and s.is_active = true
      and s.lifecycle_status = 'active'
  )
  select
    count(*)::integer
  into eligible_module_count
  from eligible_offerings;

  if exists (
    with requested_prices as (
      select (item->>'subject_id')::uuid as subject_id
      from jsonb_array_elements(requested_module_prices) as item
    )
    select 1
    from requested_prices rp
    group by rp.subject_id
    having count(*) > 1
  ) then
    raise exception 'Each module can only have one launch price';
  end if;

  if coalesce(eligible_module_count, 0) = 0 then
    raise exception 'No active NGN module offerings are available for the launch offer';
  end if;

  if eligible_module_count <> jsonb_array_length(requested_module_prices) then
    raise exception 'Launch prices must match the active NGN modules';
  end if;

  if exists (
    with active_pack as (
      select ep.id
      from public.exam_packs ep
      where ep.is_active = true
      order by ep.active_from desc, ep.created_at desc
      limit 1
    ),
    eligible_offerings as (
      select mo.subject_id, mo.price_kobo
      from public.module_offerings mo
      join active_pack ap on ap.id = mo.exam_pack_id
      join public.subjects s on s.id = mo.subject_id
      where mo.is_active = true
        and mo.currency = 'NGN'
        and s.is_active = true
        and s.lifecycle_status = 'active'
    ),
    requested_prices as (
      select
        (item->>'subject_id')::uuid as subject_id,
        (item->>'discounted_price_kobo')::integer as discounted_price_kobo
      from jsonb_array_elements(requested_module_prices) as item
    )
    select 1
    from eligible_offerings eo
    left join requested_prices rp on rp.subject_id = eo.subject_id
    where rp.discounted_price_kobo is null
       or rp.discounted_price_kobo <= 0
       or rp.discounted_price_kobo >= eo.price_kobo
  ) then
    raise exception 'Each launch price must be lower than that module regular price';
  end if;

  select min((item->>'discounted_price_kobo')::integer)
  into minimum_discounted_price
  from jsonb_array_elements(requested_module_prices) as item;

  insert into public.launch_offers (
    singleton_key,
    discounted_price_kobo,
    currency,
    starts_at,
    ends_at,
    enabled
  )
  values (
    'launch',
    minimum_discounted_price,
    'NGN',
    requested_starts_at,
    requested_ends_at,
    true
  )
  on conflict (singleton_key) do update
  set discounted_price_kobo = excluded.discounted_price_kobo,
      currency = excluded.currency,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      enabled = true
  returning * into saved_offer;

  delete from public.launch_offer_module_prices
  where launch_offer_id = saved_offer.id;

  insert into public.launch_offer_module_prices (
    launch_offer_id,
    subject_id,
    discounted_price_kobo,
    currency
  )
  select
    saved_offer.id,
    (item->>'subject_id')::uuid,
    (item->>'discounted_price_kobo')::integer,
    'NGN'
  from jsonb_array_elements(requested_module_prices) as item;

  select jsonb_agg(
    jsonb_build_object(
      'subject_id', lop.subject_id,
      'discounted_price_kobo', lop.discounted_price_kobo,
      'currency', lop.currency
    )
    order by lop.subject_id
  )
  into saved_module_prices
  from public.launch_offer_module_prices lop
  where lop.launch_offer_id = saved_offer.id;

  perform public.admin_write_audit(
    'SCHEDULE_LAUNCH_OFFER',
    'launch_offer',
    saved_offer.id,
    jsonb_build_object(
      'module_prices', saved_module_prices,
      'currency', saved_offer.currency,
      'starts_at', saved_offer.starts_at,
      'ends_at', saved_offer.ends_at,
      'eligible_module_count', eligible_module_count
    )
  );

  return jsonb_build_object(
    'id', saved_offer.id,
    'module_prices', saved_module_prices,
    'currency', saved_offer.currency,
    'starts_at', saved_offer.starts_at,
    'ends_at', saved_offer.ends_at,
    'enabled', saved_offer.enabled
  );
end;
$$;

create or replace function public.admin_configure_launch_offer(
  requested_discounted_price_kobo integer,
  requested_starts_at timestamptz,
  requested_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_module_prices jsonb;
begin
  perform public.admin_assert_access();

  if requested_discounted_price_kobo is null or requested_discounted_price_kobo <= 0 then
    raise exception 'Launch price must be greater than zero';
  end if;

  with active_pack as (
    select ep.id
    from public.exam_packs ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  )
  select jsonb_agg(jsonb_build_object(
    'subject_id', mo.subject_id,
    'discounted_price_kobo', requested_discounted_price_kobo
  ))
  into requested_module_prices
  from public.module_offerings mo
  join active_pack ap on ap.id = mo.exam_pack_id
  join public.subjects s on s.id = mo.subject_id
  where mo.is_active = true
    and mo.currency = 'NGN'
    and s.is_active = true
    and s.lifecycle_status = 'active';

  return public.admin_configure_launch_offer(
    coalesce(requested_module_prices, '[]'::jsonb),
    requested_starts_at,
    requested_ends_at
  );
end;
$$;

create or replace function public.get_public_launch_offer()
returns table (
  regular_price_kobo integer,
  discounted_price_kobo integer,
  currency text,
  ends_at timestamptz,
  has_uniform_regular_price boolean
)
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
  ),
  active_offer as (
    select lo.*
    from public.launch_offers lo
    where lo.singleton_key = 'launch'
      and lo.enabled = true
      and now() >= lo.starts_at
      and now() < lo.ends_at
  ),
  eligible_offerings as (
    select mo.subject_id, mo.price_kobo, mo.currency, lop.discounted_price_kobo
    from public.module_offerings mo
    join active_pack ap on ap.id = mo.exam_pack_id
    join public.subjects s on s.id = mo.subject_id
    join active_offer lo on true
    join public.launch_offer_module_prices lop
      on lop.launch_offer_id = lo.id
     and lop.subject_id = mo.subject_id
    where mo.is_active = true
      and s.is_active = true
      and s.lifecycle_status = 'active'
      and mo.currency = lop.currency
      and lop.discounted_price_kobo < mo.price_kobo
  )
  select
    min(eo.price_kobo)::integer,
    min(eo.discounted_price_kobo)::integer,
    lo.currency,
    lo.ends_at,
    min(eo.price_kobo) = max(eo.price_kobo)
      and min(eo.discounted_price_kobo) = max(eo.discounted_price_kobo)
  from active_offer lo
  join eligible_offerings eo on true
  group by lo.currency, lo.ends_at;
$$;

create or replace function public.get_module_access_catalog_v2()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  practice_type public.practice_type,
  lifecycle_status public.module_lifecycle_status,
  candidate_availability public.module_candidate_availability,
  offering_id uuid,
  price_kobo integer,
  regular_price_kobo integer,
  currency text,
  launch_offer_active boolean,
  launch_offer_ends_at timestamptz,
  can_purchase boolean,
  has_module_access boolean,
  access_expires_at timestamptz,
  is_free_module boolean,
  published_batch_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

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
    where e.user_id = auth.uid()
      and e.status = 'active'
      and e.expires_at > now()
  ),
  module_access as (
    select me.subject_id, max(me.expires_at) as expires_at
    from public.module_entitlements me
    join active_pack ap on ap.id = me.exam_pack_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.expires_at > now()
    group by me.subject_id
  ),
  free_module as (
    select ump.subject_id
    from public.user_module_progress ump
    join active_pack ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  ),
  published as (
    select ps.subject_id, count(*)::integer as batch_count
    from public.practice_sets ps
    join active_pack ap on ap.id = ps.exam_pack_id
    where ps.status = 'published'
      and (
        exists (
          select 1 from public.questions q
          where q.practice_set_id = ps.id and q.status = 'published'
        )
        or exists (
          select 1 from public.oral_questions oq
          where oq.practice_set_id = ps.id and oq.status = 'published'
        )
      )
    group by ps.subject_id
  ),
  configured_offer as (
    select lo.*
    from public.launch_offers lo
    where lo.singleton_key = 'launch'
  )
  select
    s.id,
    s.name,
    s.slug,
    s.practice_type,
    s.lifecycle_status,
    s.candidate_availability,
    mo.id,
    case when coalesce(
      lo.enabled
      and now() >= lo.starts_at
      and now() < lo.ends_at
      and lop.currency = mo.currency
      and lop.discounted_price_kobo < mo.price_kobo,
      false
    ) then lop.discounted_price_kobo else mo.price_kobo end,
    mo.price_kobo,
    mo.currency,
    coalesce(
      lo.enabled
      and now() >= lo.starts_at
      and now() < lo.ends_at
      and lop.currency = mo.currency
      and lop.discounted_price_kobo < mo.price_kobo,
      false
    ),
    case when coalesce(
      lo.enabled
      and now() >= lo.starts_at
      and now() < lo.ends_at
      and lop.currency = mo.currency
      and lop.discounted_price_kobo < mo.price_kobo,
      false
    ) then lo.ends_at else null end,
    coalesce(mo.is_active, false)
      and s.lifecycle_status = 'active'
      and s.candidate_availability = 'available'
      and coalesce(p.batch_count, 0) > 0,
    (la.expires_at is not null or ma.expires_at is not null),
    greatest(la.expires_at, ma.expires_at),
    exists (select 1 from free_module fm where fm.subject_id = s.id),
    coalesce(p.batch_count, 0)
  from public.subjects s
  cross join active_pack ap
  left join public.module_offerings mo
    on mo.exam_pack_id = ap.id and mo.subject_id = s.id
  left join published p on p.subject_id = s.id
  left join module_access ma on ma.subject_id = s.id
  cross join legacy_access la
  left join configured_offer lo on true
  left join public.launch_offer_module_prices lop
    on lop.launch_offer_id = lo.id
   and lop.subject_id = s.id
  where s.is_active = true
  order by s.sort_order, s.name;
end;
$$;

revoke all on function public.get_admin_launch_offer() from public, anon;
revoke all on function public.enforce_launch_offer_regular_price() from public, anon, authenticated;
revoke all on function public.admin_configure_launch_offer(integer, timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_configure_launch_offer(jsonb, timestamptz, timestamptz) from public, anon;
revoke all on function public.get_public_launch_offer() from public;
revoke all on function public.get_module_access_catalog_v2() from public, anon;

grant execute on function public.get_admin_launch_offer() to authenticated;
grant execute on function public.admin_configure_launch_offer(integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_configure_launch_offer(jsonb, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_public_launch_offer() to anon, authenticated;
grant execute on function public.get_module_access_catalog_v2() to authenticated;
