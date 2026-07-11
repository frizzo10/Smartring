-- ═══════════════════════════════════════════════════════
--  SAGEHEALTH — RING SNAPSHOTS (persistent history beyond
--  the ring's own on-device memory + beyond the browser cache)
--  Run this in Supabase SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════

create table if not exists public.sage_ring_snapshots (
  id           uuid default gen_random_uuid() primary key,
  -- Fixed identifier, no auth system exists yet. Every row is tagged
  -- with this so a real user_id + auth.uid() policy can be dropped in
  -- later without needing to touch existing rows — just add a user_id
  -- column and backfill it to match this device_id at that point.
  device_id    text not null default 'frank-colmi-r02',
  recorded_at  timestamptz not null default now(),
  -- Full snapshot payload — same shape as the browser's sh_ring_latest
  -- (activity, sleepPeriods, heartSeries, oxygenHourly, hrvComputed,
  -- battery). Stored as-is rather than split into columns so new
  -- reading types can be added on the frontend without a migration.
  snapshot     jsonb not null,
  created_at   timestamptz default now()
);

create index if not exists sage_ring_snapshots_device_time_idx
  on public.sage_ring_snapshots (device_id, recorded_at desc);

alter table public.sage_ring_snapshots enable row level security;

-- TEMPORARY: no auth system exists yet, so this can't be scoped to
-- auth.uid() like every other table in this schema. Open to the anon
-- key for now — tighten this the moment real auth is added, per
-- explicit instruction (fixed identifier now, auth later).
create policy "Open access pending auth (temporary)"
  on public.sage_ring_snapshots for all
  using (true) with check (true);
