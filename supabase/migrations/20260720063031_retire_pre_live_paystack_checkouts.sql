-- Checkout URLs and references are scoped to the Paystack account that created
-- them. Close unfinished orders before switching PromotionSure to its live
-- account so an old authorization URL can never be resumed by the application.
update public.payment_orders
set status = 'failed',
    provider_status = 'abandoned',
    provider_message = 'Checkout retired during Paystack account transition',
    provider_payload = '{}'::jsonb,
    provider_checked_at = now(),
    fulfillment_status = 'failed',
    fulfillment_error = 'Checkout retired before payment',
    updated_at = now()
where provider = 'paystack'
  and status = 'pending'
  and provider_status in ('initializing', 'initialized');
