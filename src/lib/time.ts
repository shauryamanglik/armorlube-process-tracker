import type { WorkRules } from "./types";

/**
 * Arizona does not observe daylight saving time, so America/Phoenix is a
 * fixed UTC-7 all year. That lets us do plain arithmetic instead of
 * wrestling with DST boundaries.
 */
export const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000;

export const DEFAULT_RULES: WorkRules = {
  work_start: "07:00",
  work_end: "15:30",
  work_days: [1, 2, 3, 4, 5],
  timezone: "America/Phoenix",
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Shift a UTC instant so its UTC getters read as Phoenix wall-clock time. */
function toLocalSpace(d: Date): number {
  return d.getTime() + PHOENIX_OFFSET_MS;
}

/** Reverse of toLocalSpace. */
function fromLocalSpace(ms: number): Date {
  return new Date(ms - PHOENIX_OFFSET_MS);
}

function startOfLocalDay(localMs: number): number {
  return Math.floor(localMs / DAY) * DAY;
}

function localDayOfWeek(localMs: number): number {
  // 1970-01-01 was a Thursday (4).
  return new Date(localMs).getUTCDay();
}

export type Span = {
  /** Wall-clock elapsed milliseconds, ignoring shift schedule. */
  rawMs: number;
  /** Milliseconds that fall inside working hours on working days. */
  businessMs: number;
  /** Milliseconds outside the shift schedule (nights, weekends). */
  offShiftMs: number;
  /** True when the span crosses at least one shift boundary. */
  crossesOffShift: boolean;
  /** True when start and end fall on different calendar days. */
  multiDay: boolean;
};

export const EMPTY_SPAN: Span = {
  rawMs: 0,
  businessMs: 0,
  offShiftMs: 0,
  crossesOffShift: false,
  multiDay: false,
};

/**
 * Split the time between two instants into working and non-working portions.
 * Walks day by day in local space, clipping each day to the shift window.
 */
export function measureSpan(
  startIso: string | null,
  endIso: string | null,
  rules: WorkRules = DEFAULT_RULES
): Span | null {
  if (!startIso || !endIso) return null;

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  const rawMs = end.getTime() - start.getTime();
  if (rawMs <= 0) {
    return { ...EMPTY_SPAN, rawMs };
  }

  const s = toLocalSpace(start);
  const e = toLocalSpace(end);

  const openMin = hhmmToMinutes(rules.work_start);
  const closeMin = hhmmToMinutes(rules.work_end);
  const days = rules.work_days?.length ? rules.work_days : [1, 2, 3, 4, 5];

  let business = 0;
  let cursor = startOfLocalDay(s);
  let guard = 0;

  while (cursor < e && guard < 4000) {
    guard += 1;
    if (days.includes(localDayOfWeek(cursor))) {
      const open = cursor + openMin * MINUTE;
      const close = cursor + closeMin * MINUTE;
      const from = Math.max(s, open);
      const to = Math.min(e, close);
      if (to > from) business += to - from;
    }
    cursor += DAY;
  }

  const multiDay = startOfLocalDay(s) !== startOfLocalDay(e);

  return {
    rawMs,
    businessMs: business,
    offShiftMs: rawMs - business,
    crossesOffShift: rawMs - business > MINUTE,
    multiDay,
  };
}

/**
 * Split an interval's working time across the calendar days it touches.
 * A process that runs from Monday afternoon into Tuesday morning contributes
 * to both days, which is the only way a day-by-day chart means anything.
 * Returns Phoenix dates as YYYY-MM-DD mapped to milliseconds.
 */
export function spreadAcrossDays(
  startIso: string | null,
  endIso: string | null,
  rules: WorkRules = DEFAULT_RULES,
  includeOffShift = false
): Map<string, number> {
  const out = new Map<string, number>();
  if (!startIso || !endIso) return out;

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return out;
  if (end.getTime() <= start.getTime()) return out;

  const s = toLocalSpace(start);
  const e = toLocalSpace(end);
  const openMin = hhmmToMinutes(rules.work_start);
  const closeMin = hhmmToMinutes(rules.work_end);
  const days = rules.work_days?.length ? rules.work_days : [1, 2, 3, 4, 5];

  let cursor = startOfLocalDay(s);
  let guard = 0;

  while (cursor < e && guard < 4000) {
    guard += 1;
    const dayKey = new Date(cursor).toISOString().slice(0, 10);

    if (includeOffShift) {
      const from = Math.max(s, cursor);
      const to = Math.min(e, cursor + DAY);
      if (to > from) out.set(dayKey, (out.get(dayKey) ?? 0) + (to - from));
    } else if (days.includes(localDayOfWeek(cursor))) {
      const from = Math.max(s, cursor + openMin * MINUTE);
      const to = Math.min(e, cursor + closeMin * MINUTE);
      if (to > from) out.set(dayKey, (out.get(dayKey) ?? 0) + (to - from));
    }
    cursor += DAY;
  }

  return out;
}

/** Pick which number counts, based on the dashboard toggle. */
export function spanValue(span: Span | null, includeOffShift: boolean): number {
  if (!span) return 0;
  return includeOffShift ? span.rawMs : span.businessMs;
}

/** 2h 14m, 45m, 3d 2h. Compact and readable at a glance. */
export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "0m";
  const totalMin = Math.round(ms / MINUTE);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Decimal hours, for charts and CSV. */
export function toHours(ms: number): number {
  return Math.round((ms / 3600000) * 100) / 100;
}

/** ISO instant to Phoenix "Sep 15, 2:04 PM". */
export function formatStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** ISO instant to Phoenix "2:04 PM". */
export function formatClock(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Phoenix",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Today in Phoenix as YYYY-MM-DD, for date inputs. */
export function todayInPhoenix(): string {
  const local = new Date(toLocalSpace(new Date()));
  return local.toISOString().slice(0, 10);
}

/** Current Phoenix wall clock as HH:MM, for time inputs. */
export function nowClockInPhoenix(): string {
  const local = new Date(toLocalSpace(new Date()));
  return local.toISOString().slice(11, 16);
}

/**
 * Combine a Phoenix date (YYYY-MM-DD) and time (HH:MM) into a real UTC
 * instant for storage.
 */
export function phoenixToIso(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const localMs = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  return fromLocalSpace(localMs).toISOString();
}

/** Pull the Phoenix date portion out of a stored instant. */
export function isoToPhoenixDate(iso: string): string {
  return new Date(toLocalSpace(new Date(iso))).toISOString().slice(0, 10);
}

/** Pull the Phoenix HH:MM portion out of a stored instant. */
export function isoToPhoenixTime(iso: string): string {
  return new Date(toLocalSpace(new Date(iso))).toISOString().slice(11, 16);
}
