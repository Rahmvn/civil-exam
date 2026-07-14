-- Profile details are optional account metadata. They must not gate practice.
do $$
declare
  function_signature regprocedure := to_regprocedure(
    'public.resolve_practice_batch_context_payload(uuid,text,integer,boolean)'
  );
  current_definition text;
  updated_definition text;
begin
  if function_signature is null then
    raise exception 'resolve_practice_batch_context_payload was not found';
  end if;

  select pg_get_functiondef(function_signature)
  into current_definition;

  updated_definition := replace(
    current_definition,
    E'  v_onboarding_service_level text;\n',
    ''
  );

  updated_definition := replace(
    updated_definition,
    E'  select p.service_level\n  into v_onboarding_service_level\n  from public.profiles as p\n  where p.id = v_user_id;\n\n  if v_onboarding_service_level is null then\n    raise exception ''Complete your profile setup before starting practice'';\n  end if;\n\n',
    ''
  );

  if updated_definition = current_definition then
    raise exception 'The profile completion gate could not be located safely';
  end if;

  execute updated_definition;
end;
$$;

drop trigger if exists profiles_protect_identity on public.profiles;
drop function if exists public.protect_profile_identity();
