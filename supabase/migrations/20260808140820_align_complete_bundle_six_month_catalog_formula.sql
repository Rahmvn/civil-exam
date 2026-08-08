do $$
declare
  v_function_definition text;
begin
  select pg_get_functiondef('public.get_purchase_pricing_catalog_v1()'::regprocedure)
  into v_function_definition;

  if v_function_definition is null then
    raise exception 'get_purchase_pricing_catalog_v1() is not installed';
  end if;

  v_function_definition := replace(
    v_function_definition,
    '* 0.74)::integer',
    '* 0.735)::integer'
  );

  execute v_function_definition;

  if position('* 0.735)::integer' in pg_get_functiondef('public.get_purchase_pricing_catalog_v1()'::regprocedure)) = 0 then
    raise exception 'Complete Bundle six-month pricing formula was not aligned';
  end if;
end;
$$;
