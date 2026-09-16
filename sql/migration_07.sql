-- ============================================================
-- Armorlube Process Tracker - Migration 07
-- Outgoing Sand Blast was the queue for Wash, not a step of its
-- own. Wash becomes a normal step with its own queue, and every
-- Outgoing Sand Blast record is folded into it.
-- Run in the Supabase SQL editor after migration 06.
--
-- SAFE TO RERUN. Intervals are MOVED rather than copied, so
-- nothing is ever counted twice, and records already folded in
-- are skipped on a second run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Steps can be retired without being deleted, so old records
--    keep a valid reference and nothing has to be thrown away.
-- ------------------------------------------------------------
alter table steps add column if not exists active boolean default true;

-- ------------------------------------------------------------
-- 2. Wash becomes an ordinary step with a queue of its own.
-- ------------------------------------------------------------
update steps set has_queue = true where step_name = 'Wash';

-- ------------------------------------------------------------
-- 3. Fold every Outgoing Sand Blast record into Wash.
-- ------------------------------------------------------------

-- 3a. Any lot that reached Outgoing Sand Blast but has no Wash
--     record yet gets one, matched on the same pass.
insert into logs (step_id, operator_id, lot_id, log_date, pass_no, auto_from_step_id)
select
  (select id from steps where step_name = 'Wash'),
  osb.operator_id,
  osb.lot_id,
  osb.log_date,
  osb.pass_no,
  osb.auto_from_step_id
from logs osb
join steps s on s.id = osb.step_id
where s.step_name = 'Outgoing Sand Blast'
  and osb.deleted_at is null
  and not exists (
    select 1 from logs w
    join steps ws on ws.id = w.step_id
    where ws.step_name = 'Wash'
      and w.lot_id = osb.lot_id
      and w.pass_no = osb.pass_no
      and w.deleted_at is null
  );

-- 3b. Move the intervals across. Moving rather than copying is
--     what guarantees the time is not counted twice.
update segments sg
set log_id = w.id
from logs osb
join steps s on s.id = osb.step_id
join steps ws on ws.step_name = 'Wash'
join logs w
  on w.step_id = ws.id
 and w.lot_id = osb.lot_id
 and w.pass_no = osb.pass_no
 and w.deleted_at is null
where sg.log_id = osb.id
  and s.step_name = 'Outgoing Sand Blast'
  and osb.deleted_at is null;

-- 3c. Carry the original timestamp columns over where Wash has
--     none, so records that predate intervals still read right.
update logs w
set queue_in  = coalesce(w.queue_in,  osb.queue_in),
    queue_out = coalesce(w.queue_out, osb.queue_out)
from logs osb
join steps s on s.id = osb.step_id
join steps ws on ws.step_name = 'Wash'
where w.step_id = ws.id
  and w.lot_id = osb.lot_id
  and w.pass_no = osb.pass_no
  and w.deleted_at is null
  and s.step_name = 'Outgoing Sand Blast'
  and osb.deleted_at is null;

-- 3d. Retire the emptied Outgoing Sand Blast records. Their
--     intervals now live on Wash, so leaving these live would
--     double count. Soft deleted, so nothing is destroyed.
update logs osb
set deleted_at = now()
from steps s
where s.id = osb.step_id
  and s.step_name = 'Outgoing Sand Blast'
  and osb.deleted_at is null;

-- ------------------------------------------------------------
-- 4. Retire the step and close the gap in the running order.
-- ------------------------------------------------------------
update steps set active = false, sort_order = 99, tracks_po = false
where step_name = 'Outgoing Sand Blast';

update steps set sort_order = 4 where step_name = 'Wash';
update steps set sort_order = 5 where step_name = 'Fixturing';
update steps set sort_order = 6 where step_name = 'Coating';
update steps set sort_order = 7 where step_name = 'Unloading/Defixturing';
update steps set sort_order = 8 where step_name = 'Final Inspection/Oil/Packing';

-- Entry and final markers, set explicitly so the retired step
-- sitting at 99 cannot be mistaken for the end of the line.
update steps set is_entry = (step_name = 'Incoming Inspection');
update steps set is_final = (step_name = 'Final Inspection/Oil/Packing');
update steps set tracks_po = (is_entry or is_final);

-- ------------------------------------------------------------
-- 5. Rebuild the active lots view so retired steps are ignored.
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
    and coalesce(s.active, true)
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
-- 6. Checks. All three should return no rows.
-- ------------------------------------------------------------
-- Any interval still attached to the retired step:
-- select sg.* from segments sg join logs l on l.id = sg.log_id
--   join steps s on s.id = l.step_id where s.step_name = 'Outgoing Sand Blast';
--
-- Any live Outgoing Sand Blast record left behind:
-- select l.* from logs l join steps s on s.id = l.step_id
--   where s.step_name = 'Outgoing Sand Blast' and l.deleted_at is null;
--
-- Two steps claiming the same position:
-- select sort_order, count(*) from steps where coalesce(active,true)
--   group by sort_order having count(*) > 1;
