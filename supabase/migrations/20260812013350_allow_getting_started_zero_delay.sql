-- Getting started is evaluated on the next lifecycle cycle. Other lifecycle
-- automations retain their existing positive minimum delays.
alter table public.email_lifecycle_automations
  drop constraint email_lifecycle_automations_delay_bounds;

update public.email_lifecycle_automations
set delay_minutes = 0,
    min_delay_minutes = 0
where automation_key = 'getting_started';

update public.email_lifecycle_instances instance
set due_at = instance.trigger_at,
    updated_at = now()
from public.email_lifecycle_automations automation
where automation.automation_key = 'getting_started'
  and instance.automation_key = automation.automation_key
  and instance.state = 'scheduled'
  and instance.transactional_email_event_id is null
  and automation.activated_at is not null
  and instance.trigger_at >= automation.activated_at;

alter table public.email_lifecycle_automations
  add constraint email_lifecycle_automations_delay_bounds check (
    (
      (automation_key = 'getting_started' and min_delay_minutes >= 0)
      or (automation_key <> 'getting_started' and min_delay_minutes > 0)
    )
    and max_delay_minutes >= min_delay_minutes
    and delay_minutes between min_delay_minutes and max_delay_minutes
  );
