-- ============================================================
-- Armorlube Process Tracker - Migration 08
-- Final inspection of a lot happens during defixturing, so those
-- two steps become one and the lot ends there. Everything after
-- that is purchase order work, because lots get split up.
-- Run in the Supabase SQL editor after migration 07.
--
-- SAFE TO RERUN. Targets steps by position, not by name, so the
-- renames do not break a second run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A step can now track lots, purchase orders, or both.
--    Oil and shipping handles no lots at all.
-- ------------------------------------------------------------
alter table steps add column if not exists tracks_lots boolean default true;

-- ------------------------------------------------------------
-- 2. Rescue any lot record sitting at position 8 before that step
--    stops handling lots. These should not exist, but a stranded
--    record on a purchase order step would be invisible and its
--    time would vanish from the dashboard.
-- ------------------------------------------------------------

-- 2a. Give it a home at position 7 if it has none for that pass.
insert into logs (step_id, operator_id, lot_id, log_date, pass_no, auto_from_step_id)
select
  (select id from steps where sort_order = 7),
  old.operator_id, old.lot_id, old.log_date, old.pass_no, old.auto_from_step_id
from logs old
join steps s on s.id = old.step_id
where s.sort_order = 8
  and old.deleted_at is null
  and not exists (
    select 1 from logs n join steps ns on ns.id = n.step_id
    where ns.sort_order = 7 and n.lot_id = old.lot_id
      and n.pass_no = old.pass_no and n.deleted_at is null
  );

-- 2b. Move the intervals, never copy them.
update segments sg
set log_id = n.id
from logs old
join steps s on s.id = old.step_id
join steps ns on ns.sort_order = 7
join logs n
  on n.step_id = ns.id and n.lot_id = old.lot_id
 and n.pass_no = old.pass_no and n.deleted_at is null
where sg.log_id = old.id and s.sort_order = 8 and old.deleted_at is null;

-- 2c. Carry the original timestamp columns across where empty.
update logs n
set queue_in    = coalesce(n.queue_in,    old.queue_in),
    queue_out   = coalesce(n.queue_out,   old.queue_out),
    process_in  = coalesce(n.process_in,  old.process_in),
    process_out = coalesce(n.process_out, old.process_out)
from logs old
join steps s on s.id = old.step_id
join steps ns on ns.sort_order = 7
where n.step_id = ns.id and n.lot_id = old.lot_id and n.pass_no = old.pass_no
  and n.deleted_at is null and s.sort_order = 8 and old.deleted_at is null;

-- 2d. Retire the emptied records so nothing is counted twice.
update logs old
set deleted_at = now()
from steps s
where s.id = old.step_id and s.sort_order = 8 and old.deleted_at is null;

-- ------------------------------------------------------------
-- 3. Position 7 becomes the combined step and is where a lot ends.
-- ------------------------------------------------------------
update steps
set step_name = 'Defixturing/Final Inspection',
    has_queue = true,
    has_process = true,
    tracks_lots = true,
    tracks_po = false,
    is_final = true,
    active = true
where sort_order = 7;

-- ------------------------------------------------------------
-- 4. Position 8 becomes oil and shipping, purchase orders only.
--    It is not the end of a lot, because no lot reaches it.
-- ------------------------------------------------------------
update steps
set step_name = 'Oil/Shipping',
    tracks_lots = false,
    tracks_po = true,
    is_final = false,
    has_queue = true,
    has_process = true,
    active = true
where sort_order = 8;

-- ------------------------------------------------------------
-- 4b. Incoming Inspection stops timing lots.
--     A lot is created and handed straight to degreasing, where
--     it queues, so a single release press is all that is needed.
--     Records already sitting there keep their intervals and
--     still read correctly. Only new presses behave differently.
-- ------------------------------------------------------------
alter table steps add column if not exists release_only boolean default false;

update steps set release_only = is_entry;
update steps set release_only = false where not coalesce(is_entry, false);

-- ------------------------------------------------------------
-- 5. Purchase orders are handled where work arrives and where it
--    ships. Every other step is lots only.
-- ------------------------------------------------------------
update steps set tracks_po = true  where is_entry;
update steps set tracks_po = false where sort_order between 2 and 7;
update steps set tracks_lots = true where sort_order between 1 and 7;

-- Exactly one step may claim to end a lot.
update steps set is_final = (sort_order = 7) where coalesce(active, true);

-- ------------------------------------------------------------
-- 6. Rebuild the active lots view.
--    A lot is done once a process interval closes at the step
--    that ends the line, which is now the combined step.
--    Steps that do not track lots are ignored entirely.
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
    and coalesce(s.tracks_lots, true)
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
-- 7. Checks. The first should list seven lot steps ending at the
--    combined step, the second one purchase order step at each
--    end of the line, the third no rows.
-- ------------------------------------------------------------
-- select sort_order, step_name, tracks_lots, release_only, tracks_po, is_final
--   from steps where coalesce(active,true) order by sort_order;
--
-- select count(*) as lots_marked_final from steps
--   where coalesce(active,true) and is_final;   -- must be 1
--
-- select l.lot_id, s.step_name from logs l join steps s on s.id=l.step_id
--   where not coalesce(s.tracks_lots,true) and l.deleted_at is null;
