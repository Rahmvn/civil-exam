-- A single, genuine launch offer. Regular module prices remain authoritative
-- outside the configured window, and payment orders retain the price context
-- that was shown when checkout was initialized.
create table public.launch_offers (
  id uuid primary key default gen_random_uuid(),
  singleton_key text not null default 'launch' unique
    check (singleton_key = 'launch'),
  discounted_price_kobo integer not null
    check (discounted_price_kobo > 0),
  currency text not null default 'NGN'
    check (currency = upper(currency) and char_length(currency) = 3),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '7 days')
);

create trigger launch_offers_touch_updated_at
before update on public.launch_offers
for each row execute function public.touch_updated_at();

alter table public.launch_offers enable row level security;

-- No browser role reads this operational table directly. Candidate and public
-- callers receive only the minimum pricing fields through dedicated RPCs.
revoke all on table public.launch_offers from public, anon, authenticated;
grant select, insert, update on table public.launch_offers to service_role;

alter table public.payment_orders
  add column list_price_kobo integer,
  add column pricing_type text not null default 'regular',
  add column launch_offer_ends_at timestamptz;

update public.payment_orders
set list_price_kobo = amount_kobo
where list_price_kobo is null;

create or replace function public.set_payment_order_list_price()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.list_price_kobo := coalesce(new.list_price_kobo, new.amount_kobo);
  return new;
end;
$$;

create trigger payment_orders_set_list_price
before insert on public.payment_orders
for each row execute function public.set_payment_order_list_price();

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
    where lo.singleton_key = 'launch'
      and lo.enabled = true
      and now() < lo.ends_at
      and lo.currency = new.currency
      and lo.discounted_price_kobo >= new.price_kobo
  ) then
    raise exception 'An active module regular price must remain above the configured launch price';
  end if;

  return new;
end;
$$;

create trigger module_offerings_enforce_launch_price
before insert or update of price_kobo, currency, is_active on public.module_offerings
for each row execute function public.enforce_launch_offer_regular_price();

alter table public.payment_orders
  alter column list_price_kobo set not null;

alter table public.payment_orders
  add constraint payment_orders_list_price_positive
    check (list_price_kobo > 0),
  add constraint payment_orders_price_not_above_list
    check (amount_kobo <= list_price_kobo),
  add constraint payment_orders_pricing_type_check
    check (pricing_type in ('regular', 'launch_offer')),
  add constraint payment_orders_launch_price_context_check
    check (
      (pricing_type = 'regular' and launch_offer_ends_at is null)
      or
      (pricing_type = 'launch_offer' and launch_offer_ends_at is not null)
    );

create or replace function public.get_admin_launch_offer()
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
  offering_summary as (
    select
      count(*)::integer as module_count,
      min(mo.price_kobo)::integer as minimum_price,
      max(mo.price_kobo)::integer as maximum_price
    from public.module_offerings mo
    join active_pack ap on ap.id = mo.exam_pack_id
    join public.subjects s on s.id = mo.subject_id
    where mo.is_active = true
      and s.is_active = true
      and s.lifecycle_status = 'active'
  )
  select
    lo.id,
    lo.discounted_price_kobo,
    lo.currency,
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
    lo.created_at,
    lo.updated_at
  from offering_summary os
  left join public.launch_offers lo on lo.singleton_key = 'launch';
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
  current_offer public.launch_offers%rowtype;
  saved_offer public.launch_offers%rowtype;
  eligible_module_count integer;
  minimum_regular_price integer;
begin
  perform public.admin_assert_access();

  if requested_discounted_price_kobo is null or requested_discounted_price_kobo <= 0 then
    raise exception 'Launch price must be greater than zero';
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
  )
  select count(*)::integer, min(mo.price_kobo)::integer
  into eligible_module_count, minimum_regular_price
  from public.module_offerings mo
  join active_pack ap on ap.id = mo.exam_pack_id
  join public.subjects s on s.id = mo.subject_id
  where mo.is_active = true
    and mo.currency = 'NGN'
    and s.is_active = true
    and s.lifecycle_status = 'active';

  if coalesce(eligible_module_count, 0) = 0 then
    raise exception 'No active NGN module offerings are available for the launch offer';
  end if;

  if requested_discounted_price_kobo >= minimum_regular_price then
    raise exception 'Launch price must be lower than every active module regular price';
  end if;

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
    requested_discounted_price_kobo,
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

  perform public.admin_write_audit(
    'SCHEDULE_LAUNCH_OFFER',
    'launch_offer',
    saved_offer.id,
    jsonb_build_object(
      'discounted_price_kobo', saved_offer.discounted_price_kobo,
      'currency', saved_offer.currency,
      'starts_at', saved_offer.starts_at,
      'ends_at', saved_offer.ends_at,
      'eligible_module_count', eligible_module_count
    )
  );

  return jsonb_build_object(
    'id', saved_offer.id,
    'discounted_price_kobo', saved_offer.discounted_price_kobo,
    'currency', saved_offer.currency,
    'starts_at', saved_offer.starts_at,
    'ends_at', saved_offer.ends_at,
    'enabled', saved_offer.enabled
  );
end;
$$;

create or replace function public.admin_end_launch_offer()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_offer public.launch_offers%rowtype;
  ended_offer public.launch_offers%rowtype;
begin
  perform public.admin_assert_access();

  select *
  into current_offer
  from public.launch_offers
  where singleton_key = 'launch'
  for update;

  if not found then
    raise exception 'No launch offer has been configured';
  end if;

  if not current_offer.enabled then
    return jsonb_build_object(
      'id', current_offer.id,
      'enabled', false,
      'ends_at', current_offer.ends_at
    );
  end if;

  update public.launch_offers
  set enabled = false,
      ends_at = case
        when starts_at <= now() and ends_at > now() then now()
        else ends_at
      end
  where id = current_offer.id
  returning * into ended_offer;

  perform public.admin_write_audit(
    case when current_offer.starts_at > now()
      then 'CANCEL_LAUNCH_OFFER'
      else 'END_LAUNCH_OFFER'
    end,
    'launch_offer',
    ended_offer.id,
    jsonb_build_object(
      'discounted_price_kobo', ended_offer.discounted_price_kobo,
      'starts_at', ended_offer.starts_at,
      'ends_at', ended_offer.ends_at
    )
  );

  return jsonb_build_object(
    'id', ended_offer.id,
    'enabled', ended_offer.enabled,
    'ends_at', ended_offer.ends_at
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
    select mo.price_kobo, mo.currency
    from public.module_offerings mo
    join active_pack ap on ap.id = mo.exam_pack_id
    join public.subjects s on s.id = mo.subject_id
    cross join active_offer lo
    where mo.is_active = true
      and s.is_active = true
      and s.lifecycle_status = 'active'
      and mo.currency = lo.currency
      and lo.discounted_price_kobo < mo.price_kobo
  )
  select
    min(eo.price_kobo)::integer,
    lo.discounted_price_kobo,
    lo.currency,
    lo.ends_at,
    min(eo.price_kobo) = max(eo.price_kobo)
  from active_offer lo
  join eligible_offerings eo on true
  group by lo.discounted_price_kobo, lo.currency, lo.ends_at;
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
      and lo.currency = mo.currency
      and lo.discounted_price_kobo < mo.price_kobo,
      false
    ) then lo.discounted_price_kobo else mo.price_kobo end,
    mo.price_kobo,
    mo.currency,
    coalesce(
      lo.enabled
      and now() >= lo.starts_at
      and now() < lo.ends_at
      and lo.currency = mo.currency
      and lo.discounted_price_kobo < mo.price_kobo,
      false
    ),
    case when coalesce(
      lo.enabled
      and now() >= lo.starts_at
      and now() < lo.ends_at
      and lo.currency = mo.currency
      and lo.discounted_price_kobo < mo.price_kobo,
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
  where s.is_active = true
  order by s.sort_order, s.name;
end;
$$;

revoke all on function public.get_admin_launch_offer() from public, anon;
revoke all on function public.set_payment_order_list_price() from public, anon, authenticated;
revoke all on function public.enforce_launch_offer_regular_price() from public, anon, authenticated;
revoke all on function public.admin_configure_launch_offer(integer, timestamptz, timestamptz) from public, anon;
revoke all on function public.admin_end_launch_offer() from public, anon;
revoke all on function public.get_public_launch_offer() from public;
revoke all on function public.get_module_access_catalog_v2() from public, anon;

grant execute on function public.get_admin_launch_offer() to authenticated;
grant execute on function public.admin_configure_launch_offer(integer, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_end_launch_offer() to authenticated;
grant execute on function public.get_public_launch_offer() to anon, authenticated;
grant execute on function public.get_module_access_catalog_v2() to authenticated;
