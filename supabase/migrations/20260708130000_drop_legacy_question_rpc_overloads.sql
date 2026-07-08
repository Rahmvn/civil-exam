-- Remove legacy overloaded RPCs so the shared question-pool functions resolve cleanly.

drop function if exists public.get_practice_questions(uuid, text, integer);
drop function if exists public.submit_attempt(public.attempt_mode, uuid, text, jsonb);
