-- ============================================================
-- Armorlube Process Tracker - Migration 04
-- Handoffs between steps, rework passes, per-timestamp operators.
-- Run in the Supabase SQL editor after migration 03.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Which pass this record belongs to.
--    A lot sent backward for rework starts a new pass rather than
--    overwriting the first run, so the rework time is measurable
--    separately instead of hidden inside the original record.
-- ------------------------------------------------------------
alter table logs add column if not exists pass_no int not null default 1;

-- ------------------------------------------------------------
-- 2. Where the lot was handed off from, so the screen can say
--    "arrived from Degrease" instead of showing a timestamp the
--    operator did not press.
-- ------------------------------------------------------------
alter table logs add column if not exists auto_from_step_id uuid references steps(id);

-- ------------------------------------------------------------
-- 3. One operator per timestamp.
--    With handoffs, the person who ends a step is rarely the
--    person who starts the next one, so a single operator column
--    would only ever remember whoever touched the row last.
-- ------------------------------------------------------------
alter table logs add column if not exists queue_in_by uuid references operators(id);
alter table logs add column if not exists queue_out_by uuid references operators(id);
alter table logs add column if not exists process_in_by uuid references operators(id);
alter table logs add column if not exists process_out_by uuid references operators(id);

-- Existing rows only knew one operator, so credit that person with
-- whichever timestamps are already filled.
update logs set queue_in_by    = operator_id where queue_in    is not null and queue_in_by    is null;
update logs set queue_out_by   = operator_id where queue_out   is not null and queue_out_by   is null;
update logs set process_in_by  = operator_id where process_in  is not null and process_in_by  is null;
update logs set process_out_by = operator_id where process_out is not null and process_out_by is null;

create index if not exists idx_logs_lot_step_pass on logs (lot_id, step_id, pass_no);

-- ------------------------------------------------------------
-- 4. Active lots, now pass aware.
--    Only the newest pass counts. A lot that finished final
--    inspection and was then sent back for rework opens a new
--    pass, which puts it back on the line automatically.
-- ------------------------------------------------------------
drop view if exists active_lots;

create view active_lots
with (security_invoker = true) as
with live as (
  select
    l.lot_id,
    l.pass_no,
    l.updated_at,
    l.process_out,
    s.step_name,
    s.area,
    s.sort_order,
    s.is_final
  from logs l
  join steps s on s.id = l.step_id
  where l.deleted_at is null
),
newest_pass as (
  select lot_id, max(pass_no) as pass_no
  from live
  group by lot_id
),
current_pass as (
  select live.*
  from live
  join newest_pass np
    on np.lot_id = live.lot_id
   and np.pass_no = live.pass_no
),
finished as (
  select distinct lot_id
  from current_pass
  where is_final and process_out is not null
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
