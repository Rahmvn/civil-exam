-- Curated operational user details and consent-aware admin audiences.

create or replace function public.get_admin_user_directory_v2(
  requested_segment text default 'all',
  requested_query text default null,
  requested_limit integer default 50,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  result := public.get_admin_user_directory(requested_segment, requested_query, requested_limit, requested_offset);

  select jsonb_set(result, '{items}', coalesce(jsonb_agg(
    item.value || jsonb_build_object(
      'engagement_subscribed', not coalesce(preference.marketing_opted_out, false),
      'email_suppressed', suppression.reason is not null,
      'email_suppression_reason', suppression.reason,
      'email_delivery_eligible', not coalesce(preference.marketing_opted_out, false)
        and suppression.reason is null
        and auth_user.email_confirmed_at is not null
        and lower(btrim(coalesce(auth_user.email, profile.email, ''))) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        and lower(btrim(coalesce(auth_user.email, profile.email, ''))) !~* '@promotionsure\.com\.ng$',
      'email_delivery_reason', case
        when coalesce(preference.marketing_opted_out, false) then 'opted_out'
        when suppression.reason is not null then suppression.reason
        when auth_user.email_confirmed_at is null then 'unconfirmed_account'
        when lower(btrim(coalesce(auth_user.email, profile.email, ''))) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then 'invalid_recipient'
        when lower(btrim(coalesce(auth_user.email, profile.email, ''))) ~* '@promotionsure\.com\.ng$' then 'internal_account'
        else null end,
      'email_confirmed_at', auth_user.email_confirmed_at,
      'onboarding_completed', profile.onboarding_completed_at is not null
    ) order by item.ordinality
  ), '[]'::jsonb)) into result
  from jsonb_array_elements(coalesce(result->'items', '[]'::jsonb)) with ordinality item(value, ordinality)
  join public.profiles profile on profile.id = (item.value->>'id')::uuid
  left join auth.users auth_user on auth_user.id = profile.id
  left join public.email_preferences preference on preference.user_id = profile.id
  left join lateral (
    select candidate.reason from public.email_suppressions candidate
    where candidate.active and candidate.email = lower(btrim(coalesce(auth_user.email, profile.email)))
    order by candidate.last_seen_at desc limit 1
  ) suppression on true;
  return result;
end;
$$;

create or replace function public.get_admin_user_detail(requested_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if requested_user_id is null then raise exception 'Choose a user'; end if;

  select jsonb_build_object(
    'account', jsonb_build_object(
      'id', profile.id, 'full_name', profile.full_name, 'email', coalesce(auth_user.email, profile.email),
      'phone_number', profile.phone_number, 'state_code', profile.state_code,
      'organization_name', profile.organization_name, 'service_level', profile.service_level,
      'created_at', profile.created_at, 'onboarding_completed_at', profile.onboarding_completed_at,
      'email_confirmed_at', auth_user.email_confirmed_at
    ),
    'practice', jsonb_build_object(
      'objective_attempts', (select count(*) from public.attempts a where a.user_id = profile.id),
      'oral_attempts', (select count(*) from public.oral_attempts a where a.user_id = profile.id),
      'completed_attempts', (select count(*) from public.attempts a where a.user_id = profile.id and a.completed_at is not null)
        + (select count(*) from public.oral_attempts a where a.user_id = profile.id and a.status = 'completed'),
      'last_practice_at', greatest(
        (select max(coalesce(a.completed_at, a.started_at)) from public.attempts a where a.user_id = profile.id),
        (select max(coalesce(a.completed_at, a.updated_at, a.started_at)) from public.oral_attempts a where a.user_id = profile.id)
      ),
      'modules', (select coalesce(jsonb_agg(to_jsonb(module_row) order by module_row.last_practice_at desc), '[]'::jsonb) from (
        select subject.id, subject.name, count(*)::integer attempt_count, max(coalesce(a.completed_at, a.started_at)) last_practice_at
        from public.attempts a join public.subjects subject on subject.id = a.subject_id
        where a.user_id = profile.id group by subject.id, subject.name
        union all
        select subject.id, subject.name, count(*)::integer, max(coalesce(a.completed_at, a.updated_at, a.started_at))
        from public.oral_attempts a join public.subjects subject on subject.id = a.subject_id
        where a.user_id = profile.id group by subject.id, subject.name
      ) module_row)
    ),
    'access', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', entitlement.id, 'module_id', subject.id, 'module_name', subject.name,
      'status', case when entitlement.status = 'active' and entitlement.expires_at > now() then 'active' else 'expired' end,
      'starts_at', entitlement.starts_at, 'expires_at', entitlement.expires_at
    ) order by entitlement.expires_at desc), '[]'::jsonb)
      from public.module_entitlements entitlement join public.subjects subject on subject.id = entitlement.subject_id
      where entitlement.user_id = profile.id),
    'payments', jsonb_build_object(
      'successful_count', (select count(*) from public.payment_orders payment where payment.user_id = profile.id and (payment.status = 'active' or payment.provider_status = 'success')),
      'pending_count', (select count(*) from public.payment_orders payment where payment.user_id = profile.id and payment.status = 'pending'),
      'recent', (select coalesce(jsonb_agg(to_jsonb(payment_row) order by payment_row.created_at desc), '[]'::jsonb) from (
        select payment.id, payment.status, payment.provider_status, payment.amount_kobo, payment.currency,
          payment.paid_at, payment.created_at, subject.name module_name
        from public.payment_orders payment left join public.subjects subject on subject.id = payment.subject_id
        where payment.user_id = profile.id order by payment.created_at desc limit 10
      ) payment_row)
    ),
    'email', jsonb_build_object(
      'engagement_subscribed', not coalesce(preference.marketing_opted_out, false),
      'suppression_reason', suppression.reason,
      'delivery_eligible', not coalesce(preference.marketing_opted_out, false) and suppression.reason is null
        and auth_user.email_confirmed_at is not null
        and lower(btrim(coalesce(auth_user.email, profile.email, ''))) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        and lower(btrim(coalesce(auth_user.email, profile.email, ''))) !~* '@promotionsure\.com\.ng$',
      'delivery_reason', case
        when coalesce(preference.marketing_opted_out, false) then 'opted_out'
        when suppression.reason is not null then suppression.reason
        when auth_user.email_confirmed_at is null then 'unconfirmed_account'
        when lower(btrim(coalesce(auth_user.email, profile.email, ''))) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then 'invalid_recipient'
        when lower(btrim(coalesce(auth_user.email, profile.email, ''))) ~* '@promotionsure\.com\.ng$' then 'internal_account'
        else null end,
      'recent', (select coalesce(jsonb_agg(to_jsonb(email_row) order by email_row.created_at desc), '[]'::jsonb) from (
        select event.id, event.category, event.payload->>'subject' as subject, event.template_key, event.dispatch_status,
          event.delivery_status, event.created_at, event.accepted_at, event.delivered_at
        from public.transactional_email_events event where event.user_id = profile.id
        order by event.created_at desc limit 10
      ) email_row)
    ),
    'support', jsonb_build_object(
      'open_count', (select count(*) from public.support_requests request where request.user_id = profile.id and request.status in ('received', 'in_review')),
      'recent', (select coalesce(jsonb_agg(to_jsonb(support_row) order by support_row.created_at desc), '[]'::jsonb) from (
        select request.id, request.category, request.subject, request.status, request.created_at, request.updated_at
        from public.support_requests request where request.user_id = profile.id
        order by request.created_at desc limit 5
      ) support_row)
    )
  ) into result
  from public.profiles profile
  left join auth.users auth_user on auth_user.id = profile.id
  left join public.email_preferences preference on preference.user_id = profile.id
  left join lateral (
    select candidate.reason from public.email_suppressions candidate
    where candidate.active and candidate.email = lower(btrim(coalesce(auth_user.email, profile.email)))
    order by candidate.last_seen_at desc limit 1
  ) suppression on true
  where profile.id = requested_user_id and profile.role = 'candidate';

  if result is null then raise exception 'User not found'; end if;
  return result;
end;
$$;

-- Engagement subscribers is a consent segment. Deliverability remains a separate
-- classification in e2_audience_rows and is rechecked during queueing/dispatch.
create or replace function private.e2_segment_matches(
  requested_user_id uuid,
  requested_segment_key text,
  requested_params jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  facts record;
  segment_key text := lower(btrim(coalesce(requested_segment_key, '')));
  module_id uuid;
  module_latest_passed boolean;
begin
  select * into facts from private.e2_candidate_facts() where user_id = requested_user_id;
  if not found then return false; end if;
  if segment_key not in (
    'engagement_subscribers', 'all_confirmed', 'paid', 'unpaid', 'active_access', 'expired_access',
    'started_practice', 'never_practised', 'practised_unpaid', 'incomplete_checkout',
    'active_module_access', 'joined_last_7_days', 'joined_last_30_days',
    'latest_objective_passed', 'latest_objective_needs_retry'
  ) then raise exception 'Choose a valid audience segment'; end if;
  if segment_key = 'active_module_access' and nullif(requested_params->>'module_id', '') is null then raise exception 'Choose a valid module'; end if;
  if segment_key in ('active_module_access', 'latest_objective_passed', 'latest_objective_needs_retry')
     and nullif(requested_params->>'module_id', '') is not null then
    begin module_id := (requested_params->>'module_id')::uuid;
    exception when invalid_text_representation then raise exception 'Choose a valid module'; end;
    if not exists (select 1 from public.subjects subject where subject.id = module_id) then raise exception 'Choose a valid module'; end if;
  elsif requested_params <> '{}'::jsonb then raise exception 'Unsupported audience parameters'; end if;
  if segment_key in ('latest_objective_passed', 'latest_objective_needs_retry') and module_id is not null then
    select attempt.passed into module_latest_passed from public.attempts attempt
    where attempt.user_id = requested_user_id and attempt.subject_id = module_id
      and attempt.completed_at is not null and attempt.passed is not null
    order by attempt.completed_at desc, attempt.id desc limit 1;
  end if;
  return case segment_key
    when 'engagement_subscribers' then facts.confirmed and not exists (
      select 1 from public.email_preferences preference where preference.user_id = requested_user_id and preference.marketing_opted_out
    )
    when 'all_confirmed' then facts.confirmed
    when 'paid' then facts.confirmed and facts.has_fulfilled_payment
    when 'unpaid' then facts.confirmed and not facts.has_fulfilled_payment
    when 'active_access' then facts.confirmed and facts.has_active_access
    when 'expired_access' then facts.confirmed and facts.has_expired_access
    when 'started_practice' then facts.confirmed and facts.has_started_practice
    when 'never_practised' then facts.confirmed and not facts.has_started_practice
    when 'practised_unpaid' then facts.confirmed and facts.has_started_practice and not facts.has_fulfilled_payment and not facts.has_active_access
    when 'incomplete_checkout' then facts.confirmed and facts.has_incomplete_checkout
    when 'active_module_access' then facts.confirmed and exists (select 1 from public.module_entitlements entitlement
      where entitlement.user_id = requested_user_id and entitlement.subject_id = module_id
        and entitlement.status = 'active' and entitlement.expires_at > now())
    when 'joined_last_7_days' then facts.confirmed and facts.joined_at >= now() - interval '7 days'
    when 'joined_last_30_days' then facts.confirmed and facts.joined_at >= now() - interval '30 days'
    when 'latest_objective_passed' then facts.confirmed and (case when module_id is null then facts.latest_objective_passed else module_latest_passed end) is true
    when 'latest_objective_needs_retry' then facts.confirmed and (case when module_id is null then facts.latest_objective_passed else module_latest_passed end) is false
    else false end;
end;
$$;

create or replace function public.get_admin_email_audience_catalog()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select jsonb_build_object(
    'segments', jsonb_agg(to_jsonb(segment_row) order by segment_row.sort_order),
    'modules', (select coalesce(jsonb_agg(jsonb_build_object('id', subject.id, 'name', subject.name) order by subject.sort_order, subject.name), '[]'::jsonb) from public.subjects subject where subject.is_active),
    'config', to_jsonb(private.e2_email_config()) - 'singleton' - 'updated_at'
  ) into result from (values
    ('engagement_subscribers'::text, 'Engagement subscribers'::text, 'Users who currently allow engagement email. Technical eligibility is checked separately.'::text, false, 5),
    ('all_confirmed', 'All confirmed users', 'Confirmed candidate accounts.', false, 10),
    ('paid', 'Paid users', 'Users with a currently fulfilled payment order.', false, 20),
    ('unpaid', 'Unpaid users', 'Users without a fulfilled payment order.', false, 30),
    ('active_access', 'Active-access users', 'Users with at least one active, unexpired module entitlement.', false, 40),
    ('expired_access', 'Expired-access users', 'Users with prior entitlement history and no active access.', false, 50),
    ('started_practice', 'Started practising', 'Users with objective or oral practice activity.', false, 60),
    ('never_practised', 'Never practised', 'Users with no objective or oral practice activity.', false, 70),
    ('practised_unpaid', 'Practised but unpaid', 'Users who practised and have neither fulfilled payment nor active access.', false, 80),
    ('incomplete_checkout', 'Incomplete checkout', 'Users with a recent pending purchase whose intended access was not subsequently fulfilled.', false, 90),
    ('active_module_access', 'Active access to module', 'Users with active access to the selected module.', true, 100),
    ('joined_last_7_days', 'Joined in last 7 days', 'Confirmed users who joined in the last 7 days.', false, 110),
    ('joined_last_30_days', 'Joined in last 30 days', 'Confirmed users who joined in the last 30 days.', false, 120),
    ('latest_objective_passed', 'Latest objective practice passed', 'Users whose latest completed objective attempt passed.', false, 130),
    ('latest_objective_needs_retry', 'Latest objective practice needs retry', 'Users whose latest completed objective attempt did not pass.', false, 140)
  ) segment_row(segment_key, name, description, requires_module, sort_order);
  return result;
end; $$;

revoke all on function public.get_admin_user_directory_v2(text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_user_detail(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_user_directory_v2(text, text, integer, integer) to authenticated;
grant execute on function public.get_admin_user_detail(uuid) to authenticated;
