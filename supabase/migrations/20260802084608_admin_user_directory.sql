create or replace function public.get_admin_user_directory(
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
declare
  v_segment text := lower(btrim(coalesce(requested_segment, 'all')));
  v_query text := nullif(btrim(coalesce(requested_query, '')), '');
  v_limit integer := greatest(10, least(coalesce(requested_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(requested_offset, 0));
  v_total integer;
  v_items jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if v_segment not in (
    'all',
    'unpaid',
    'paid',
    'never_practiced',
    'practiced_unpaid',
    'payment_started_unpaid',
    'one_module_unlocked'
  ) then
    raise exception 'Choose a valid user segment';
  end if;

  if char_length(coalesce(v_query, '')) > 120 then
    raise exception 'User search is too long';
  end if;

  with user_rows as (
    select
      p.id,
      p.email,
      p.full_name,
      p.service_level,
      p.onboarding_completed_at,
      p.created_at,
      coalesce(practice.objective_attempt_count, 0) as objective_attempt_count,
      coalesce(practice.objective_completed_count, 0) as objective_completed_count,
      coalesce(oral.oral_attempt_count, 0) as oral_attempt_count,
      coalesce(oral.oral_completed_count, 0) as oral_completed_count,
      coalesce(practice.objective_attempt_count, 0) + coalesce(oral.oral_attempt_count, 0) as total_attempt_count,
      coalesce(practice.objective_completed_count, 0) + coalesce(oral.oral_completed_count, 0) as completed_attempt_count,
      greatest(practice.last_objective_attempt_at, oral.last_oral_attempt_at) as last_practice_at,
      coalesce(access.active_module_count, 0) as active_module_count,
      coalesce(access.active_modules, '[]'::jsonb) as active_modules,
      coalesce(payment.payment_order_count, 0) as payment_order_count,
      coalesce(payment.successful_payment_count, 0) as successful_payment_count,
      coalesce(payment.pending_payment_count, 0) as pending_payment_count,
      payment.last_payment_at,
      payment.last_checkout_at,
      payment.last_provider_status,
      email.last_email_at,
      email.last_email_status,
      email.last_email_type,
      coalesce(modules.attempted_modules, '[]'::jsonb) as attempted_modules,
      greatest(
        p.created_at,
        p.onboarding_completed_at,
        practice.last_objective_attempt_at,
        oral.last_oral_attempt_at,
        payment.last_checkout_at,
        payment.last_payment_at
      ) as last_activity_at
    from public.profiles p
    left join lateral (
      select
        count(*)::integer as objective_attempt_count,
        count(*) filter (where a.completed_at is not null)::integer as objective_completed_count,
        max(coalesce(a.completed_at, a.started_at)) as last_objective_attempt_at
      from public.attempts a
      where a.user_id = p.id
    ) practice on true
    left join lateral (
      select
        count(*)::integer as oral_attempt_count,
        count(*) filter (where oa.status = 'completed')::integer as oral_completed_count,
        max(coalesce(oa.completed_at, oa.updated_at, oa.started_at)) as last_oral_attempt_at
      from public.oral_attempts oa
      where oa.user_id = p.id
    ) oral on true
    left join lateral (
      select
        count(*)::integer as active_module_count,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'subject_id', s.id,
            'subject_name', s.name,
            'subject_slug', s.slug,
            'expires_at', me.expires_at
          )
          order by s.sort_order, s.name
        ), '[]'::jsonb) as active_modules
      from public.module_entitlements me
      join public.subjects s on s.id = me.subject_id
      where me.user_id = p.id
        and me.status = 'active'
        and me.expires_at > now()
    ) access on true
    left join lateral (
      select
        count(*)::integer as payment_order_count,
        count(*) filter (
          where po.status = 'active'
             or po.provider_status = 'success'
        )::integer as successful_payment_count,
        count(*) filter (
          where po.status = 'pending'
            and coalesce(po.provider_status, 'pending') in (
              'initializing',
              'initialized',
              'ongoing',
              'pending',
              'processing',
              'queued'
            )
        )::integer as pending_payment_count,
        max(po.paid_at) as last_payment_at,
        max(po.created_at) as last_checkout_at,
        (array_agg(coalesce(po.provider_status, po.status::text) order by po.created_at desc))[1] as last_provider_status
      from public.payment_orders po
      where po.user_id = p.id
    ) payment on true
    left join lateral (
      select
        max(coalesce(tee.attempted_at, tee.created_at)) as last_email_at,
        (array_agg(tee.status order by coalesce(tee.attempted_at, tee.created_at) desc))[1] as last_email_status,
        (array_agg(tee.event_type order by coalesce(tee.attempted_at, tee.created_at) desc))[1] as last_email_type
      from public.transactional_email_events tee
      where tee.user_id = p.id
    ) email on true
    left join lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'subject_id', module_rows.subject_id,
          'subject_name', module_rows.subject_name,
          'subject_slug', module_rows.subject_slug,
          'attempt_count', module_rows.attempt_count,
          'last_attempt_at', module_rows.last_attempt_at
        )
        order by module_rows.last_attempt_at desc nulls last, module_rows.subject_name
      ), '[]'::jsonb) as attempted_modules
      from (
        select
          s.id as subject_id,
          s.name as subject_name,
          s.slug as subject_slug,
          count(*)::integer as attempt_count,
          max(coalesce(a.completed_at, a.started_at)) as last_attempt_at
        from public.attempts a
        join public.subjects s on s.id = a.subject_id
        where a.user_id = p.id
          and a.subject_id is not null
        group by s.id, s.name, s.slug

        union all

        select
          s.id as subject_id,
          s.name as subject_name,
          s.slug as subject_slug,
          count(*)::integer as attempt_count,
          max(coalesce(oa.completed_at, oa.updated_at, oa.started_at)) as last_attempt_at
        from public.oral_attempts oa
        join public.subjects s on s.id = oa.subject_id
        where oa.user_id = p.id
        group by s.id, s.name, s.slug
      ) module_rows
    ) modules on true
    where p.role = 'candidate'
  ),
  counted as (
    select
      count(*)::integer as all_count,
      count(*) filter (where active_module_count = 0 and successful_payment_count = 0)::integer as unpaid_count,
      count(*) filter (where active_module_count > 0 or successful_payment_count > 0)::integer as paid_count,
      count(*) filter (where total_attempt_count = 0)::integer as never_practiced_count,
      count(*) filter (where total_attempt_count > 0 and active_module_count = 0 and successful_payment_count = 0)::integer as practiced_unpaid_count,
      count(*) filter (where pending_payment_count > 0 and active_module_count = 0 and successful_payment_count = 0)::integer as payment_started_unpaid_count,
      count(*) filter (where active_module_count = 1)::integer as one_module_unlocked_count
    from user_rows
  )
  select jsonb_build_object(
    'all', all_count,
    'unpaid', unpaid_count,
    'paid', paid_count,
    'never_practiced', never_practiced_count,
    'practiced_unpaid', practiced_unpaid_count,
    'payment_started_unpaid', payment_started_unpaid_count,
    'one_module_unlocked', one_module_unlocked_count
  )
  into v_counts
  from counted;

  with user_rows as (
    select
      p.id,
      p.email,
      p.full_name,
      p.service_level,
      p.onboarding_completed_at,
      p.created_at,
      coalesce(practice.objective_attempt_count, 0) as objective_attempt_count,
      coalesce(practice.objective_completed_count, 0) as objective_completed_count,
      coalesce(oral.oral_attempt_count, 0) as oral_attempt_count,
      coalesce(oral.oral_completed_count, 0) as oral_completed_count,
      coalesce(practice.objective_attempt_count, 0) + coalesce(oral.oral_attempt_count, 0) as total_attempt_count,
      coalesce(practice.objective_completed_count, 0) + coalesce(oral.oral_completed_count, 0) as completed_attempt_count,
      greatest(practice.last_objective_attempt_at, oral.last_oral_attempt_at) as last_practice_at,
      coalesce(access.active_module_count, 0) as active_module_count,
      coalesce(access.active_modules, '[]'::jsonb) as active_modules,
      coalesce(payment.payment_order_count, 0) as payment_order_count,
      coalesce(payment.successful_payment_count, 0) as successful_payment_count,
      coalesce(payment.pending_payment_count, 0) as pending_payment_count,
      payment.last_payment_at,
      payment.last_checkout_at,
      payment.last_provider_status,
      email.last_email_at,
      email.last_email_status,
      email.last_email_type,
      coalesce(modules.attempted_modules, '[]'::jsonb) as attempted_modules,
      greatest(
        p.created_at,
        p.onboarding_completed_at,
        practice.last_objective_attempt_at,
        oral.last_oral_attempt_at,
        payment.last_checkout_at,
        payment.last_payment_at
      ) as last_activity_at
    from public.profiles p
    left join lateral (
      select
        count(*)::integer as objective_attempt_count,
        count(*) filter (where a.completed_at is not null)::integer as objective_completed_count,
        max(coalesce(a.completed_at, a.started_at)) as last_objective_attempt_at
      from public.attempts a
      where a.user_id = p.id
    ) practice on true
    left join lateral (
      select
        count(*)::integer as oral_attempt_count,
        count(*) filter (where oa.status = 'completed')::integer as oral_completed_count,
        max(coalesce(oa.completed_at, oa.updated_at, oa.started_at)) as last_oral_attempt_at
      from public.oral_attempts oa
      where oa.user_id = p.id
    ) oral on true
    left join lateral (
      select
        count(*)::integer as active_module_count,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'subject_id', s.id,
            'subject_name', s.name,
            'subject_slug', s.slug,
            'expires_at', me.expires_at
          )
          order by s.sort_order, s.name
        ), '[]'::jsonb) as active_modules
      from public.module_entitlements me
      join public.subjects s on s.id = me.subject_id
      where me.user_id = p.id
        and me.status = 'active'
        and me.expires_at > now()
    ) access on true
    left join lateral (
      select
        count(*)::integer as payment_order_count,
        count(*) filter (
          where po.status = 'active'
             or po.provider_status = 'success'
        )::integer as successful_payment_count,
        count(*) filter (
          where po.status = 'pending'
            and coalesce(po.provider_status, 'pending') in (
              'initializing',
              'initialized',
              'ongoing',
              'pending',
              'processing',
              'queued'
            )
        )::integer as pending_payment_count,
        max(po.paid_at) as last_payment_at,
        max(po.created_at) as last_checkout_at,
        (array_agg(coalesce(po.provider_status, po.status::text) order by po.created_at desc))[1] as last_provider_status
      from public.payment_orders po
      where po.user_id = p.id
    ) payment on true
    left join lateral (
      select
        max(coalesce(tee.attempted_at, tee.created_at)) as last_email_at,
        (array_agg(tee.status order by coalesce(tee.attempted_at, tee.created_at) desc))[1] as last_email_status,
        (array_agg(tee.event_type order by coalesce(tee.attempted_at, tee.created_at) desc))[1] as last_email_type
      from public.transactional_email_events tee
      where tee.user_id = p.id
    ) email on true
    left join lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'subject_id', module_rows.subject_id,
          'subject_name', module_rows.subject_name,
          'subject_slug', module_rows.subject_slug,
          'attempt_count', module_rows.attempt_count,
          'last_attempt_at', module_rows.last_attempt_at
        )
        order by module_rows.last_attempt_at desc nulls last, module_rows.subject_name
      ), '[]'::jsonb) as attempted_modules
      from (
        select
          s.id as subject_id,
          s.name as subject_name,
          s.slug as subject_slug,
          count(*)::integer as attempt_count,
          max(coalesce(a.completed_at, a.started_at)) as last_attempt_at
        from public.attempts a
        join public.subjects s on s.id = a.subject_id
        where a.user_id = p.id
          and a.subject_id is not null
        group by s.id, s.name, s.slug

        union all

        select
          s.id as subject_id,
          s.name as subject_name,
          s.slug as subject_slug,
          count(*)::integer as attempt_count,
          max(coalesce(oa.completed_at, oa.updated_at, oa.started_at)) as last_attempt_at
        from public.oral_attempts oa
        join public.subjects s on s.id = oa.subject_id
        where oa.user_id = p.id
        group by s.id, s.name, s.slug
      ) module_rows
    ) modules on true
    where p.role = 'candidate'
  ),
  filtered as (
    select *
    from user_rows
    where (
      v_segment = 'all'
      or (v_segment = 'unpaid' and active_module_count = 0 and successful_payment_count = 0)
      or (v_segment = 'paid' and (active_module_count > 0 or successful_payment_count > 0))
      or (v_segment = 'never_practiced' and total_attempt_count = 0)
      or (v_segment = 'practiced_unpaid' and total_attempt_count > 0 and active_module_count = 0 and successful_payment_count = 0)
      or (v_segment = 'payment_started_unpaid' and pending_payment_count > 0 and active_module_count = 0 and successful_payment_count = 0)
      or (v_segment = 'one_module_unlocked' and active_module_count = 1)
    )
    and (
      v_query is null
      or concat_ws(
        ' ',
        email,
        full_name,
        service_level,
        last_provider_status,
        last_email_type,
        active_modules::text,
        attempted_modules::text
      ) ilike '%' || v_query || '%'
    )
  )
  select count(*)::integer
  into v_total
  from filtered;

  with user_rows as (
    select
      p.id,
      p.email,
      p.full_name,
      p.service_level,
      p.onboarding_completed_at,
      p.created_at,
      coalesce(practice.objective_attempt_count, 0) as objective_attempt_count,
      coalesce(practice.objective_completed_count, 0) as objective_completed_count,
      coalesce(oral.oral_attempt_count, 0) as oral_attempt_count,
      coalesce(oral.oral_completed_count, 0) as oral_completed_count,
      coalesce(practice.objective_attempt_count, 0) + coalesce(oral.oral_attempt_count, 0) as total_attempt_count,
      coalesce(practice.objective_completed_count, 0) + coalesce(oral.oral_completed_count, 0) as completed_attempt_count,
      greatest(practice.last_objective_attempt_at, oral.last_oral_attempt_at) as last_practice_at,
      coalesce(access.active_module_count, 0) as active_module_count,
      coalesce(access.active_modules, '[]'::jsonb) as active_modules,
      coalesce(payment.payment_order_count, 0) as payment_order_count,
      coalesce(payment.successful_payment_count, 0) as successful_payment_count,
      coalesce(payment.pending_payment_count, 0) as pending_payment_count,
      payment.last_payment_at,
      payment.last_checkout_at,
      payment.last_provider_status,
      email.last_email_at,
      email.last_email_status,
      email.last_email_type,
      coalesce(modules.attempted_modules, '[]'::jsonb) as attempted_modules,
      greatest(
        p.created_at,
        p.onboarding_completed_at,
        practice.last_objective_attempt_at,
        oral.last_oral_attempt_at,
        payment.last_checkout_at,
        payment.last_payment_at
      ) as last_activity_at
    from public.profiles p
    left join lateral (
      select
        count(*)::integer as objective_attempt_count,
        count(*) filter (where a.completed_at is not null)::integer as objective_completed_count,
        max(coalesce(a.completed_at, a.started_at)) as last_objective_attempt_at
      from public.attempts a
      where a.user_id = p.id
    ) practice on true
    left join lateral (
      select
        count(*)::integer as oral_attempt_count,
        count(*) filter (where oa.status = 'completed')::integer as oral_completed_count,
        max(coalesce(oa.completed_at, oa.updated_at, oa.started_at)) as last_oral_attempt_at
      from public.oral_attempts oa
      where oa.user_id = p.id
    ) oral on true
    left join lateral (
      select
        count(*)::integer as active_module_count,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'subject_id', s.id,
            'subject_name', s.name,
            'subject_slug', s.slug,
            'expires_at', me.expires_at
          )
          order by s.sort_order, s.name
        ), '[]'::jsonb) as active_modules
      from public.module_entitlements me
      join public.subjects s on s.id = me.subject_id
      where me.user_id = p.id
        and me.status = 'active'
        and me.expires_at > now()
    ) access on true
    left join lateral (
      select
        count(*)::integer as payment_order_count,
        count(*) filter (
          where po.status = 'active'
             or po.provider_status = 'success'
        )::integer as successful_payment_count,
        count(*) filter (
          where po.status = 'pending'
            and coalesce(po.provider_status, 'pending') in (
              'initializing',
              'initialized',
              'ongoing',
              'pending',
              'processing',
              'queued'
            )
        )::integer as pending_payment_count,
        max(po.paid_at) as last_payment_at,
        max(po.created_at) as last_checkout_at,
        (array_agg(coalesce(po.provider_status, po.status::text) order by po.created_at desc))[1] as last_provider_status
      from public.payment_orders po
      where po.user_id = p.id
    ) payment on true
    left join lateral (
      select
        max(coalesce(tee.attempted_at, tee.created_at)) as last_email_at,
        (array_agg(tee.status order by coalesce(tee.attempted_at, tee.created_at) desc))[1] as last_email_status,
        (array_agg(tee.event_type order by coalesce(tee.attempted_at, tee.created_at) desc))[1] as last_email_type
      from public.transactional_email_events tee
      where tee.user_id = p.id
    ) email on true
    left join lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'subject_id', module_rows.subject_id,
          'subject_name', module_rows.subject_name,
          'subject_slug', module_rows.subject_slug,
          'attempt_count', module_rows.attempt_count,
          'last_attempt_at', module_rows.last_attempt_at
        )
        order by module_rows.last_attempt_at desc nulls last, module_rows.subject_name
      ), '[]'::jsonb) as attempted_modules
      from (
        select
          s.id as subject_id,
          s.name as subject_name,
          s.slug as subject_slug,
          count(*)::integer as attempt_count,
          max(coalesce(a.completed_at, a.started_at)) as last_attempt_at
        from public.attempts a
        join public.subjects s on s.id = a.subject_id
        where a.user_id = p.id
          and a.subject_id is not null
        group by s.id, s.name, s.slug

        union all

        select
          s.id as subject_id,
          s.name as subject_name,
          s.slug as subject_slug,
          count(*)::integer as attempt_count,
          max(coalesce(oa.completed_at, oa.updated_at, oa.started_at)) as last_attempt_at
        from public.oral_attempts oa
        join public.subjects s on s.id = oa.subject_id
        where oa.user_id = p.id
        group by s.id, s.name, s.slug
      ) module_rows
    ) modules on true
    where p.role = 'candidate'
  ),
  filtered as (
    select *
    from user_rows
    where (
      v_segment = 'all'
      or (v_segment = 'unpaid' and active_module_count = 0 and successful_payment_count = 0)
      or (v_segment = 'paid' and (active_module_count > 0 or successful_payment_count > 0))
      or (v_segment = 'never_practiced' and total_attempt_count = 0)
      or (v_segment = 'practiced_unpaid' and total_attempt_count > 0 and active_module_count = 0 and successful_payment_count = 0)
      or (v_segment = 'payment_started_unpaid' and pending_payment_count > 0 and active_module_count = 0 and successful_payment_count = 0)
      or (v_segment = 'one_module_unlocked' and active_module_count = 1)
    )
    and (
      v_query is null
      or concat_ws(
        ' ',
        email,
        full_name,
        service_level,
        last_provider_status,
        last_email_type,
        active_modules::text,
        attempted_modules::text
      ) ilike '%' || v_query || '%'
    )
  )
  select coalesce(jsonb_agg(to_jsonb(user_row)), '[]'::jsonb)
  into v_items
  from (
    select
      id,
      email,
      full_name,
      service_level,
      onboarding_completed_at,
      created_at,
      total_attempt_count,
      completed_attempt_count,
      last_practice_at,
      active_module_count,
      active_modules,
      attempted_modules,
      payment_order_count,
      successful_payment_count,
      pending_payment_count,
      last_payment_at,
      last_checkout_at,
      last_provider_status,
      last_email_at,
      last_email_status,
      last_email_type,
      last_activity_at,
      true as can_email,
      false as email_opted_out
    from filtered
    order by coalesce(last_activity_at, created_at) desc, created_at desc, id
    limit v_limit offset v_offset
  ) user_row;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'counts', v_counts,
    'limit', v_limit,
    'offset', v_offset,
    'has_more', v_offset + jsonb_array_length(v_items) < v_total
  );
end;
$$;

revoke all on function public.get_admin_user_directory(text, text, integer, integer)
from public, anon, authenticated, service_role;

grant execute on function public.get_admin_user_directory(text, text, integer, integer)
to authenticated;
