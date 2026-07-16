-- Only one live checkout may be prepared for a candidate, edition, and module.
-- Failed, abandoned, and completed orders are outside this guard, so a later
-- genuine purchase can still create a fresh provider reference.
create unique index if not exists payment_orders_one_live_checkout
on public.payment_orders (user_id, exam_pack_id, subject_id)
where status = 'pending'
  and provider_status in ('initializing', 'initialized');
