-- Module-specific purchases and access.
-- Legacy pack entitlements remain valid until their original expiry.

create table public.module_offerings (
  id uuid primary key default gen_random_uuid(),
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  price_kobo integer not null check (price_kobo > 0),
  currency text not null default 'NGN',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_pack_id, subject_id)
);

create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id),
  subject_id uuid not null references public.subjects(id),
  module_offering_id uuid not null references public.module_offerings(id),
  provider text not null default 'paystack',
  provider_reference text not null unique,
  status public.payment_status not null default 'pending',
  amount_kobo integer not null check (amount_kobo > 0),
  currency text not null default 'NGN',
  provider_payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.module_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  payment_order_id uuid references public.payment_orders(id),
  status public.payment_status not null default 'active',
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_order_id)
);

create unique index module_entitlements_one_active_module_per_user
  on public.module_entitlements (user_id, exam_pack_id, subject_id)
  where status = 'active';

create index payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc);

create index module_entitlements_user_access_idx
  on public.module_entitlements (user_id, exam_pack_id, subject_id, expires_at desc);

create trigger module_offerings_touch_updated_at
before update on public.module_offerings
for each row execute function public.touch_updated_at();

create trigger payment_orders_touch_updated_at
before update on public.payment_orders
for each row execute function public.touch_updated_at();

create trigger module_entitlements_touch_updated_at
before update on public.module_entitlements
for each row execute function public.touch_updated_at();

alter table public.module_offerings enable row level security;
alter table public.payment_orders enable row level security;
alter table public.module_entitlements enable row level security;

create policy "module_offerings_read_active"
on public.module_offerings for select
using (is_active = true or public.is_admin());

create policy "admins_manage_module_offerings"
on public.module_offerings for all
using (public.is_admin())
with check (public.is_admin());

create policy "payment_orders_select_own_or_admin"
on public.payment_orders for select
using (user_id = auth.uid() or public.is_admin());

create policy "admins_manage_payment_orders"
on public.payment_orders for all
using (public.is_admin())
with check (public.is_admin());

create policy "module_entitlements_select_own_or_admin"
on public.module_entitlements for select
using (user_id = auth.uid() or public.is_admin());

create policy "admins_manage_module_entitlements"
on public.module_entitlements for all
using (public.is_admin())
with check (public.is_admin());

-- Preserve the only configured price as the initial per-module price. Prices
-- can then be managed independently without changing the exam-pack record.
insert into public.module_offerings (
  exam_pack_id,
  subject_id,
  price_kobo,
  currency,
  is_active
)
select distinct
  ep.id,
  s.id,
  ep.price_kobo,
  ep.currency,
  true
from public.exam_packs as ep
join public.questions as q
  on q.exam_pack_id = ep.id
 and q.status = 'published'
join public.subjects as s
  on s.id = q.subject_id
 and s.is_active = true
where ep.is_active = true
on conflict (exam_pack_id, subject_id) do nothing;

create or replace function public.has_active_module_entitlement(
  pack_id uuid,
  requested_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements as legacy
    where legacy.user_id = auth.uid()
      and legacy.exam_pack_id = has_active_module_entitlement.pack_id
      and legacy.status = 'active'
      and legacy.expires_at > now()
  ) or exists (
    select 1
    from public.module_entitlements as module_access
    where module_access.user_id = auth.uid()
      and module_access.exam_pack_id = has_active_module_entitlement.pack_id
      and module_access.subject_id = has_active_module_entitlement.requested_subject_id
      and module_access.status = 'active'
      and module_access.expires_at > now()
  );
$$;

grant execute on function public.has_active_module_entitlement(uuid, uuid) to authenticated;

drop function if exists public.get_candidate_summary();

create or replace function public.get_candidate_summary()
returns table (
  pack_id uuid,
  pack_name text,
  price_kobo integer,
  currency text,
  trial_question_limit integer,
  trial_questions_used bigint,
  has_paid_access boolean,
  access_expires_at timestamptz,
  free_module_subject_id uuid,
  free_module_subject_slug text,
  free_first_attempt_completed boolean,
  free_retry_consumed boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with active_pack as (
    select ep.*
    from public.exam_packs as ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  access_expiries as (
    select e.expires_at
    from public.entitlements as e
    join active_pack as ap on ap.id = e.exam_pack_id
    where e.user_id = auth.uid()
      and e.status = 'active'
      and e.expires_at > now()
    union all
    select me.expires_at
    from public.module_entitlements as me
    join active_pack as ap on ap.id = me.exam_pack_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.expires_at > now()
  ),
  free_module as (
    select
      ump.subject_id,
      s.slug as subject_slug,
      ump.free_first_attempt_completed,
      ump.free_retry_consumed
    from public.user_module_progress as ump
    join public.subjects as s on s.id = ump.subject_id
    join active_pack as ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  )
  select
    ap.id,
    ap.name,
    ap.price_kobo,
    ap.currency,
    null::integer,
    null::bigint,
    exists (select 1 from access_expiries),
    (select max(ae.expires_at) from access_expiries as ae),
    (select fm.subject_id from free_module as fm),
    (select fm.subject_slug from free_module as fm),
    coalesce((select fm.free_first_attempt_completed from free_module as fm), false),
    coalesce((select fm.free_retry_consumed from free_module as fm), false)
  from active_pack as ap;
$$;

grant execute on function public.get_candidate_summary() to authenticated;

create or replace function public.get_module_access_catalog()
returns table (
  subject_id uuid,
  subject_name text,
  subject_slug text,
  offering_id uuid,
  price_kobo integer,
  currency text,
  can_purchase boolean,
  has_module_access boolean,
  access_expires_at timestamptz,
  is_free_module boolean,
  published_batch_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with active_pack as (
    select ep.*
    from public.exam_packs as ep
    where ep.is_active = true
    order by ep.active_from desc, ep.created_at desc
    limit 1
  ),
  legacy_access as (
    select max(e.expires_at) as expires_at
    from public.entitlements as e
    join active_pack as ap on ap.id = e.exam_pack_id
    where e.user_id = auth.uid()
      and e.status = 'active'
      and e.expires_at > now()
  ),
  module_access as (
    select me.subject_id, max(me.expires_at) as expires_at
    from public.module_entitlements as me
    join active_pack as ap on ap.id = me.exam_pack_id
    where me.user_id = auth.uid()
      and me.status = 'active'
      and me.expires_at > now()
    group by me.subject_id
  ),
  free_module as (
    select ump.subject_id
    from public.user_module_progress as ump
    join active_pack as ap on ap.id = ump.exam_pack_id
    where ump.user_id = auth.uid()
      and ump.selected_for_free_access = true
    limit 1
  ),
  published as (
    select q.subject_id, count(distinct q.batch_number)::integer as batch_count
    from public.questions as q
    join active_pack as ap on ap.id = q.exam_pack_id
    where q.status = 'published'
    group by q.subject_id
  )
  select
    s.id,
    s.name,
    s.slug,
    mo.id,
    mo.price_kobo,
    mo.currency,
    coalesce(mo.is_active, false) and coalesce(p.batch_count, 0) > 0,
    (la.expires_at is not null or ma.expires_at is not null),
    greatest(la.expires_at, ma.expires_at),
    exists (select 1 from free_module as fm where fm.subject_id = s.id),
    coalesce(p.batch_count, 0)
  from public.subjects as s
  cross join active_pack as ap
  left join public.module_offerings as mo
    on mo.exam_pack_id = ap.id
   and mo.subject_id = s.id
   and mo.is_active = true
  left join published as p on p.subject_id = s.id
  left join module_access as ma on ma.subject_id = s.id
  cross join legacy_access as la
  where s.is_active = true
  order by s.sort_order, s.name;
$$;

grant execute on function public.get_module_access_catalog() to authenticated;

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
  is_legacy_full_access boolean
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
      false
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
      true
    from public.entitlements as e
    where e.user_id = auth.uid()
  ) as history
  order by history.created_at desc
  limit greatest(coalesce(requested_limit, 20), 1);
$$;

grant execute on function public.get_payment_history(integer) to authenticated;

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
set search_path = public
as $$
declare
  v_order public.payment_orders;
  v_pack public.exam_packs;
  v_subject public.subjects;
  v_existing public.module_entitlements;
  v_expires_at timestamptz;
  v_already_active boolean := false;
begin
  select po.* into v_order
  from public.payment_orders as po
  where po.provider_reference = requested_reference
  for update;

  if v_order.id is null then
    raise exception 'Payment order was not found';
  end if;

  select ep.* into v_pack from public.exam_packs as ep where ep.id = v_order.exam_pack_id;
  select s.* into v_subject from public.subjects as s where s.id = v_order.subject_id;

  if v_pack.id is null or v_subject.id is null then
    raise exception 'Payment order is not linked to an available module';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_order.user_id::text || ':' || v_order.exam_pack_id::text || ':' || v_order.subject_id::text,
      0
    )
  );

  v_expires_at := (v_pack.active_until::text || ' 23:59:59.999+00')::timestamptz;

  select me.* into v_existing
  from public.module_entitlements as me
  where me.user_id = v_order.user_id
    and me.exam_pack_id = v_order.exam_pack_id
    and me.subject_id = v_order.subject_id
    and me.status = 'active'
    and me.expires_at > now()
  order by me.expires_at desc
  limit 1;

  v_already_active := v_existing.id is not null;

  update public.payment_orders as po
  set status = 'active',
      paid_at = coalesce(po.paid_at, now()),
      provider_payload = coalesce(payment_payload, '{}'::jsonb),
      updated_at = now()
  where po.id = v_order.id;

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
      v_order.subject_id,
      v_order.id,
      'active',
      now(),
      v_expires_at,
      jsonb_build_object('provider', v_order.provider, 'reference', v_order.provider_reference)
    );
  else
    v_expires_at := v_existing.expires_at;
  end if;

  return query select
    v_order.id,
    v_subject.id,
    v_subject.name,
    v_subject.slug,
    v_expires_at,
    v_already_active;
end;
$$;

revoke all on function public.activate_module_purchase(text, jsonb) from public, anon, authenticated;
grant execute on function public.activate_module_purchase(text, jsonb) to service_role;

-- Convert the existing access functions to module-scoped authorization while
-- retaining their response columns for frontend compatibility.
do $$
declare
  function_signature regprocedure;
  current_definition text;
  updated_definition text;
begin
  function_signature := to_regprocedure('public.get_batch_access_state(text,integer)');
  select pg_get_functiondef(function_signature) into current_definition;
  updated_definition := replace(
    current_definition,
    'v_is_paid := public.has_active_entitlement(v_active_pack.id);',
    'v_is_paid := public.has_active_module_entitlement(v_active_pack.id, v_subject.id);'
  );
  updated_definition := replace(updated_definition, 'Unlock full access to continue to another batch.', 'Unlock this module to continue.');
  updated_definition := replace(updated_definition, 'Unlock full access to continue with another module.', 'Unlock this module to practise it.');
  updated_definition := replace(updated_definition, 'You passed the free batch. Unlock full access to continue.', 'You passed the free practice set. Unlock this module to continue.');
  updated_definition := replace(updated_definition, 'You already used your free retry. Unlock full access to continue.', 'Your free retry is complete. Unlock this module to continue.');
  if updated_definition = current_definition then
    raise exception 'get_batch_access_state could not be updated safely';
  end if;
  execute updated_definition;

  function_signature := to_regprocedure('public.resolve_practice_batch_context_payload(uuid,text,integer,boolean)');
  select pg_get_functiondef(function_signature) into current_definition;
  updated_definition := replace(
    current_definition,
    'v_has_paid_access := public.has_active_entitlement(v_active_pack.id);',
    'v_has_paid_access := public.has_active_module_entitlement(v_active_pack.id, v_target_subject.id);'
  );
  if updated_definition = current_definition then
    raise exception 'resolve_practice_batch_context_payload could not be updated safely';
  end if;
  execute updated_definition;

  function_signature := to_regprocedure('public.submit_attempt(public.attempt_mode,uuid,jsonb,integer)');
  select pg_get_functiondef(function_signature) into current_definition;
  updated_definition := replace(current_definition, 'unlock_full_access', 'unlock_module');
  if updated_definition = current_definition then
    raise exception 'submit_attempt could not be updated safely';
  end if;
  execute updated_definition;

  function_signature := to_regprocedure('public.get_attempt_review(uuid)');
  select pg_get_functiondef(function_signature) into current_definition;
  updated_definition := replace(current_definition, 'unlock_full_access', 'unlock_module');
  if updated_definition = current_definition then
    raise exception 'get_attempt_review could not be updated safely';
  end if;
  execute updated_definition;
end;
$$;
