alter table public.support_requests
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;

create index if not exists support_requests_subject_created_idx
  on public.support_requests (subject_id, created_at desc)
  where subject_id is not null;

create index if not exists objective_sessions_user_status_started_idx
  on public.objective_practice_sessions (user_id, status, started_at desc);

create or replace function public.create_support_request_v2(
  requested_category text,
  requested_subject text,
  requested_description text,
  requested_payment_reference text default null,
  requested_page_path text default null,
  requested_subject_id uuid default null
)
returns public.support_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.support_requests;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  if requested_category not in ('account', 'access', 'payment', 'practice', 'content', 'technical') then
    raise exception 'Choose a valid help category';
  end if;
  if char_length(btrim(coalesce(requested_subject, ''))) not between 5 and 120 then
    raise exception 'Describe the issue in 5 to 120 characters';
  end if;
  if char_length(btrim(coalesce(requested_description, ''))) not between 20 and 2000 then
    raise exception 'Add between 20 and 2000 characters of detail';
  end if;
  if requested_payment_reference is not null and char_length(btrim(requested_payment_reference)) > 120 then
    raise exception 'Payment reference is too long';
  end if;
  if requested_page_path is not null and char_length(requested_page_path) > 300 then
    raise exception 'Page path is too long';
  end if;
  if requested_subject_id is not null and not exists (
    select 1 from public.subjects where id = requested_subject_id and is_active = true
  ) then
    raise exception 'Choose a valid module';
  end if;
  if requested_category in ('access', 'practice', 'content') and requested_subject_id is null then
    raise exception 'Choose the affected module';
  end if;
  if (select count(*) from public.support_requests where user_id = v_user_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You have sent several requests recently. Please wait before sending another';
  end if;

  insert into public.support_requests (
    user_id, category, subject, description, payment_reference, page_path, subject_id
  ) values (
    v_user_id,
    requested_category,
    btrim(requested_subject),
    btrim(requested_description),
    nullif(btrim(coalesce(requested_payment_reference, '')), ''),
    nullif(btrim(coalesce(requested_page_path, '')), ''),
    requested_subject_id
  ) returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.create_support_request_v2(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_request_v2(text, text, text, text, text, uuid) to authenticated;

create or replace function public.get_admin_support_queue(
  requested_status text default 'open',
  requested_query text default null,
  requested_limit integer default 25,
  requested_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(requested_status, 'open')));
  v_query text := nullif(btrim(coalesce(requested_query, '')), '');
  v_limit integer := greatest(10, least(coalesce(requested_limit, 25), 50));
  v_offset integer := greatest(0, coalesce(requested_offset, 0));
  v_total integer;
  v_items jsonb;
  v_counts jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  if v_status not in ('all', 'open', 'received', 'in_review', 'resolved', 'closed') then
    raise exception 'Choose a valid support status';
  end if;
  if char_length(coalesce(v_query, '')) > 120 then raise exception 'Support search is too long'; end if;

  select jsonb_build_object(
    'open', count(*) filter (where sr.status in ('received', 'in_review')),
    'received', count(*) filter (where sr.status = 'received'),
    'in_review', count(*) filter (where sr.status = 'in_review'),
    'resolved', count(*) filter (where sr.status = 'resolved'),
    'closed', count(*) filter (where sr.status = 'closed'),
    'all', count(*)
  ) into v_counts from public.support_requests sr;

  select count(*)::integer into v_total
  from public.support_requests sr
  left join public.profiles p on p.id = sr.user_id
  left join public.subjects s on s.id = sr.subject_id
  where (v_status = 'all' or (v_status = 'open' and sr.status in ('received', 'in_review')) or sr.status = v_status)
    and (v_query is null or concat_ws(' ', sr.subject, sr.description, p.full_name, p.email, sr.payment_reference, s.name)
      ilike '%' || v_query || '%');

  select coalesce(jsonb_agg(to_jsonb(queue_row)), '[]'::jsonb) into v_items
  from (
    select sr.id, sr.user_id, p.full_name as requester_name, p.email as requester_email,
      sr.category, sr.subject, sr.description, sr.payment_reference, sr.page_path,
      sr.subject_id, s.name as subject_name, s.slug as subject_slug,
      sr.status, sr.resolution_note, sr.created_at, sr.updated_at
    from public.support_requests sr
    left join public.profiles p on p.id = sr.user_id
    left join public.subjects s on s.id = sr.subject_id
    where (v_status = 'all' or (v_status = 'open' and sr.status in ('received', 'in_review')) or sr.status = v_status)
      and (v_query is null or concat_ws(' ', sr.subject, sr.description, p.full_name, p.email, sr.payment_reference, s.name)
        ilike '%' || v_query || '%')
    order by case sr.status when 'received' then 1 when 'in_review' then 2 when 'resolved' then 3 else 4 end,
      case when sr.status in ('received', 'in_review') then sr.created_at end asc,
      case when sr.status in ('resolved', 'closed') then sr.updated_at end desc, sr.id
    limit v_limit offset v_offset
  ) queue_row;

  return jsonb_build_object('items', v_items, 'total', v_total, 'counts', v_counts,
    'limit', v_limit, 'offset', v_offset, 'has_more', v_offset + jsonb_array_length(v_items) < v_total);
end;
$$;

revoke all on function public.get_admin_support_queue(text, text, integer, integer) from public, anon;
grant execute on function public.get_admin_support_queue(text, text, integer, integer) to authenticated;

create or replace function public.get_admin_support_diagnostics(requested_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r public.support_requests%rowtype;
  s public.subjects%rowtype;
  po public.payment_orders%rowtype;
  v_published_sets integer := 0;
  v_active_sessions integer := 0;
  v_recent_errors integer := 0;
  v_has_access boolean := false;
  v_checks jsonb := '[]'::jsonb;
  v_state text := 'needs_information';
  v_summary text := 'The system needs more information before it can identify the problem.';
  v_next text := 'Ask the candidate for the missing information, then refresh this check.';
  v_action jsonb := null;
  v_blocks_resolution boolean := false;
begin
  if not public.is_admin() then raise exception 'Admin access is required'; end if;
  select * into r from public.support_requests where id = requested_request_id;
  if not found then raise exception 'Support request not found'; end if;

  select count(*) into v_recent_errors from public.app_error_events
  where user_id = r.user_id and created_at >= greatest(r.created_at - interval '30 minutes', now() - interval '7 days');

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'key', 'recent_errors', 'label', 'Recent app errors',
    'status', case when v_recent_errors > 0 then 'warning' else 'good' end,
    'value', case when v_recent_errors > 0 then v_recent_errors || ' detected' else 'None detected' end
  ));

  if r.subject_id is not null then
    select * into s from public.subjects where id = r.subject_id;
    select count(*) into v_published_sets from public.practice_sets ps
      where ps.subject_id = r.subject_id and ps.status::text = 'published';
    select count(*) into v_active_sessions from (
      select id from public.objective_practice_sessions
        where user_id = r.user_id and subject_id = r.subject_id and status = 'active'
      union all
      select id from public.oral_attempts
        where user_id = r.user_id and subject_id = r.subject_id and status::text = 'active'
    ) active_attempts;
    select
      exists (
        select 1 from public.module_entitlements me
        join public.exam_packs ep on ep.id = me.exam_pack_id and ep.is_active = true
        where me.user_id = r.user_id and me.subject_id = r.subject_id
          and me.status::text = 'active' and me.expires_at > now()
      )
      or exists (
        select 1 from public.entitlements e
        join public.exam_packs ep on ep.id = e.exam_pack_id and ep.is_active = true
        where e.user_id = r.user_id and e.status::text = 'active' and e.expires_at > now()
      )
      or exists (
        select 1 from public.user_module_progress ump
        join public.exam_packs ep on ep.id = ump.exam_pack_id and ep.is_active = true
        where ump.user_id = r.user_id and ump.subject_id = r.subject_id
          and ump.selected_for_free_access = true
      )
    into v_has_access;

    v_checks := v_checks || jsonb_build_array(
      jsonb_build_object('key', 'module', 'label', 'Affected module', 'status', 'info', 'value', s.name),
      jsonb_build_object('key', 'availability', 'label', 'Module availability',
        'status', case when s.is_active and s.lifecycle_status::text = 'active' and s.candidate_availability::text = 'available' then 'good' else 'warning' end,
        'value', case when s.is_active and s.lifecycle_status::text = 'active' and s.candidate_availability::text = 'available' then 'Available' else 'Not available to candidates' end),
      jsonb_build_object('key', 'content', 'label', 'Published practice sets',
        'status', case when v_published_sets > 0 then 'good' else 'warning' end, 'value', v_published_sets::text)
    );
  end if;

  if r.payment_reference is not null then
    select * into po from public.payment_orders
      where provider_reference = r.payment_reference and user_id = r.user_id;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'key', 'payment', 'label', 'Payment record',
      'status', case when po.id is null then 'warning' when po.provider_status = 'success' then 'good' else 'warning' end,
      'value', case when po.id is null then 'Reference not found for this candidate'
                    when po.provider_status = 'success' then 'Confirmed by saved provider status'
                    else initcap(coalesce(po.provider_status, po.status::text, 'Pending')) end
    ));
  end if;

  if r.category = 'payment' then
    if r.payment_reference is null then
      v_summary := 'A payment reference is needed to check this safely.';
      v_next := 'Email the candidate and ask for the PromotionSure reference shown on the receipt.';
    elsif po.id is null then
      v_state := 'escalate';
      v_summary := 'This reference is not linked to a payment by this candidate.';
      v_next := 'Confirm the reference and the email address used for payment. Do not grant access manually.';
    elsif po.review_status <> 'clear' then
      v_state := 'escalate';
      v_summary := 'This payment is under a provider review and should not be changed here.';
      v_next := 'Open Payment attention and follow the provider review status.';
    elsif po.provider_status = 'success' and not exists (
      select 1 from public.module_entitlements me where me.payment_order_id = po.id
        and me.status::text = 'active' and me.expires_at > now()
    ) then
      v_state := 'attention';
      v_blocks_resolution := true;
      v_summary := 'Payment appears successful, but usable module access is missing.';
      v_next := 'Recheck the payment with Paystack and restore access only if every detail matches.';
      v_action := jsonb_build_object('type', 'reconcile_payment', 'label', 'Recheck payment and restore access',
        'description', 'The system will verify Paystack, ownership, amount, currency, and module before changing access.');
    elsif po.provider_status = 'success' then
      v_state := 'ok';
      v_summary := 'Payment and module access are aligned.';
      v_next := 'Ask the candidate to sign out and back in. Resolve the request after they confirm access.';
    else
      v_state := 'attention';
      v_summary := 'The saved payment is not confirmed as successful.';
      v_next := 'Ask the candidate to check the transaction status with their bank. Do not grant access manually.';
    end if;
  elsif r.category in ('access', 'practice', 'content') and r.subject_id is null then
    v_summary := 'The affected module was not included in this older request.';
    v_next := 'Email the candidate and ask which module is affected.';
  elsif r.category = 'access' then
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'access', 'label', 'Current module access',
      'status', case when v_has_access then 'good' else 'warning' end,
      'value', case when v_has_access then 'Active' else 'No active access' end));
    if v_has_access and v_published_sets > 0 then
      v_state := 'ok'; v_summary := 'The candidate currently has working access and published practice content.';
      v_next := 'Ask them to sign out and back in, then confirm the module appears.';
    else
      v_state := 'attention'; v_summary := 'The candidate does not currently have usable access to this module.';
      v_next := case when v_published_sets = 0 then 'Open module settings and publish a ready practice set.' else 'Ask for the payment reference so the payment can be checked safely.' end;
      if v_published_sets = 0 then v_action := jsonb_build_object('type', 'open_module', 'label', 'Open module settings', 'subject_id', r.subject_id); end if;
    end if;
  elsif r.category = 'practice' then
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'session', 'label', 'Active practice session',
      'status', case when v_active_sessions > 0 then 'info' else 'good' end,
      'value', case when v_active_sessions > 0 then 'Found' else 'None' end));
    if v_published_sets = 0 then
      v_state := 'attention'; v_summary := 'This module has no published practice set.';
      v_next := 'Open module settings and publish a ready practice set.';
      v_action := jsonb_build_object('type', 'open_module', 'label', 'Open module settings', 'subject_id', r.subject_id);
    elsif v_recent_errors > 0 then
      v_state := 'escalate'; v_summary := 'The system detected recent app errors for this candidate.';
      v_next := 'Send this request to technical review. The candidate should not repeatedly restart the attempt.';
    else
      v_state := 'ok'; v_summary := case when v_active_sessions > 0 then 'A resumable practice session is active.' else 'No stuck practice session or recent app error was detected.' end;
      v_next := case when v_active_sessions > 0 then 'Ask the candidate to open the module and choose Resume.' else 'Ask the candidate to start again and confirm the timer begins.' end;
    end if;
  elsif r.category = 'content' then
    v_state := case when v_published_sets > 0 then 'needs_information' else 'attention' end;
    v_summary := case when v_published_sets > 0 then 'Published content exists, but a human must review the reported question.' else 'This module has no published practice set.' end;
    v_next := 'Open module settings and review the exact practice set and question reported by the candidate.';
    v_action := jsonb_build_object('type', 'open_module', 'label', 'Open module settings', 'subject_id', r.subject_id);
  elsif r.category = 'technical' then
    v_state := case when v_recent_errors > 0 then 'escalate' else 'needs_information' end;
    v_summary := case when v_recent_errors > 0 then 'Recent app errors were detected for this candidate.' else 'No recent system error was captured for this candidate.' end;
    v_next := case when v_recent_errors > 0 then 'Send this request to technical review with the page and time shown.' else 'Ask for the exact page, time, device, and what appeared on screen.' end;
  else
    v_state := 'needs_information';
    v_summary := 'This request needs a short account check with the candidate.';
    v_next := 'Confirm the account email and ask what message appears. Never ask for a password or OTP.';
  end if;

  return jsonb_build_object('request_id', r.id, 'category', r.category, 'checked_at', now(),
    'state', v_state, 'summary', v_summary, 'checks', v_checks,
    'recommended_action', v_action, 'candidate_next_step', v_next,
    'blocks_resolution', v_blocks_resolution);
end;
$$;

revoke all on function public.get_admin_support_diagnostics(uuid) from public, anon;
grant execute on function public.get_admin_support_diagnostics(uuid) to authenticated;
