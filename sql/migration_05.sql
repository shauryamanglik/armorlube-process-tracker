-- ============================================================
-- Armorlube Process Tracker - Migration 05
-- Lot numbers are not all 000000-00.
-- Run in the Supabase SQL editor after migration 04.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop the old six-digit-dash-two-digit rule.
--    Found by definition rather than by name, since the auto
--    generated constraint name can differ between projects.
-- ------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%lot_id%'
  loop
    execute format('alter table logs drop constraint %I', c.conname);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. Normalise existing rows BEFORE the new rule goes on, or a
--    lowercase row already in the table would block it.
--    Existing 000000-00 numbers already satisfy the new rule
--    and are left untouched.
-- ------------------------------------------------------------
update logs
set lot_id = upper(trim(lot_id))
where lot_id <> upper(trim(lot_id));

-- ------------------------------------------------------------
-- 3. Accept any real lot format: letters, digits, and one or
--    more dashes or underscores as separators. Still rejects the
--    shapes that quietly create orphan records, namely spaces,
--    leading or trailing separators, and doubled separators.
-- ------------------------------------------------------------
alter table logs
  add constraint logs_lot_id_format
  check (
    lot_id ~ '^[A-Z0-9]+([-_][A-Z0-9]+)*$'
    and char_length(lot_id) between 2 and 40
  );
