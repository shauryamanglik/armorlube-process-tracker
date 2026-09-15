-- ============================================================
-- Armorlube Process Tracker - Migration 02
-- Run this in the Supabase SQL Editor AFTER the first script.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Soft delete on logs
--    Records are never physically removed, so the edit trail
--    stays intact and a deletion can be reviewed or reversed.
-- ------------------------------------------------------------
alter table logs add column if not exists deleted_at timestamptz;

-- ------------------------------------------------------------
-- 2. Notes field (operators flagging something about a record)
-- ------------------------------------------------------------
alter table logs add column if not exists notes text;

-- ------------------------------------------------------------
-- 3. Settings (single row, id is always 1)
--    Password and work-hour rules live here so they can be
--    changed from the app without a redeploy.
-- ------------------------------------------------------------
create table if not exists app_settings (
  id int primary key default 1,
  dashboard_password text not null default 'Armorlube1234!',
  work_start text not null default '07:00',
  work_end text not null default '15:30',
  work_days int[] not null default '{1,2,3,4,5}',
  timezone text not null default 'America/Phoenix',
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 4. Settings is server-only.
--    RLS is enabled with NO anon policies, so the browser key
--    cannot read the password. All settings access goes through
--    the app's server routes using the service role key.
-- ------------------------------------------------------------
alter table app_settings enable row level security;

-- ------------------------------------------------------------
-- 5. Indexes for dashboard query speed
-- ------------------------------------------------------------
create index if not exists idx_logs_lot on logs (lot_id);
create index if not exists idx_logs_step on logs (step_id);
create index if not exists idx_logs_date on logs (log_date);
create index if not exists idx_logs_live on logs (deleted_at) where deleted_at is null;
create index if not exists idx_history_log on log_history (log_id);

-- ------------------------------------------------------------
-- 6. Keep updated_at honest
-- ------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists logs_touch_updated_at on logs;
create trigger logs_touch_updated_at
  before update on logs
  for each row execute function touch_updated_at();
