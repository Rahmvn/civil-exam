-- Federal Public Service Promotion Exam — practice app base schema.
--
-- Exam-agnostic: an `exam_pack` is one sellable exam season. The app is not
-- hardcoded to any single exam slug — server functions operate on the currently
-- active pack (is_active = true). When multiple exams run at once (v2), the
-- client will pass a specific pack id.
--
-- Questions are tagged by subject, difficulty, and an optional free-text
-- `grade_band` (e.g. 'GL 07-10', or NULL for General Paper items every
-- candidate sits). No rigid level enum, so new exams/structures need no schema
-- change.
--
-- The answer key (correct_option, explanation) is never returned by
-- get_practice_questions; it is only revealed by submit_attempt, and only for
-- questions the user actually answered.

create extension if not exists pgcrypto;

create type public.user_role as enum ('candidate', 'admin');
create type public.question_status as enum ('draft', 'review', 'published');
create type public.difficulty_level as enum ('easy', 'medium', 'hard');
create type public.payment_status as enum ('pending', 'active', 'failed', 'expired');
create type public.attempt_mode as enum ('practice', 'timed_mock');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'candidate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exam_packs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  price_kobo integer not null,
  currency text not null default 'NGN',
  trial_question_limit integer not null default 20,
  active_from date not null default current_date,
  active_until date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  -- Optional grade-level tag, e.g. 'GL 07-10'. NULL = General Paper (all candidates).
  grade_band text,
  difficulty public.difficulty_level not null default 'medium',
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),
  explanation text not null default '',
  source_note text not null default '',
  status public.question_status not null default 'draft',
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_questions_need_explanations check (
    status <> 'published' or length(trim(explanation)) > 0
  )
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id) on delete cascade,
  paystack_reference text unique,
  status public.payment_status not null default 'pending',
  amount_kobo integer not null,
  currency text not null default 'NGN',
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index entitlements_one_active_pack_per_user
on public.entitlements (user_id, exam_pack_id)
where status = 'active';

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_pack_id uuid not null references public.exam_packs(id),
  mode public.attempt_mode not null default 'practice',
  subject_id uuid references public.subjects(id),
  grade_band text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  score integer not null default 0,
  total_questions integer not null default 0
);

create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_option text not null check (selected_option in ('A', 'B', 'C', 'D')),
  is_correct boolean not null,
  time_spent_seconds integer not null default 0,
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger questions_touch_updated_at
before update on public.questions
for each row execute function public.touch_updated_at();

create trigger entitlements_touch_updated_at
before update on public.entitlements
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.has_active_entitlement(pack_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements
    where user_id = auth.uid()
      and exam_pack_id = pack_id
      and status = 'active'
      and expires_at > now()
  );
$$;

-- The currently active exam pack. Exam-agnostic: no hardcoded slug.
create or replace function public.get_active_pack()
returns public.exam_packs
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;
$$;

create or replace function public.get_candidate_summary()
returns table (
  pack_id uuid,
  pack_name text,
  price_kobo integer,
  currency text,
  trial_question_limit integer,
  trial_questions_used bigint,
  has_paid_access boolean,
  access_expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with pack as (
    select * from public.exam_packs
    where is_active = true
    order by active_from desc, created_at desc
    limit 1
  ),
  usage as (
    select count(distinct aa.question_id) as used
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    join pack on pack.id = q.exam_pack_id
    where aa.user_id = auth.uid()
  ),
  active_entitlement as (
    select expires_at
    from public.entitlements
    join pack on pack.id = entitlements.exam_pack_id
    where user_id = auth.uid()
      and status = 'active'
      and expires_at > now()
    order by expires_at desc
    limit 1
  )
  select
    pack.id,
    pack.name,
    pack.price_kobo,
    pack.currency,
    pack.trial_question_limit,
    coalesce(usage.used, 0),
    exists (select 1 from active_entitlement),
    (select expires_at from active_entitlement)
  from pack
  left join usage on true;
$$;

create or replace function public.get_practice_questions(
  requested_subject_id uuid default null,
  requested_grade_band text default null,
  requested_limit integer default 20
)
returns table (
  id uuid,
  subject_id uuid,
  subject_name text,
  grade_band text,
  difficulty public.difficulty_level,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  correct_option text,
  explanation text,
  source_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pack_record public.exam_packs;
  used_count integer;
  allowed_count integer;
  paid_access boolean;
begin
  select * into pack_record
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if pack_record.id is null then
    return;
  end if;

  paid_access := public.has_active_entitlement(pack_record.id);

  select count(distinct aa.question_id) into used_count
  from public.attempt_answers aa
  join public.questions q on q.id = aa.question_id
  where aa.user_id = auth.uid()
    and q.exam_pack_id = pack_record.id;

  if paid_access then
    allowed_count := greatest(1, least(requested_limit, 50));
  else
    allowed_count := greatest(0, least(requested_limit, pack_record.trial_question_limit - coalesce(used_count, 0)));
  end if;

  return query
  select
    q.id,
    q.subject_id,
    s.name,
    q.grade_band,
    q.difficulty,
    q.question_text,
    q.option_a,
    q.option_b,
    q.option_c,
    q.option_d,
    -- Answer key withheld until the attempt is submitted (see submit_attempt).
    null::text as correct_option,
    null::text as explanation,
    q.source_note
  from public.questions q
  join public.subjects s on s.id = q.subject_id
  where q.exam_pack_id = pack_record.id
    and q.status = 'published'
    and (requested_subject_id is null or q.subject_id = requested_subject_id)
    -- General Paper items (grade_band NULL) always appear; grade-tagged items
    -- appear when their band matches, or when no band is requested.
    and (requested_grade_band is null or q.grade_band is null or q.grade_band = requested_grade_band)
  order by random()
  limit allowed_count;
end;
$$;

create or replace function public.submit_attempt(
  submitted_mode public.attempt_mode,
  submitted_subject_id uuid,
  submitted_grade_band text,
  submitted_answers jsonb
)
returns table (
  attempt_id uuid,
  score integer,
  total_questions integer,
  review jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pack_record public.exam_packs;
  new_attempt_id uuid;
  answer_record jsonb;
  answer_question_id uuid;
  answer_option text;
  answer_time_spent integer;
  question_row public.questions;
  computed_score integer := 0;
  computed_total integer := 0;
  paid_access boolean;
  used_count integer;
  new_question_count integer;
  review_items jsonb := '[]'::jsonb;
begin
  select * into pack_record
  from public.exam_packs
  where is_active = true
  order by active_from desc, created_at desc
  limit 1;

  if pack_record.id is null then
    raise exception 'No active exam pack found';
  end if;

  paid_access := public.has_active_entitlement(pack_record.id);

  if not paid_access then
    select count(distinct aa.question_id) into used_count
    from public.attempt_answers aa
    join public.questions q on q.id = aa.question_id
    where aa.user_id = auth.uid()
      and q.exam_pack_id = pack_record.id;

    select count(distinct (answer_item->>'question_id')::uuid) into new_question_count
    from jsonb_array_elements(submitted_answers) answer_item
    where not exists (
      select 1
      from public.attempt_answers aa
      where aa.user_id = auth.uid()
        and aa.question_id = (answer_item->>'question_id')::uuid
    );

    if coalesce(used_count, 0) + coalesce(new_question_count, 0) > pack_record.trial_question_limit then
      raise exception 'Free trial limit reached';
    end if;
  end if;

  insert into public.attempts (user_id, exam_pack_id, mode, subject_id, grade_band)
  values (auth.uid(), pack_record.id, submitted_mode, submitted_subject_id, submitted_grade_band)
  returning id into new_attempt_id;

  for answer_record in select * from jsonb_array_elements(submitted_answers)
  loop
    answer_question_id := (answer_record->>'question_id')::uuid;
    answer_option := answer_record->>'selected_option';
    answer_time_spent := coalesce((answer_record->>'time_spent_seconds')::integer, 0);

    select * into question_row
    from public.questions
    where id = answer_question_id
      and exam_pack_id = pack_record.id
      and status = 'published';

    if question_row.id is null then
      continue;
    end if;

    computed_total := computed_total + 1;

    if answer_option = question_row.correct_option then
      computed_score := computed_score + 1;
    end if;

    insert into public.attempt_answers (
      attempt_id,
      user_id,
      question_id,
      selected_option,
      is_correct,
      time_spent_seconds
    )
    values (
      new_attempt_id,
      auth.uid(),
      answer_question_id,
      answer_option,
      answer_option = question_row.correct_option,
      answer_time_spent
    );

    -- Reveal the answer key only for questions that were actually answered.
    review_items := review_items || jsonb_build_object(
      'question_id', question_row.id,
      'selected_option', answer_option,
      'correct_option', question_row.correct_option,
      'is_correct', answer_option = question_row.correct_option,
      'explanation', question_row.explanation
    );
  end loop;

  update public.attempts
  set completed_at = now(),
      score = computed_score,
      total_questions = computed_total
  where id = new_attempt_id;

  return query select new_attempt_id, computed_score, computed_total, review_items;
end;
$$;

create or replace function public.get_admin_question_counts()
returns table (
  draft_count bigint,
  review_count bigint,
  published_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where status = 'draft') as draft_count,
    count(*) filter (where status = 'review') as review_count,
    count(*) filter (where status = 'published') as published_count
  from public.questions
  where public.is_admin();
$$;

create or replace function public.log_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(),
      tg_op,
      tg_table_name,
      coalesce(new.id, old.id),
      jsonb_build_object('status', coalesce(new.status::text, old.status::text))
    );
  end if;

  return coalesce(new, old);
end;
$$;

create trigger questions_admin_audit
after insert or update or delete on public.questions
for each row execute function public.log_admin_action();

alter table public.profiles enable row level security;
alter table public.exam_packs enable row level security;
alter table public.subjects enable row level security;
alter table public.questions enable row level security;
alter table public.entitlements enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.admin_audit_logs enable row level security;

create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

create policy "admins_manage_profiles"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "exam_packs_read_active"
on public.exam_packs for select
to authenticated
using (is_active or public.is_admin());

create policy "admins_manage_exam_packs"
on public.exam_packs for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "subjects_read_active"
on public.subjects for select
to authenticated
using (is_active or public.is_admin());

create policy "admins_manage_subjects"
on public.subjects for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Candidates never read the questions table directly (answer key lives there);
-- they receive questions only through get_practice_questions (security definer).
create policy "questions_read_admin_only"
on public.questions for select
to authenticated
using (public.is_admin());

create policy "admins_manage_questions"
on public.questions for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "entitlements_select_own_or_admin"
on public.entitlements for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "admins_manage_entitlements"
on public.entitlements for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "attempts_select_own_or_admin"
on public.attempts for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "attempts_insert_own"
on public.attempts for insert
to authenticated
with check (user_id = auth.uid());

create policy "attempt_answers_select_own_or_admin"
on public.attempt_answers for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "attempt_answers_insert_own"
on public.attempt_answers for insert
to authenticated
with check (user_id = auth.uid());

create policy "admin_audit_logs_admin_only"
on public.admin_audit_logs for select
to authenticated
using (public.is_admin());

-- Seed: the active exam pack for the 2026 season. Slug is generic so other
-- exams/years can be added later without collision.
insert into public.exam_packs (
  slug,
  name,
  description,
  price_kobo,
  trial_question_limit,
  active_from,
  active_until
)
values (
  'fps-promo-2026',
  'Federal Public Service Promotion Exam 2026',
  'Timed practice, explanations, and revision tracking for the Federal Public Service Promotion Exam (General Paper).',
  250000,
  20,
  '2026-06-20',
  '2026-12-31'
)
on conflict (slug) do nothing;

-- Seed: General Paper subjects every candidate sits (cadre-specific papers are v2).
insert into public.subjects (name, description, sort_order)
values
  ('English Language', 'Comprehension, vocabulary, grammar and usage.', 10),
  ('Mathematics', 'Numeracy, percentages, rates and workplace arithmetic.', 20),
  ('General Knowledge', 'Nigeria, government, institutions and civic knowledge.', 30),
  ('Current Affairs', 'Recent national and public-service developments.', 40),
  ('Public Service Rules', 'Rules, ethics, discipline, confirmation, promotion and conduct.', 50)
on conflict (name) do nothing;

-- Seed: PLACEHOLDER questions for testing ONLY. These are NOT real exam
-- questions. The real question bank is inserted later via the admin panel.
-- Each is marked in source_note and prefixed 'PLACEHOLDER:' so they are
-- obvious in the UI and easy to remove before launch.
insert into public.questions (
  exam_pack_id,
  subject_id,
  grade_band,
  difficulty,
  question_text,
  option_a,
  option_b,
  option_c,
  option_d,
  correct_option,
  explanation,
  source_note,
  status
)
select
  pack.id,
  subject.id,
  null,
  seed.difficulty::public.difficulty_level,
  seed.question_text,
  seed.option_a,
  seed.option_b,
  seed.option_c,
  seed.option_d,
  seed.correct_option,
  seed.explanation,
  'PLACEHOLDER — sample for testing only; not a real exam question. Replace via admin before launch.',
  'published'::public.question_status
from public.exam_packs pack
cross join lateral (
  values
    ('English Language', 'easy', 'PLACEHOLDER: Choose the correctly spelled word.', 'Recieve', 'Receive', 'Receeve', 'Receve', 'B', 'Placeholder item. "Receive" follows the usual "i before e except after c" guideline.'),
    ('English Language', 'easy', 'PLACEHOLDER: Choose the word nearest in meaning to "diligent".', 'Careless', 'Hardworking', 'Doubtful', 'Ordinary', 'B', 'Placeholder item. "Diligent" means careful, steady and hardworking.'),
    ('Mathematics', 'easy', 'PLACEHOLDER: What is 15% of 200?', '20', '25', '30', '35', 'C', 'Placeholder item. 15% of 200 = 0.15 x 200 = 30.'),
    ('Mathematics', 'medium', 'PLACEHOLDER: A registry processes 40 files per day. How many files in 5 days?', '180', '200', '220', '240', 'B', 'Placeholder item. 40 files/day x 5 days = 200 files.'),
    ('General Knowledge', 'easy', 'PLACEHOLDER: How many states make up Nigeria?', '34', '35', '36', '37', 'C', 'Placeholder item. Nigeria has 36 states plus the FCT.'),
    ('Current Affairs', 'easy', 'PLACEHOLDER: The capital city of Nigeria is:', 'Lagos', 'Abuja', 'Kano', 'Ibadan', 'B', 'Placeholder item. Abuja is the capital of Nigeria.'),
    ('Public Service Rules', 'medium', 'PLACEHOLDER: While performing official duties, a civil servant is expected to remain politically:', 'Partisan', 'Neutral', 'Active', 'Vocal', 'B', 'Placeholder item. Civil servants are expected to serve the government of the day with political neutrality.')
) as seed(subject_name, difficulty, question_text, option_a, option_b, option_c, option_d, correct_option, explanation)
join public.subjects subject on subject.name = seed.subject_name
where pack.slug = 'fps-promo-2026'
  and not exists (
    select 1 from public.questions q
    where q.exam_pack_id = pack.id
      and q.question_text = seed.question_text
  );
