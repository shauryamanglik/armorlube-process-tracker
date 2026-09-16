import { measureSpan, type Span } from "./time";
import type { Segment, SegmentKind, WorkRules } from "./types";

/**
 * Everything that reads durations goes through here, so the logging screen,
 * the dashboard and the CSV can never disagree about what a lot's queue time
 * actually is.
 */

export type Rollup = {
  /** Working-hours milliseconds, the default measure. */
  businessMs: number;
  /** Wall-clock milliseconds including nights and weekends. */
  rawMs: number;
  /** Labour milliseconds: elapsed multiplied by the crew on each interval. */
  labourMs: number;
  /** Number of intervals of this kind. */
  count: number;
  /** True while an interval is still open. */
  running: boolean;
  /** True when any interval crosses a shift boundary. */
  crossesOffShift: boolean;
};

export const EMPTY_ROLLUP: Rollup = {
  businessMs: 0,
  rawMs: 0,
  labourMs: 0,
  count: 0,
  running: false,
  crossesOffShift: false,
};

/** Order intervals the way they happened. */
export function inOrder(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export function ofKind(segments: Segment[], kind: SegmentKind): Segment[] {
  return inOrder(segments.filter((s) => s.kind === kind));
}

/** The interval currently running, if any. */
export function openSegment(
  segments: Segment[],
  kind?: SegmentKind
): Segment | null {
  const open = inOrder(segments).filter(
    (s) => !s.ended_at && (!kind || s.kind === kind)
  );
  return open.length ? open[open.length - 1] : null;
}

/**
 * Crew size for an interval. Uses whoever started it, falling back to whoever
 * ended it, and never drops below one so labour time is never zero for work
 * that plainly happened.
 */
function crewSize(s: Segment): number {
  const n = s.started_by?.length || s.ended_by?.length || 1;
  return Math.max(1, n);
}

/**
 * Add up every interval of one kind. An open interval is measured up to now
 * so the screen can show a live figure, but it is reported through `running`
 * so the dashboard can exclude it from averages.
 */
export function rollup(
  segments: Segment[],
  kind: SegmentKind,
  rules: WorkRules,
  now: string = new Date().toISOString()
): Rollup {
  const list = ofKind(segments, kind);
  if (list.length === 0) return { ...EMPTY_ROLLUP };

  let businessMs = 0;
  let rawMs = 0;
  let labourMs = 0;
  let running = false;
  let crosses = false;

  for (const s of list) {
    const end = s.ended_at ?? now;
    if (!s.ended_at) running = true;
    const span: Span | null = measureSpan(s.started_at, end, rules);
    if (!span) continue;
    businessMs += span.businessMs;
    rawMs += span.rawMs;
    labourMs += span.businessMs * crewSize(s);
    if (span.crossesOffShift) crosses = true;
  }

  return {
    businessMs,
    rawMs,
    labourMs,
    count: list.length,
    running,
    crossesOffShift: crosses,
  };
}

/**
 * How many times work was interrupted. The first queue interval is the normal
 * wait before work starts, so only the ones after it count as interruptions.
 */
export function interruptions(segments: Segment[]): number {
  return Math.max(0, ofKind(segments, "queue").length - 1);
}

/** Everyone who touched this record, in first-seen order. */
export function crewOf(segments: Segment[]): string[] {
  const seen: string[] = [];
  for (const s of inOrder(segments)) {
    for (const id of [...(s.started_by ?? []), ...(s.ended_by ?? [])]) {
      if (id && !seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}

/** Group a flat list of segments by the record they belong to. */
export function byParent(
  segments: Segment[],
  key: "log_id" | "po_log_id"
): Map<string, Segment[]> {
  const map = new Map<string, Segment[]>();
  for (const s of segments) {
    const id = s[key];
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(s);
    map.set(id, list);
  }
  return map;
}
