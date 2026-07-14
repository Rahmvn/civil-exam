-- Serialize concurrent callback/webhook activation for the same user/module.
do $$
declare
  function_signature regprocedure := to_regprocedure('public.activate_module_purchase(text,jsonb)');
  current_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(function_signature) into current_definition;

  if position('pg_advisory_xact_lock' in current_definition) > 0 then
    return;
  end if;

  updated_definition := replace(
    current_definition,
    E'  v_expires_at := (v_pack.active_until::text || '' 23:59:59.999+00'')::timestamptz;',
    E'  perform pg_advisory_xact_lock(\n    hashtextextended(\n      v_order.user_id::text || '':'' || v_order.exam_pack_id::text || '':'' || v_order.subject_id::text,\n      0\n    )\n  );\n\n  v_expires_at := (v_pack.active_until::text || '' 23:59:59.999+00'')::timestamptz;'
  );

  if updated_definition = current_definition then
    raise exception 'activate_module_purchase could not be updated safely';
  end if;

  execute updated_definition;
end;
$$;
