-- Admin writes for these relations are intentionally exposed through
-- security-definer RPCs or service-role Edge Functions, not direct table DML.
-- Their existing SELECT policies already include admins where admin reads are
-- required. Removing the overlapping FOR ALL policies avoids evaluating two
-- permissive policies for every admin SELECT without changing browser access.

drop policy if exists admins_manage_entitlements on public.entitlements;
drop policy if exists admins_manage_exam_packs on public.exam_packs;
drop policy if exists admins_manage_module_entitlements on public.module_entitlements;
drop policy if exists admins_manage_module_offerings on public.module_offerings;
drop policy if exists admins_manage_payment_orders on public.payment_orders;
drop policy if exists admins_manage_questions on public.questions;
drop policy if exists admins_manage_subjects on public.subjects;
