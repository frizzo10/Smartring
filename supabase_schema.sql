-- ═══════════════════════════════════════════════════════
--  SAGEHEALTH — SUPABASE SCHEMA
--  Run this in Supabase SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════

-- ── 1. USER PROFILES ────────────────────────────────────
create table if not exists public.sage_profiles (
  id          uuid references auth.users on delete cascade primary key,
  email       text,
  name        text,
  age         integer,
  sex         text,
  weight_lbs  numeric,
  conditions  text default 'None',
  medications text default 'None',
  ring_device text default 'Wosheng TK30',
  plan        text default 'pro',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.sage_profiles enable row level security;
create policy "Users own their profile"
  on public.sage_profiles for all using (auth.uid() = id);

-- ── 2. DR. SAGE MEMORY ──────────────────────────────────
-- Persistent memory that survives across all conversations
create table if not exists public.sage_memory (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users on delete cascade,
  category    text not null, -- 'life_context' | 'health_history' | 'preferences' | 'relationship' | 'goals'
  key         text not null, -- e.g. 'job_stress', 'sleep_problem', 'tried_zone2_cardio'
  value       text not null, -- the actual memory
  source      text,          -- 'conversation' | 'onboarding' | 'test_result' | 'commitment'
  confidence  integer default 3, -- 1-5 how certain we are
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(user_id, key)
);
alter table public.sage_memory enable row level security;
create policy "Users own their memory"
  on public.sage_memory for all using (auth.uid() = user_id);

-- ── 3. CONVERSATIONS ────────────────────────────────────
create table if not exists public.sage_conversations (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users on delete cascade,
  signal_id    text,
  signal_title text,
  messages     jsonb not null default '[]',
  commitment   text,
  baseline_metrics jsonb,
  created_at   timestamptz default now()
);
alter table public.sage_conversations enable row level security;
create policy "Users own their conversations"
  on public.sage_conversations for all using (auth.uid() = user_id);

-- ── 4. COMMITMENTS ──────────────────────────────────────
create table if not exists public.sage_commitments (
  id               uuid default gen_random_uuid() primary key,
  user_id          uuid references auth.users on delete cascade,
  signal_id        text,
  signal_title     text,
  commitment       text not null,
  status           text default 'active', -- active | completed | abandoned
  baseline_metrics jsonb,
  check_ins        jsonb default '[]',
  conversation_id  uuid references public.sage_conversations,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.sage_commitments enable row level security;
create policy "Users own their commitments"
  on public.sage_commitments for all using (auth.uid() = user_id);

-- ── 5. DOCUMENTS (lab results, doctor notes, reports) ───
create table if not exists public.sage_documents (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references auth.users on delete cascade,
  type            text not null, -- 'lab_result' | 'doctor_note' | 'doctor_report' | 'ecg' | 'imaging'
  title           text,
  file_path       text,          -- Supabase storage path
  file_type       text,          -- 'pdf' | 'image' | 'json'
  extracted_data  jsonb,         -- Claude Vision analysis output
  doctor_said     text,          -- what the physician told them
  signal_ids      text[],        -- which signals this relates to
  visit_date      date,
  created_at      timestamptz default now()
);
alter table public.sage_documents enable row level security;
create policy "Users own their documents"
  on public.sage_documents for all using (auth.uid() = user_id);

-- ── 6. TEST RESULTS ─────────────────────────────────────
create table if not exists public.sage_test_results (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users on delete cascade,
  signal_id   text,
  test_type   text, -- 'blood' | 'sleep' | 'ecg' | 'bp'
  values      jsonb,
  doctor_said text,
  document_id uuid references public.sage_documents,
  created_at  timestamptz default now()
);
alter table public.sage_test_results enable row level security;
create policy "Users own their test results"
  on public.sage_test_results for all using (auth.uid() = user_id);

-- ── 7. WEEKLY SUMMARIES ─────────────────────────────────
create table if not exists public.sage_weekly_summaries (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users on delete cascade,
  week_of      date not null,
  health_grade text,
  narrative    text,
  key_findings jsonb,
  signals      jsonb,
  metrics      jsonb,
  created_at   timestamptz default now(),
  unique(user_id, week_of)
);
alter table public.sage_weekly_summaries enable row level security;
create policy "Users own their summaries"
  on public.sage_weekly_summaries for all using (auth.uid() = user_id);

-- ── 8. STORAGE BUCKETS ──────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('sage-documents', 'sage-documents', false)
  on conflict do nothing;
insert into storage.buckets (id, name, public)
  values ('sage-reports', 'sage-reports', false)
  on conflict do nothing;

create policy "Users access own documents"
  on storage.objects for all
  using (bucket_id = 'sage-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users access own reports"
  on storage.objects for all
  using (bucket_id = 'sage-reports' and auth.uid()::text = (storage.foldername(name))[1]);

-- ── AUTO-UPDATE updated_at ───────────────────────────────
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger sage_profiles_updated
  before update on public.sage_profiles
  for each row execute function update_updated_at();
create trigger sage_memory_updated
  before update on public.sage_memory
  for each row execute function update_updated_at();
create trigger sage_commitments_updated
  before update on public.sage_commitments
  for each row execute function update_updated_at();

-- ── AUTO-CREATE PROFILE ON SIGNUP ───────────────────────
create or replace function public.handle_new_sage_user()
returns trigger as $$
begin
  insert into public.sage_profiles (id, email)
  values (new.id, new.email)
  on conflict do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_sage_user_created
  after insert on auth.users
  for each row execute function public.handle_new_sage_user();
