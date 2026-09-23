-- ============================================================
-- Armorlube Process Tracker - Migration 10
-- Coating runs on one of two Emperion machines, and which one
-- matters enough to compare them, so it is recorded per lot.
-- Run in the Supabase SQL editor after migration 09.
--
-- SAFE TO RERUN. Adds a column and a flag, edits no records.
-- Coating records that already exist keep a blank machine, which
-- reads as "not recorded" rather than being guessed at.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Which steps ask for a machine. A flag rather than a
--    hardcoded step name, so another machine-bearing step can
--    be added later without touching code.
-- ------------------------------------------------------------
alter table steps add column if not exists has_emperion boolean default false;

update steps set has_emperion = (step_name = 'Coating');

-- ------------------------------------------------------------
-- 2. The machine itself, shaped like blast type: a free column
--    with a check, null until someone records it.
-- ------------------------------------------------------------
alter table logs add column if not exists emperion text;

alter table logs drop constraint if exists logs_emperion_check;
alter table logs
  add constraint logs_emperion_check
  check (emperion in ('2301', '2302') or emperion is null);

create index if not exists idx_logs_emperion on logs (emperion)
  where emperion is not null;

-- ------------------------------------------------------------
-- 3. Checks.
-- ------------------------------------------------------------
-- Coating should be the only step asking for a machine:
-- select step_name, has_emperion from steps
--   where coalesce(active,true) order by sort_order;
--
-- Coating records with no machine recorded, which will be every
-- one logged before today:
-- select l.lot_id, l.log_date from logs l
--   join steps s on s.id = l.step_id
--  where s.has_emperion and l.emperion is null and l.deleted_at is null
--  order by l.log_date desc;
