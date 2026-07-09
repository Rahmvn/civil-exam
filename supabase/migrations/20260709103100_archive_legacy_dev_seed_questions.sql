-- Archive legacy grade-level development seed questions after the archived enum
-- value exists in committed schema history.

update public.questions
set status = 'archived'::public.question_status
where source_note in ('dev_seed_gl07', 'dev_seed_gl08')
  and status = 'published'::public.question_status;
