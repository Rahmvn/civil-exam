-- Repair module payments briefly processed by the legacy pack-wide webhook.
-- A matching payment-order reference proves that the payment belongs to the
-- module-specific flow, so preserve its module entitlement and remove only the
-- accidental legacy entitlement created for the same reference.

do $$
declare
  payment_record record;
begin
  for payment_record in
    select
      po.provider_reference,
      coalesce(e.metadata, '{}'::jsonb) as provider_payload
    from public.payment_orders as po
    join public.entitlements as e
      on e.paystack_reference = po.provider_reference
  loop
    perform *
    from public.activate_module_purchase(
      payment_record.provider_reference,
      payment_record.provider_payload
    );
  end loop;
end;
$$;

delete from public.entitlements as legacy
using public.payment_orders as module_order
where legacy.paystack_reference = module_order.provider_reference;
