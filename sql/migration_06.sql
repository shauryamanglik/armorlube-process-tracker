-- ============================================================
-- Armorlube Process Tracker - Migration 06
-- Interval segments, PO tracking, crews.
-- Run in the Supabase SQL editor after migration 05.
--
-- SAFE TO RERUN. Every step is guarded, and the conversion of
-- existing records only runs for records that have no segments
-- yet, so running this twice cannot duplicate anything.
-- The original four timestamp columns are left untouched as a
-- fallback. Nothing is dropped.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Which steps carry a purchase order tab.
--    Incoming and final inspection handle boxes and paperwork
--    before a lot exists and after it dissolves.
-- ------------------------------------------------------------
alter table steps add column if not exists tracks_po boolean default false;
update steps set tracks_po = true where is_entry or is_final;

-- ------------------------------------------------------------
-- 2. Purchase order records. Same shape as a lot record minus
--    the things that only make sense on the line: no routing,
--    no blast type, no rework passes.
-- ------------------------------------------------------------
create table if not exists po_logs (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references steps(id),
  po_number text not null
    check (po_number ~ '^[A-Z0-9]+([-_][A-Z0-9]+)*$'
           and char_length(po_number) between 2 and 40),
  log_date date not null default current_date,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_po_logs_number on po_logs (po_number);
create index if not exists idx_po_logs_step on po_logs (step_id);
create index if not exists idx_po_logs_live on po_logs (deleted_at) where deleted_at is null;

-- ------------------------------------------------------------
-- 3. Segments.
--    A record owns a list of intervals rather than four fixed
--    timestamps, so a lot can be sent back to queue as many
--    times as the floor needs and every interval is kept.
--    started_by and ended_by are arrays because several people
--    can work the same lot at once.
-- ------------------------------------------------------------
create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  log_id uuid references logs(id) on delete cascade,
  po_log_id uuid references po_logs(id) on delete cascade,
  kind text not null check (kind in ('queue', 'process')),
  started_at timestamptz not null,
  ended_at timestamptz,
  started_by uuid[] not null default '{}',
  ended_by uuid[] not null default '{}',
  created_at timestamptz default now(),
  -- exactly one parent, so a segment can never be orphaned or
  -- attached to both a lot and a purchase order
  constraint one_parent check (
    (log_id is not null and po_log_id is null) or
    (log_id is null and po_log_id is not null)
  ),
  constraint ends_after_start check (ended_at is null or ended_at >= started_at)
);

create index if not exists idx_segments_log on segments (log_id, started_at);
create index if not exists idx_segments_po on segments (po_log_id, started_at);
create index if not exists idx_segments_open on segments (log_id) where ended_at is null;

-- ------------------------------------------------------------
-- 4. Convert the records you already have.
--    Only touches logs that have no segments yet, so rerunning
--    this migration is harmless.
-- ------------------------------------------------------------

-- queue intervals
insert into segments (log_id, kind, started_at, ended_at, started_by, ended_by)
select
  l.id,
  'queue',
  l.queue_in,
  l.queue_out,
  case when l.queue_in_by  is null then '{}'::uuid[] else array[l.queue_in_by]  end,
  case when l.queue_out_by is null then '{}'::uuid[] else array[l.queue_out_by] end
from logs l
where l.queue_in is not null
  and not exists (select 1 from segments s where s.log_id = l.id);

-- process intervals
insert into segments (log_id, kind, started_at, ended_at, started_by, ended_by)
select
  l.id,
  'process',
  l.process_in,
  l.process_out,
  case when l.process_in_by  is null then '{}'::uuid[] else array[l.process_in_by]  end,
  case when l.process_out_by is null then '{}'::uuid[] else array[l.process_out_by] end
from logs l
where l.process_in is not null
  and not exists (
    select 1 from segments s where s.log_id = l.id and s.kind = 'process'
  );

-- ------------------------------------------------------------
-- 5. Row level security, matching the existing tables.
-- ------------------------------------------------------------
alter table po_logs enable row level security;
alter table segments enable row level security;

drop policy if exists "public read po_logs" on po_logs;
drop policy if exists "public insert po_logs" on po_logs;
drop policy if exists "public update po_logs" on po_logs;
create policy "public read po_logs"   on po_logs for select using (true);
create policy "public insert po_logs" on po_logs for insert with check (true);
create policy "public update po_logs" on po_logs for update using (true);

drop policy if exists "public read segments" on segments;
drop policy if exists "public insert segments" on segments;
drop policy if exists "public update segments" on segments;
drop policy if exists "public delete segments" on segments;
create policy "public read segments"   on segments for select using (true);
create policy "public insert segments" on segments for insert with check (true);
create policy "public update segments" on segments for update using (true);
create policy "public delete segments" on segments for delete using (true);

-- keep updated_at honest on po_logs
drop trigger if exists po_logs_touch_updated_at on po_logs;
create trigger po_logs_touch_updated_at
  before update on po_logs
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------
-- 6. Active lots, now driven by segments.
--    A lot is finished once a process interval at the final
--    step has closed.
-- ------------------------------------------------------------
drop view if exists active_lots;

create view active_lots
with (security_invoker = true) as
with live as (
  select l.id, l.lot_id, l.pass_no, l.updated_at,
         s.step_name, s.area, s.sort_order, s.is_final
  from logs l
  join steps s on s.id = l.step_id
  where l.deleted_at is null
),
newest_pass as (
  select lot_id, max(pass_no) as pass_no from live group by lot_id
),
current_pass as (
  select live.* from live
  join newest_pass np on np.lot_id = live.lot_id and np.pass_no = live.pass_no
),
finished as (
  select distinct c.lot_id
  from current_pass c
  join segments sg on sg.log_id = c.id
  where c.is_final and sg.kind = 'process' and sg.ended_at is not null
)
select
  lot_id,
  max(pass_no)::int as pass_no,
  count(*)::int as step_count,
  max(updated_at) as last_activity,
  max(sort_order)::int as furthest_step,
  (array_agg(step_name order by sort_order desc))[1] as last_step,
  (array_agg(area order by sort_order desc))[1] as last_area
from current_pass
where lot_id not in (select lot_id from finished)
group by lot_id;

grant select on active_lots to anon, authenticated;

-- ------------------------------------------------------------
-- 7. Purchase order registry.
--    Every PO the system has seen, so final inspection can pick
--    up one carried over from incoming as well as start a new one.
-- ------------------------------------------------------------
drop view if exists po_registry;

create view po_registry
with (security_invoker = true) as
select
  p.po_number,
  max(p.updated_at) as last_activity,
  count(*)::int as record_count,
  bool_or(s.is_entry) as seen_at_incoming,
  bool_or(s.is_final) as seen_at_final,
  (array_agg(s.step_name order by p.updated_at desc))[1] as last_step
from po_logs p
join steps s on s.id = p.step_id
where p.deleted_at is null
group by p.po_number;

grant select on po_registry to anon, authenticated;

-- ------------------------------------------------------------
-- 8. Check the conversion before trusting it.
--    Both queries should return no rows. The first finds records
--    whose segments do not match their original timestamps. The
--    second finds records that could not convert because an out
--    time exists without its matching in time.
-- ------------------------------------------------------------
-- select l.id, l.lot_id, l.queue_in, l.queue_out, l.process_in, l.process_out
-- from logs l
-- where (l.queue_in is not null and not exists (
--         select 1 from segments s where s.log_id = l.id and s.kind = 'queue'
--           and s.started_at = l.queue_in
--           and s.ended_at is not distinct from l.queue_out))
--    or (l.process_in is not null and not exists (
--         select 1 from segments s where s.log_id = l.id and s.kind = 'process'
--           and s.started_at = l.process_in
--           and s.ended_at is not distinct from l.process_out));
--
-- select id, lot_id, queue_in, queue_out, process_in, process_out from logs
-- where (queue_out is not null and queue_in is null)
--    or (process_out is not null and process_in is null);
