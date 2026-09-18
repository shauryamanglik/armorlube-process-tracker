-- ============================================================
-- Armorlube Process Tracker - Migration 09
-- A purchase order that finishes at incoming inspection should
-- show up at oil and shipping ready to be picked, without a
-- timer starting on its own. Queue time there should begin when
-- someone actually starts waiting on it, not the moment the
-- paperwork cleared upstream.
-- Run in the Supabase SQL editor after migration 08.
--
-- SAFE TO RERUN. This only replaces a view. No record is
-- created, edited or deleted, so nothing can be lost.
-- ============================================================

drop view if exists po_registry;

create view po_registry
with (security_invoker = true) as
with recs as (
  select
    p.id,
    p.po_number,
    p.updated_at,
    s.step_name,
    s.sort_order,
    s.is_entry
  from po_logs p
  join steps s on s.id = p.step_id
  where p.deleted_at is null
    and coalesce(s.active, true)
    and s.tracks_po
),
state as (
  select
    r.*,
    -- finished here means a process stretch at this station has closed
    exists (
      select 1 from segments sg
      where sg.po_log_id = r.id
        and sg.kind = 'process'
        and sg.ended_at is not null
    ) as finished,
    exists (
      select 1 from segments sg
      where sg.po_log_id = r.id and sg.ended_at is null
    ) as running
  from recs r
)
select
  po_number,
  max(updated_at) as last_activity,
  count(*)::int as record_count,
  bool_or(is_entry) as seen_at_incoming,
  bool_or(not is_entry) as seen_at_final,
  (array_agg(step_name order by updated_at desc))[1] as last_step,
  -- every station this order has a record at
  array_agg(distinct step_name) as seen_at,
  -- stations where the work is done
  coalesce(
    array_agg(distinct step_name) filter (where finished),
    '{}'
  ) as finished_at,
  -- how far down the line the finished work reaches, so a station
  -- can tell which orders are ready to arrive at it
  coalesce(max(sort_order) filter (where finished), 0)::int as furthest_finished,
  bool_or(running) as any_running
from state
group by po_number;

grant select on po_registry to anon, authenticated;

-- ------------------------------------------------------------
-- Check: orders finished at incoming that have not reached
-- shipping yet. These are the ones that should appear in the
-- Ready to start list at Oil/Shipping.
-- ------------------------------------------------------------
-- select po_number, finished_at, seen_at, furthest_finished
--   from po_registry
--  where furthest_finished > 0
--    and not ('Oil/Shipping' = any(seen_at));
