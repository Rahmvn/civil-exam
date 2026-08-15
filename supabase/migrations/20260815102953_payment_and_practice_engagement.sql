-- Payment confirmation repair and restrained practice-progress engagement.
-- Existing E1/E2/E3 delivery, consent, suppression, and lifecycle contracts remain authoritative.

alter table public.email_runtime_config
  add column payment_email_repair_activated_at timestamptz not null default now(),
  add column practice_progress_min_interval_hours integer not null default 72
    check (practice_progress_min_interval_hours between 24 and 720),
  add column practice_progress_rolling_7d_cap integer not null default 2
    check (practice_progress_rolling_7d_cap between 1 and 7),
  add column practice_progress_improvement_points integer not null default 10
    check (practice_progress_improvement_points between 5 and 25);

alter table public.email_lifecycle_automations
  drop constraint email_lifecycle_automations_key_check,
  add constraint email_lifecycle_automations_key_check check (
    automation_key in (
      'getting_started', 'never_practised', 'practised_unpaid',
      'incomplete_checkout', 'access_expiring', 'practice_progress'
    )
  );

insert into public.admin_email_templates (
  template_key, name, category, subject, preheader, body_text, cta_label, cta_url
)
values (
  'practice_progress', 'Practice progress', 'engagement',
  'Your PromotionSure practice progress',
  'A meaningful practice milestone is ready to review.',
  E'Hi {{first_name}},\n\n{{achievement_summary}}\n\nOpen PromotionSure to review your latest result and continue when you are ready.\n\nPromotionSure Team',
  'Review your progress', 'https://promotionsure.com.ng/dashboard'
)
on conflict (template_key) do nothing;

insert into public.email_lifecycle_automations (
  automation_key, name, purpose, timing_mode, delay_minutes,
  min_delay_minutes, max_delay_minutes, template_id, sort_order
)
select
  'practice_progress', 'Practice progress',
  'Recognise meaningful practice milestones without emailing after every completed set.',
  'after_trigger', 30, 10, 180, template.id, 60
from public.admin_email_templates template
where template.template_key = 'practice_progress'
on conflict (automation_key) do nothing;

create table public.email_practice_milestones (
  id uuid primary key default gen_random_uuid(),
  milestone_key text not null unique,
  coalesce_key uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  source_type text not null check (source_type in ('objective_attempt', 'oral_attempt')),
  source_attempt_id uuid not null,
  milestone_type text not null check (milestone_type in (
    'first_practice', 'first_module_pass', 'personal_best',
    'module_halfway', 'module_complete', 'first_oral_completion'
  )),
  trigger_at timestamptz not null,
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  state text not null default 'pending' check (state in (
    'pending', 'coalesced', 'queued', 'sent', 'skipped', 'cancelled', 'error'
  )),
  reason text,
  lifecycle_instance_id uuid references public.email_lifecycle_instances(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > trigger_at),
  check (btrim(milestone_key) <> '' and char_length(milestone_key) <= 240)
);

create trigger email_practice_milestones_touch_updated_at
before update on public.email_practice_milestones
for each row execute function public.touch_updated_at();

create index email_practice_milestones_pending
on public.email_practice_milestones (trigger_at, user_id)
where state = 'pending' and lifecycle_instance_id is null;

create index email_practice_milestones_instance
on public.email_practice_milestones (lifecycle_instance_id, created_at)
where lifecycle_instance_id is not null;

alter table public.email_practice_milestones enable row level security;
revoke all on table public.email_practice_milestones from public, anon, authenticated;
grant select, insert, update on table public.email_practice_milestones to service_role;

create or replace function private.e4_practice_coalesce_key(
  requested_user_id uuid,
  requested_trigger_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  result uuid;
  window_minutes integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(requested_user_id::text, 0));
  select automation.delay_minutes into window_minutes
  from public.email_lifecycle_automations automation
  where automation.automation_key = 'practice_progress';

  select milestone.coalesce_key into result
  from public.email_practice_milestones milestone
  where milestone.user_id = requested_user_id
    and milestone.lifecycle_instance_id is null
    and milestone.state = 'pending'
    and requested_trigger_at >= milestone.trigger_at
    and requested_trigger_at <= milestone.trigger_at + make_interval(mins => coalesce(window_minutes, 30))
  order by milestone.trigger_at, milestone.id
  limit 1;

  return coalesce(result, gen_random_uuid());
end;
$$;

create or replace function private.e4_capture_objective_milestones()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  group_key uuid;
  prior_best integer;
  improvement_points integer;
  current_set_count integer;
  completed_set_count integer;
  catalogue_key text;
  module_name text;
  progress_type text;
  progress_percent integer;
begin
  if new.completed_at is null
     or (tg_op = 'UPDATE' and old.completed_at is not null) then
    return new;
  end if;

  group_key := private.e4_practice_coalesce_key(new.user_id, new.completed_at);
  select subject.name into module_name from public.subjects subject where subject.id = new.subject_id;
  select config.practice_progress_improvement_points into improvement_points
  from private.e2_email_config() config;

  if not exists (
    select 1 from (
      select attempt.completed_at, attempt.id from public.attempts attempt
      where attempt.user_id = new.user_id and attempt.completed_at is not null and attempt.id <> new.id
      union all
      select oral.completed_at, oral.id from public.oral_attempts oral
      where oral.user_id = new.user_id and oral.status = 'completed' and oral.completed_at is not null
    ) prior
    where (prior.completed_at, prior.id) < (new.completed_at, new.id)
  ) then
    insert into public.email_practice_milestones (
      milestone_key, coalesce_key, user_id, exam_pack_id, subject_id,
      source_type, source_attempt_id, milestone_type, trigger_at, expires_at, metadata
    ) values (
      'practice:first:' || new.user_id::text, group_key, new.user_id, new.exam_pack_id, new.subject_id,
      'objective_attempt', new.id, 'first_practice', new.completed_at, new.completed_at + interval '7 days',
      jsonb_build_object('module_name', module_name)
    ) on conflict (milestone_key) do nothing;
  end if;

  if new.passed is true and not exists (
    select 1 from public.attempts attempt
    where attempt.user_id = new.user_id and attempt.subject_id = new.subject_id
      and attempt.completed_at is not null and attempt.passed is true and attempt.id <> new.id
      and (attempt.completed_at, attempt.id) < (new.completed_at, new.id)
  ) then
    insert into public.email_practice_milestones (
      milestone_key, coalesce_key, user_id, exam_pack_id, subject_id,
      source_type, source_attempt_id, milestone_type, trigger_at, expires_at, metadata
    ) values (
      'practice:first-pass:' || new.user_id::text || ':' || new.subject_id::text,
      group_key, new.user_id, new.exam_pack_id, new.subject_id, 'objective_attempt', new.id,
      'first_module_pass', new.completed_at, new.completed_at + interval '7 days',
      jsonb_build_object('module_name', module_name, 'score_percent', new.score_percent)
    ) on conflict (milestone_key) do nothing;
  end if;

  select max(attempt.score_percent) into prior_best
  from public.attempts attempt
  where attempt.user_id = new.user_id and attempt.subject_id = new.subject_id
    and attempt.completed_at is not null and attempt.id <> new.id
    and (attempt.completed_at, attempt.id) < (new.completed_at, new.id);

  if new.passed is true and new.score_percent is not null and prior_best is not null
     and new.score_percent >= prior_best + improvement_points then
    insert into public.email_practice_milestones (
      milestone_key, coalesce_key, user_id, exam_pack_id, subject_id,
      source_type, source_attempt_id, milestone_type, trigger_at, expires_at, metadata
    ) values (
      'practice:best:' || new.user_id::text || ':' || new.subject_id::text || ':' || ((new.score_percent / 10) * 10)::text,
      group_key, new.user_id, new.exam_pack_id, new.subject_id, 'objective_attempt', new.id,
      'personal_best', new.completed_at, new.completed_at + interval '7 days',
      jsonb_build_object('module_name', module_name, 'score_percent', new.score_percent, 'previous_best_percent', prior_best)
    ) on conflict (milestone_key) do nothing;
  end if;

  select count(*)::integer,
    md5(coalesce(string_agg(current_set.logical_set_key::text, ',' order by current_set.logical_set_key::text), ''))
  into current_set_count, catalogue_key
  from public.practice_sets current_set
  where current_set.exam_pack_id = new.exam_pack_id
    and current_set.subject_id = new.subject_id
    and current_set.practice_type = 'objective'
    and current_set.status = 'published';

  if current_set_count > 0 then
    select count(distinct current_set.logical_set_key)::integer into completed_set_count
    from public.practice_sets current_set
    where current_set.exam_pack_id = new.exam_pack_id
      and current_set.subject_id = new.subject_id
      and current_set.practice_type = 'objective'
      and current_set.status = 'published'
      and exists (
        select 1
        from public.attempts attempt
        join public.practice_sets attempted_set on attempted_set.id = attempt.practice_set_id
        where attempt.user_id = new.user_id
          and attempt.completed_at is not null
          and attempted_set.logical_set_key = current_set.logical_set_key
      );

    if completed_set_count >= current_set_count then
      progress_type := 'module_complete'; progress_percent := 100;
    elsif completed_set_count * 2 >= current_set_count then
      progress_type := 'module_halfway'; progress_percent := 50;
    end if;

    if progress_type is not null then
      insert into public.email_practice_milestones (
        milestone_key, coalesce_key, user_id, exam_pack_id, subject_id,
        source_type, source_attempt_id, milestone_type, trigger_at, expires_at, metadata
      ) values (
        'practice:progress:' || new.user_id::text || ':' || new.subject_id::text || ':' || progress_percent::text || ':' || catalogue_key,
        group_key, new.user_id, new.exam_pack_id, new.subject_id, 'objective_attempt', new.id,
        progress_type, new.completed_at,
        new.completed_at + case when progress_percent = 100 then interval '14 days' else interval '7 days' end,
        jsonb_build_object(
          'module_name', module_name, 'progress_percent', progress_percent,
          'completed_set_count', completed_set_count, 'current_set_count', current_set_count,
          'catalogue_key', catalogue_key
        )
      ) on conflict (milestone_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.e4_capture_oral_milestones()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare group_key uuid; module_name text;
begin
  if new.status <> 'completed' or new.completed_at is null
     or (tg_op = 'UPDATE' and old.status = 'completed') then
    return new;
  end if;
  group_key := private.e4_practice_coalesce_key(new.user_id, new.completed_at);
  select subject.name into module_name from public.subjects subject where subject.id = new.subject_id;

  if not exists (
    select 1 from (
      select attempt.completed_at, attempt.id from public.attempts attempt
      where attempt.user_id = new.user_id and attempt.completed_at is not null
      union all
      select oral.completed_at, oral.id from public.oral_attempts oral
      where oral.user_id = new.user_id and oral.status = 'completed' and oral.id <> new.id
    ) prior where (prior.completed_at, prior.id) < (new.completed_at, new.id)
  ) then
    insert into public.email_practice_milestones (
      milestone_key, coalesce_key, user_id, exam_pack_id, subject_id,
      source_type, source_attempt_id, milestone_type, trigger_at, expires_at, metadata
    ) values (
      'practice:first:' || new.user_id::text, group_key, new.user_id, new.exam_pack_id, new.subject_id,
      'oral_attempt', new.id, 'first_practice', new.completed_at, new.completed_at + interval '7 days',
      jsonb_build_object('module_name', module_name)
    ) on conflict (milestone_key) do nothing;
  end if;

  if not exists (
    select 1 from public.oral_attempts oral
    where oral.user_id = new.user_id and oral.subject_id = new.subject_id
      and oral.status = 'completed' and oral.id <> new.id
      and (oral.completed_at, oral.id) < (new.completed_at, new.id)
  ) then
    insert into public.email_practice_milestones (
      milestone_key, coalesce_key, user_id, exam_pack_id, subject_id,
      source_type, source_attempt_id, milestone_type, trigger_at, expires_at, metadata
    ) values (
      'practice:first-oral:' || new.user_id::text || ':' || new.subject_id::text,
      group_key, new.user_id, new.exam_pack_id, new.subject_id, 'oral_attempt', new.id,
      'first_oral_completion', new.completed_at, new.completed_at + interval '7 days',
      jsonb_build_object('module_name', module_name)
    ) on conflict (milestone_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger attempts_capture_practice_milestones
after insert or update of completed_at on public.attempts
for each row execute function private.e4_capture_objective_milestones();

create trigger oral_attempts_capture_practice_milestones
after insert or update of status, completed_at on public.oral_attempts
for each row execute function private.e4_capture_oral_milestones();

alter function private.e3_trigger_candidates(text, timestamptz, integer, integer)
rename to e3_trigger_candidates_base;

create function private.e3_trigger_candidates(
  requested_automation_key text,
  requested_activated_at timestamptz,
  requested_delay_minutes integer,
  requested_limit integer
)
returns table (
  user_id uuid, source_type text, source_key text, source_id uuid,
  trigger_at timestamptz, due_at timestamptz, metadata jsonb
)
language plpgsql
stable
security definer
set search_path = public, auth, private, pg_temp
as $$
declare safe_limit integer := greatest(1, least(coalesce(requested_limit, 100), 500));
begin
  if requested_automation_key <> 'practice_progress' then
    return query select * from private.e3_trigger_candidates_base(
      requested_automation_key, requested_activated_at, requested_delay_minutes, requested_limit
    );
    return;
  end if;

  return query
  with grouped as (
    select milestone.user_id, milestone.coalesce_key,
      min(milestone.trigger_at) as first_trigger_at,
      (array_agg(milestone.id order by
        case milestone.milestone_type
          when 'module_complete' then 1 when 'first_module_pass' then 2
          when 'personal_best' then 3 when 'module_halfway' then 4 else 5 end,
        milestone.trigger_at, milestone.id
      ))[1] as lead_id,
      jsonb_agg(jsonb_build_object(
        'id', milestone.id, 'type', milestone.milestone_type,
        'module_name', subject.name, 'metadata', milestone.metadata
      ) order by
        case milestone.milestone_type
          when 'module_complete' then 1 when 'first_module_pass' then 2
          when 'personal_best' then 3 when 'module_halfway' then 4 else 5 end,
        milestone.trigger_at, milestone.id
      ) as facts
    from public.email_practice_milestones milestone
    join public.subjects subject on subject.id = milestone.subject_id
    join public.profiles profile on profile.id = milestone.user_id and profile.role = 'candidate'
    join auth.users auth_user on auth_user.id = milestone.user_id and auth_user.email_confirmed_at is not null
    where milestone.state = 'pending' and milestone.lifecycle_instance_id is null
      and milestone.trigger_at >= requested_activated_at
    group by milestone.user_id, milestone.coalesce_key
    order by min(milestone.trigger_at), milestone.user_id
    limit safe_limit
  ), lead as (
    select grouped.*, milestone.subject_id, milestone.milestone_type,
      subject.name as module_name, milestone.metadata as lead_metadata
    from grouped
    join public.email_practice_milestones milestone on milestone.id = grouped.lead_id
    join public.subjects subject on subject.id = milestone.subject_id
  )
  select lead.user_id, 'practice_milestone_group'::text, lead.coalesce_key::text,
    lead.lead_id, lead.first_trigger_at,
    lead.first_trigger_at + make_interval(mins => requested_delay_minutes),
    jsonb_build_object(
      'coalesce_key', lead.coalesce_key, 'milestone_facts', lead.facts,
      'milestone_count', jsonb_array_length(lead.facts),
      'lead_milestone_type', lead.milestone_type,
      'subject_id', lead.subject_id, 'module_name', lead.module_name,
      'score_percent', lead.lead_metadata->'score_percent',
      'progress_percent', lead.lead_metadata->'progress_percent',
      'achievement_summary', case lead.milestone_type
        when 'module_complete' then 'You completed all currently available practice sets in ' || lead.module_name || '.'
        when 'first_module_pass' then 'You passed a ' || lead.module_name || ' practice set.'
        when 'personal_best' then 'You reached a new personal best in ' || lead.module_name || ': ' || (lead.lead_metadata->>'score_percent') || '%.'
        when 'module_halfway' then 'You completed at least half of the currently available practice sets in ' || lead.module_name || '.'
        when 'first_oral_completion' then 'You completed your first oral practice set in ' || lead.module_name || '.'
        else 'You completed your first PromotionSure practice set.'
      end
    )
  from lead;
end;
$$;

create or replace function private.e4_attach_practice_milestones()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.automation_key = 'practice_progress' then
    update public.email_practice_milestones
    set lifecycle_instance_id = new.id, state = 'coalesced', reason = null
    where coalesce_key = (new.metadata->>'coalesce_key')::uuid
      and lifecycle_instance_id is null and state = 'pending';
  end if;
  return new;
end;
$$;

create trigger email_lifecycle_instances_attach_practice_milestones
after insert on public.email_lifecycle_instances
for each row execute function private.e4_attach_practice_milestones();

alter function private.e3_validate_lifecycle_instance(uuid)
rename to e3_validate_lifecycle_instance_base;

create function private.e3_validate_lifecycle_instance(requested_instance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, private, pg_temp
as $$
declare
  instance public.email_lifecycle_instances;
  base_result jsonb;
  practice_interval integer;
  practice_cap integer;
  last_practice_at timestamptz;
  accepted_count integer;
  next_eligible timestamptz;
begin
  select * into instance from public.email_lifecycle_instances where id = requested_instance_id;
  base_result := private.e3_validate_lifecycle_instance_base(requested_instance_id);
  if not found or instance.automation_key not in ('practice_progress', 'practised_unpaid') then
    return base_result;
  end if;
  if not coalesce((base_result->>'allowed')::boolean, false)
     and base_result->>'reason' <> 'recently_contacted' then
    return base_result;
  end if;

  select config.practice_progress_min_interval_hours,
    config.practice_progress_rolling_7d_cap
  into practice_interval, practice_cap
  from private.e2_email_config() config;

  select max(event.accepted_at) into last_practice_at
  from public.transactional_email_events event
  join public.email_lifecycle_instances prior on prior.id = event.lifecycle_instance_id
  where event.user_id = instance.user_id
    and event.dispatch_status = 'accepted'
    and prior.automation_key = 'practice_progress'
    and prior.id <> instance.id;

  if last_practice_at is not null
     and last_practice_at > now() - make_interval(hours => practice_interval) then
    next_eligible := last_practice_at + make_interval(hours => practice_interval);
    return jsonb_build_object('allowed', false, 'reason', 'recent_practice_progress',
      'disposition', 'defer', 'next_eligible_at', next_eligible);
  end if;

  if instance.automation_key = 'practice_progress' then
    if not exists (
      select 1 from public.email_practice_milestones milestone
      where milestone.lifecycle_instance_id = instance.id
        and milestone.state in ('coalesced', 'queued') and milestone.expires_at > now()
    ) then
      return jsonb_build_object('allowed', false, 'reason', 'practice_milestones_stale', 'disposition', 'skip');
    end if;

    select count(*)::integer into accepted_count
    from public.transactional_email_events event
    join public.email_lifecycle_instances prior on prior.id = event.lifecycle_instance_id
    where event.user_id = instance.user_id and event.dispatch_status = 'accepted'
      and event.accepted_at > now() - interval '7 days'
      and prior.automation_key = 'practice_progress' and prior.id <> instance.id;
    if accepted_count >= practice_cap then
      select min(event.accepted_at) + interval '7 days' into next_eligible
      from public.transactional_email_events event
      join public.email_lifecycle_instances prior on prior.id = event.lifecycle_instance_id
      where event.user_id = instance.user_id and event.dispatch_status = 'accepted'
        and event.accepted_at > now() - interval '7 days'
        and prior.automation_key = 'practice_progress' and prior.id <> instance.id;
      return jsonb_build_object('allowed', false, 'reason', 'practice_progress_weekly_cap',
        'disposition', 'defer', 'next_eligible_at', next_eligible);
    end if;
  end if;

  if not coalesce((base_result->>'allowed')::boolean, false) then
    return base_result;
  end if;
  return base_result;
end;
$$;

create or replace function private.e4_enrich_practice_progress_event()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.event_type = 'lifecycle_practice_progress' then
    new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
      'module_name', new.metadata->>'module_name',
      'score_percent', new.metadata->>'score_percent',
      'progress_percent', new.metadata->>'progress_percent',
      'achievement_summary', new.metadata->>'achievement_summary'
    );
  end if;
  return new;
end;
$$;

create trigger transactional_email_events_enrich_practice_progress
before insert on public.transactional_email_events
for each row execute function private.e4_enrich_practice_progress_event();

create or replace function private.e4_sync_practice_milestones()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.lifecycle_instance_id is null then return new; end if;
  if new.dispatch_status = 'accepted' then
    update public.email_practice_milestones set state = 'sent', reason = null
    where lifecycle_instance_id = new.lifecycle_instance_id;
  elsif new.dispatch_status = 'dead' then
    update public.email_practice_milestones set state = 'error', reason = coalesce(new.last_error_code, 'dispatch_failed')
    where lifecycle_instance_id = new.lifecycle_instance_id;
  elsif new.dispatch_status = 'cancelled' then
    update public.email_practice_milestones
    set state = case when new.delivery_status = 'suppressed' then 'skipped' else 'cancelled' end,
      reason = coalesce(new.last_error_code, 'dispatch_cancelled')
    where lifecycle_instance_id = new.lifecycle_instance_id;
  elsif new.dispatch_status in ('pending', 'retrying', 'processing') then
    update public.email_practice_milestones set state = 'queued'
    where lifecycle_instance_id = new.lifecycle_instance_id and state = 'coalesced';
  end if;
  return new;
end;
$$;

create trigger transactional_email_events_sync_practice_milestones
after insert or update of dispatch_status on public.transactional_email_events
for each row when (new.lifecycle_instance_id is not null)
execute function private.e4_sync_practice_milestones();

create or replace function public.repair_missing_payment_success_email_events(
  requested_batch_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_batch integer := greatest(1, least(coalesce(requested_batch_size, 20), 50));
  target record;
  presentation jsonb;
  result jsonb;
  discovered integer := 0;
  created integer := 0;
  duplicates integer := 0;
  errors integer := 0;
  cutoff timestamptz;
  last_error text;
begin
  select config.payment_email_repair_activated_at into cutoff from private.e2_email_config() config;
  for target in
    select orders.id, orders.user_id, orders.provider_reference
    from public.payment_orders orders
    where orders.fulfillment_status = 'fulfilled'
      and orders.created_at >= cutoff
      and not exists (
        select 1 from public.transactional_email_events event
        where (event.event_type = 'payment_success' and event.payment_order_id = orders.id)
          or event.event_key = 'payment_success:' || orders.provider_reference
      )
    order by coalesce(orders.paid_at, orders.updated_at, orders.created_at), orders.id
    limit safe_batch
  loop
    discovered := discovered + 1;
    begin
      presentation := public.build_payment_order_presentation(target.id)
        || jsonb_build_object('payment_order_id', target.id, 'user_id', target.user_id);
      result := public.enqueue_transactional_email_event(
        'payment_success:' || target.provider_reference,
        'payment_success', target.user_id, target.id, presentation, 10::smallint
      );
      if coalesce((result->>'created')::boolean, false) then created := created + 1;
      else duplicates := duplicates + 1; end if;
    exception when others then
      errors := errors + 1;
      last_error := left(sqlerrm, 240);
    end;
  end loop;
  return jsonb_build_object(
    'discovered', discovered, 'created', created, 'duplicates', duplicates,
    'errors', errors, 'last_error', last_error
  );
end;
$$;

-- Enrich the existing Admin projection with bounded practice-progress controls.
create or replace function public.get_admin_email_automations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.sort_order), '[]'::jsonb))
  into result
  from (
    select automation.automation_key, automation.name, automation.purpose,
      automation.enabled, automation.activated_at, automation.timing_mode,
      automation.delay_minutes, automation.min_delay_minutes, automation.max_delay_minutes,
      automation.template_id, template.name as template_name, template.template_key,
      automation.sort_order, automation.last_evaluated_at, automation.last_run_started_at,
      automation.last_run_completed_at, automation.last_run_discovered,
      automation.last_run_queued, automation.last_run_skipped,
      automation.last_error, automation.last_error_at,
      case when automation.automation_key = 'practice_progress' then config.practice_progress_min_interval_hours end as practice_min_interval_hours,
      case when automation.automation_key = 'practice_progress' then config.practice_progress_rolling_7d_cap end as practice_rolling_7d_cap,
      case when automation.automation_key = 'practice_progress' then config.practice_progress_improvement_points end as practice_improvement_points,
      count(instance.id) filter (where instance.state = 'sent')::integer as sent_count,
      count(instance.id) filter (where instance.state in ('skipped', 'cancelled'))::integer as skipped_cancelled_count,
      count(instance.id) filter (where instance.state = 'scheduled')::integer as scheduled_count,
      count(instance.id) filter (where instance.state = 'error')::integer as error_count
    from public.email_lifecycle_automations automation
    join public.admin_email_templates template on template.id = automation.template_id
    cross join public.email_runtime_config config
    left join public.email_lifecycle_instances instance on instance.automation_key = automation.automation_key
    group by automation.automation_key, template.id, config.singleton
  ) row_data;
  return result;
end;
$$;

drop function public.admin_update_email_automation(text, boolean, integer, uuid);
create function public.admin_update_email_automation(
  requested_automation_key text,
  requested_enabled boolean,
  requested_delay_minutes integer,
  requested_template_id uuid,
  requested_practice_min_interval_hours integer default null,
  requested_practice_rolling_7d_cap integer default null,
  requested_practice_improvement_points integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor uuid := auth.uid(); current_row public.email_lifecycle_automations; saved public.email_lifecycle_automations; template public.admin_email_templates;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select * into current_row from public.email_lifecycle_automations where automation_key = requested_automation_key for update;
  if not found then raise exception 'Automation not found'; end if;
  if requested_delay_minutes not between current_row.min_delay_minutes and current_row.max_delay_minutes then raise exception 'Choose a timing within the allowed range'; end if;
  select * into template from public.admin_email_templates where id = requested_template_id and active and category = 'engagement';
  if not found then raise exception 'Choose an active engagement template'; end if;

  if requested_automation_key = 'practice_progress' then
    update public.email_runtime_config set
      practice_progress_min_interval_hours = coalesce(requested_practice_min_interval_hours, practice_progress_min_interval_hours),
      practice_progress_rolling_7d_cap = coalesce(requested_practice_rolling_7d_cap, practice_progress_rolling_7d_cap),
      practice_progress_improvement_points = coalesce(requested_practice_improvement_points, practice_progress_improvement_points),
      updated_at = now()
    where singleton;
  end if;

  update public.email_lifecycle_automations
  set enabled = coalesce(requested_enabled, false),
      activated_at = case
        when coalesce(requested_enabled, false) and not current_row.enabled then now()
        when coalesce(requested_enabled, false) then current_row.activated_at
        else null
      end,
      delay_minutes = requested_delay_minutes, template_id = requested_template_id, last_error = null
  where automation_key = requested_automation_key returning * into saved;

  if current_row.enabled and not saved.enabled then
    update public.transactional_email_events event
    set dispatch_status = 'cancelled', status = 'skipped', last_error_code = 'automation_disabled',
      error_message = 'Lifecycle automation disabled before dispatch', next_attempt_at = null, updated_at = now()
    from public.email_lifecycle_instances instance
    where instance.automation_key = saved.automation_key and event.lifecycle_instance_id = instance.id
      and event.dispatch_status in ('pending', 'retrying');
    update public.email_lifecycle_instances set state = 'cancelled', eligibility_result = 'ineligible',
      reason = 'automation_disabled', completed_at = now()
    where automation_key = saved.automation_key and state in ('scheduled', 'queued');
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'email_automation_updated', 'email_lifecycle_automation', null,
    jsonb_build_object('automation_key', saved.automation_key, 'enabled', saved.enabled,
      'delay_minutes', saved.delay_minutes, 'template_id', saved.template_id));
  return (public.get_admin_email_automations()->'items') -> (
    select ordinality::integer - 1
    from jsonb_array_elements(public.get_admin_email_automations()->'items') with ordinality item(value, ordinality)
    where item.value->>'automation_key' = saved.automation_key limit 1
  );
end;
$$;

revoke all on function private.e4_practice_coalesce_key(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.e4_capture_objective_milestones() from public, anon, authenticated;
revoke all on function private.e4_capture_oral_milestones() from public, anon, authenticated;
revoke all on function private.e3_trigger_candidates_base(text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function private.e3_trigger_candidates(text, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function private.e4_attach_practice_milestones() from public, anon, authenticated;
revoke all on function private.e3_validate_lifecycle_instance_base(uuid) from public, anon, authenticated;
revoke all on function private.e3_validate_lifecycle_instance(uuid) from public, anon, authenticated;
revoke all on function private.e4_enrich_practice_progress_event() from public, anon, authenticated;
revoke all on function private.e4_sync_practice_milestones() from public, anon, authenticated;
revoke all on function public.repair_missing_payment_success_email_events(integer) from public, anon, authenticated;
revoke all on function public.get_admin_email_automations() from public, anon, authenticated, service_role;
revoke all on function public.admin_update_email_automation(text, boolean, integer, uuid, integer, integer, integer)
from public, anon, authenticated, service_role;

grant execute on function public.repair_missing_payment_success_email_events(integer) to service_role;
grant execute on function public.get_admin_email_automations() to authenticated;
grant execute on function public.admin_update_email_automation(text, boolean, integer, uuid, integer, integer, integer)
to authenticated;
