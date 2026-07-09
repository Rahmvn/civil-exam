-- Data hygiene cleanup for legacy development content.
-- Adds the archived question status value and normalizes subject activation
-- without touching the current shared batch seed content.

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'question_status'
      and e.enumlabel = 'archived'
  ) then
    alter type public.question_status add value 'archived';
  end if;
end $$;

update public.subjects
set is_active = false
where slug in (
  'english-language',
  'general-knowledge',
  'mathematics'
);

update public.subjects
set is_active = true
where slug in (
  'public-financial-management',
  'public-service-rules',
  'current-affairs'
);
