-- ============================================================
-- Armorlube Process Tracker - Migration 03
-- Adds the shared lot registry.
-- Run in the Supabase SQL editor after migration 02.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Mark where the line starts and ends.
--    Flags rather than hardcoded names, so the line can be
--    reordered later without touching code.
-- ------------------------------------------------------------
alter table steps add column if not exists is_entry boolean default false;
alter table steps add column if not exists is_final boolean default false;

update steps set is_entry = (sort_order = 1);
update steps set is_final = (sort_order = (select max(sort_order) from steps));

-- ------------------------------------------------------------
-- 2. Lots currently on the line.
--    A lot appears the moment it is logged anywhere, and drops
--    off once process out is recorded at the final step.
--    Derived from logs, so it can never drift out of sync.
-- ------------------------------------------------------------
drop view if exists active_lots;

create view active_lots
with (security_invoker = true) as
with live as (
  select
    l.lot_id,
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
finished as (
  select distinct lot_id
  from live
  where is_final and process_out is not null
)
select
  lot_id,
  count(*)::int as step_count,
  max(updated_at) as last_activity,
  max(sort_order)::int as furthest_step,
  (array_agg(step_name order by sort_order desc))[1] as last_step,
  (array_agg(area order by sort_order desc))[1] as last_area
from live
where lot_id not in (select lot_id from finished)
group by lot_id;

grant select on active_lots to anon, authenticated;
