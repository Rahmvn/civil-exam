-- Auth metadata is user-controlled. Keep profile names bounded even when a
-- signup bypasses the browser's input attributes.
alter table public.profiles
  drop constraint if exists profiles_full_name_safe;

alter table public.profiles
  add constraint profiles_full_name_safe check (
    full_name is null
    or (
      char_length(full_name) <= 120
      and full_name !~ '[[:cntrl:]]'
    )
  ) not valid;
