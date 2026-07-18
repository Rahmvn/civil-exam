-- Enum values must be committed before a later migration can safely use them.
alter type public.practice_set_status add value if not exists 'withdrawn' after 'published';
