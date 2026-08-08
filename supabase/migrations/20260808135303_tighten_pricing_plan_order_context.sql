alter table public.payment_orders
  drop constraint if exists payment_orders_purchase_context_check;

alter table public.payment_orders
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
