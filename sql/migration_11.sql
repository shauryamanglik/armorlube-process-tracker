-- ============================================================
-- Armorlube Process Tracker - Migration 11
-- Due dates, hot jobs and manual ordering for lots and orders.
-- Run in the Supabase SQL editor after migration 10.
--
-- SAFE TO RERUN. Creates one new table. No existing record is
-- touched, so every lot and order already on the line simply
-- has no due date until someone gives it one.
-- ============================================================

-- ------------------------------------------------------------
-- Priority belongs to the lot or order itself, not to any one
-- step's record of it. A lot has a record at every station it
-- passes through, and its due date is the same at all of them,
-- so it lives in its own table keyed by the reference.
--
-- Ordering works on a single number line measured in days:
--   no manual placement  -> the due date, as days since 1970
--   manual placement     -> a value between its two neighbours
--   no due date at all   -> sorts after everything dated
-- Hot jobs sit above the whole line regardless.
-- ------------------------------------------------------------
create table if not exists priorities (
  kind text not null check (kind in ('lot', 'po')),
  ref text not null,
  due_date date,
  hot boolean not null default false,
  manual_rank double precision,
  updated_at timestamptz default now(),
  primary key (kind, ref)
);

create index if not exists idx_priorities_hot on priorities (kind, hot)
  where hot;

alter table priorities enable row level security;

drop policy if exists "public read priorities" on priorities;
drop policy if exists "public insert priorities" on priorities;
drop policy if exists "public update priorities" on priorities;
drop policy if exists "public delete priorities" on priorities;
create policy "public read priorities"   on priorities for select using (true);
create policy "public insert priorities" on priorities for insert with check (true);
create policy "public update priorities" on priorities for update using (true);
create policy "public delete priorities" on priorities for delete using (true);

drop trigger if exists priorities_touch_updated_at on priorities;
create trigger priorities_touch_updated_at
  before update on priorities
  for each row execute function touch_updated_at();
