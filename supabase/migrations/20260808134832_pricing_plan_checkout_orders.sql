-- Payment-order support for duration pricing plan checkout.
--
-- This only teaches payment_orders how to snapshot a plan-based checkout.
-- Entitlement activation remains legacy until the follow-up duration
-- activation migration updates `activate_module_purchase`.

alter table public.payment_orders
  add column if not exists purchase_plan_id uuid references public.purchase_plans(id),
  add column if not exists plan_code text,
  add column if not exists duration_months integer,
  add column if not exists access_starts_at timestamptz,
  add column if not exists access_expires_at timestamptz,
  add column if not exists catalog_module_count integer,
  add column if not exists pricing_version text,
  add column if not exists purchase_snapshot jsonb not null default '{}'::jsonb;

alter table public.payment_orders
  drop constraint if exists payment_orders_pricing_type_check,
  drop constraint if exists payment_orders_launch_price_context_check,
  drop constraint if exists payment_orders_purchase_type_check,
  drop constraint if exists payment_orders_purchase_context_check,
  drop constraint if exists payment_orders_pricing_plan_context_check,
  drop constraint if exists payment_orders_duration_months_check,
  drop constraint if exists payment_orders_catalog_module_count_check;

alter table public.payment_orders
  add constraint payment_orders_pricing_type_check
    check (pricing_type in ('regular', 'launch_offer', 'bundle_offer', 'pricing_plan')),
  add constraint payment_orders_launch_price_context_check
    check (
      (pricing_type in ('regular', 'bundle_offer', 'pricing_plan') and launch_offer_ends_at is null)
      or (pricing_type = 'launch_offer' and launch_offer_ends_at is not null)
    ),
  add constraint payment_orders_purchase_type_check
    check (purchase_type in ('single_module', 'bundle_offer', 'pricing_plan')),
  add constraint payment_orders_duration_months_check
    check (duration_months is null or duration_months in (1, 3, 6)),
  add constraint payment_orders_catalog_module_count_check
    check (catalog_module_count is null or catalog_module_count > 0),
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
        and duration_months in (1, 3, 6)
        and purchase_snapshot <> '{}'::jsonb)
    );

create index if not exists payment_orders_purchase_plan_idx
  on public.payment_orders (purchase_plan_id)
  where purchase_plan_id is not null;

create index if not exists payment_orders_plan_duration_idx
  on public.payment_orders (plan_code, duration_months, created_at desc)
  where purchase_type = 'pricing_plan';
