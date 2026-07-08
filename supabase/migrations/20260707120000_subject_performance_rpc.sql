-- Per-subject accuracy for the signed-in candidate, used by the Dashboard
-- progress chart. Purely additive — no existing objects change.
--
-- Candidates cannot select from public.questions directly (RLS is admin-only
-- there), so aggregating attempt_answers by subject requires a security
-- definer function, same pattern as get_candidate_summary/get_practice_questions.

create or replace function public.get_subject_performance()
returns table (
  subject_id uuid,
  subject_name text,
  correct_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    count(*) filter (where aa.is_correct) as correct_count,
    count(*) as total_count
  from public.attempt_answers aa
  join public.questions q on q.id = aa.question_id
  join public.subjects s on s.id = q.subject_id
  where aa.user_id = auth.uid()
  group by s.id, s.name, s.sort_order
  order by s.sort_order;
$$;
