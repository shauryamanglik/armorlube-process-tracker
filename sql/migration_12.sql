-- ============================================================
-- Armorlube Process Tracker - Migration 12
-- Lots stuck in place after being sent on.
-- Run in the Supabase SQL editor after migration 11.
--
-- Two parts. The first repairs lots already in a bad state. The
-- second stops the view that lists lots on the line from making
-- the same mistake the screens did.
--
-- SAFE TO RERUN. The repair only closes timers that are already
-- superseded by a newer one, so a second run finds nothing to do.
-- Nothing is deleted.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Repair: a lot can only be in one place.
--    Where a lot has more than one timer open, the newest one is
--    where it really is. Every older open timer is closed at the
--    moment the newest began, which is when the lot left.
-- ------------------------------------------------------------
with open_lot as (
  select
    sg.id,
    sg.started_at,
    l.lot_id,
    max(sg.started_at) over (partition by l.lot_id) as newest
  from segments sg
  join logs l on l.id = sg.log_id
  where sg.ended_at is null
    and l.deleted_at is null
)
update segments s
set ended_at = greatest(o.newest, s.started_at)
from open_lot o
where s.id = o.id
  and o.started_at < o.newest;

-- Same rule for purchase orders.
with open_po as (
  select
    sg.id,
    sg.started_at,
    p.po_number,
    max(sg.started_at) over (partition by p.po_number) as newest
  from segments sg
  join po_logs p on p.id = sg.po_log_id
  where sg.ended_at is null
    and p.deleted_at is null
)
update segments s
set ended_at = greatest(o.newest, s.started_at)
from open_po o
where s.id = o.id
  and o.started_at < o.newest;

-- ------------------------------------------------------------
-- 2. Lots on the line, decided by latest activity.
--    The old view kept only a lot's highest pass. A forward move
--    could land at a lower pass than the step before it, so the
--    lot was reported at the old step forever.
--    Now a lot is wherever its newest open timer is, or failing
--    that wherever its latest timer closed. It is finished only
--    when that latest activity is process ending at the last step.
-- ------------------------------------------------------------
drop view if exists active_lots;

create view active_lots
with (security_invoker = true) as
with seg as (
  select
    l.lot_id,
    l.pass_no,
    st.step_name,
    st.area,
    st.sort_order,
    st.is_final,
    sg.kind,
    sg.started_at,
    sg.ended_at
  from segments sg
  join logs l on l.id = sg.log_id
  join steps st on st.id = l.step_id
  where l.deleted_at is null
    and coalesce(st.active, true)
    and coalesce(st.tracks_lots, true)
),
latest as (
  select distinct on (lot_id) *
  from seg
  -- open timers first, then the most recent activity
  order by lot_id,
           (ended_at is null) desc,
           coalesce(ended_at, started_at) desc
),
counts as (
  select lot_id,
         count(distinct step_name)::int as step_count,
         max(coalesce(ended_at, started_at)) as last_activity
  from seg
  group by lot_id
)
select
  lt.lot_id,
  lt.pass_no::int as pass_no,
  c.step_count,
  c.last_activity,
  lt.sort_order::int as furthest_step,
  lt.step_name as last_step,
  lt.area as last_area
from latest lt
join counts c on c.lot_id = lt.lot_id
where not (
  lt.is_final
  and lt.kind = 'process'
  and lt.ended_at is not null
);

grant select on active_lots to anon, authenticated;

-- ------------------------------------------------------------
-- 3. Check. Should return no rows: no lot or order should have
--    more than one timer open after this.
-- ------------------------------------------------------------
-- select l.lot_id, count(*) as open_timers
--   from segments sg join logs l on l.id = sg.log_id
--  where sg.ended_at is null and l.deleted_at is null
--  group by l.lot_id having count(*) > 1;
