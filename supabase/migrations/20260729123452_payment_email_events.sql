create table public.transactional_email_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  recipient_email text not null,
  user_id uuid references public.profiles(id) on delete set null,
  payment_order_id uuid references public.payment_orders(id) on delete set null,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'pending',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactional_email_events_event_type_present check (btrim(event_type) <> ''),
  constraint transactional_email_events_recipient_email_present check (btrim(recipient_email) <> ''),
  constraint transactional_email_events_status_check check (status in ('pending', 'sent', 'failed', 'skipped'))
);

create index transactional_email_events_payment_created
on public.transactional_email_events (payment_order_id, created_at desc);

create index transactional_email_events_user_created
on public.transactional_email_events (user_id, created_at desc);

alter table public.transactional_email_events enable row level security;

revoke all on table public.transactional_email_events from public, anon, authenticated;
grant select, insert, update on table public.transactional_email_events to service_role;
