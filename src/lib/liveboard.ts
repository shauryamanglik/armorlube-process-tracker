import { measureSpan } from "./time";
import { isoToPhoenixDate } from "./time";
import type { Enriched, EnrichedPo } from "./analytics";
import type { Segment, SegmentKind, Step, WorkRules } from "./types";

/**
 * The floor board answers one question: what is sitting where right now, and
 * how long has it been there. It is deliberately a day at a time, because a
 * board covering a week tells you nothing about what to go and look at.
 */

/**
 * What each area is called on the board. The database stores "Area 1" and so
 * on, which means nothing to someone walking past a screen, so the board uses
 * the name of the work that happens there.
 */
export const AREA_LABELS: Record<string, string> = {
  "Area 1": "Degreasing",
  "Area 2": "Blasting",
  "Area 3": "Washing",
  "Area 4": "Coating",
  "Area 5": "Defixturing & Inspection",
};

/** What each purchase order station is called on the board. */
export const STATION_LABELS: Record<string, string> = {
  "Incoming Inspection": "Incoming Inspection",
  "Oil/Shipping": "Final Inspection",
};

export function areaLabel(area: string): string {
  return AREA_LABELS[area] ?? area;
}

export function stationLabel(step: string): string {
  return STATION_LABELS[step] ?? step;
}

export type LiveBar = {
  /** Lot number or PO number. */
  ref: string;
  /** Working-hours milliseconds spent in this area on this day. */
  ms: number;
  /** True while a stretch is still open. */
  live: boolean;
  /** The step inside the area, for the tooltip. */
  step: string;
  /** When the current or last stretch began. */
  since: string | null;
};

export type LiveArea = {
  area: string;
  bars: LiveBar[];
  liveCount: number;
  doneCount: number;
};

/** A stretch counts for a day if any part of it falls on that day. */
function touchesDay(seg: Segment, day: string, now: string): boolean {
  const start = isoToPhoenixDate(seg.started_at);
  const end = isoToPhoenixDate(seg.ended_at ?? now);
  return start <= day && end >= day;
}

function sumFor(
  segs: Segment[],
  kind: SegmentKind,
  day: string,
  rules: WorkRules,
  includeOffShift: boolean,
  now: string
): { ms: number; live: boolean; since: string | null } {
  let ms = 0;
  let live = false;
  let since: string | null = null;

  for (const s of segs) {
    if (s.kind !== kind) continue;
    if (!touchesDay(s, day, now)) continue;
    const span = measureSpan(s.started_at, s.ended_at ?? now, rules);
    if (span) ms += includeOffShift ? span.rawMs : span.businessMs;
    if (!s.ended_at) {
      live = true;
      since = s.started_at;
    } else if (!since || s.started_at > since) {
      since = s.started_at;
    }
  }
  return { ms, live, since };
}

/**
 * Lots grouped by area for one kind of time. A lot appears once per area, with
 * its stretches at every step in that area added together, because the board
 * is about where work is piling up rather than which exact bench it is on.
 */
export function lotBoard(
  rows: Enriched[],
  steps: Step[],
  day: string,
  kind: SegmentKind,
  rules: WorkRules,
  includeOffShift: boolean,
  now: string = new Date().toISOString()
): LiveArea[] {
  const areas = Array.from(
    new Set(
      steps
        .filter((s) => s.active !== false && s.tracks_lots !== false)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => s.area)
    )
  );

  const byArea = new Map<string, Map<string, LiveBar>>();

  for (const r of rows) {
    const area = r.step?.area;
    if (!area) continue;
    if (r.step?.tracks_lots === false) continue;

    const { ms, live, since } = sumFor(
      r.segments,
      kind,
      day,
      rules,
      includeOffShift,
      now
    );
    if (ms <= 0 && !live) continue;

    const forArea = byArea.get(area) ?? new Map<string, LiveBar>();
    const existing = forArea.get(r.log.lot_id);
    if (existing) {
      existing.ms += ms;
      existing.live = existing.live || live;
      if (since && (!existing.since || since > existing.since))
        existing.since = since;
    } else {
      forArea.set(r.log.lot_id, {
        ref: r.log.lot_id,
        ms,
        live,
        step: r.step?.step_name ?? "",
        since,
      });
    }
    byArea.set(area, forArea);
  }

  return areas.map((area) => {
    const bars = Array.from(byArea.get(area)?.values() ?? []).sort((a, b) => {
      // Running work first, then longest, so the board reads top down by
      // what most needs attention.
      if (a.live !== b.live) return a.live ? -1 : 1;
      return b.ms - a.ms;
    });
    return {
      area: areaLabel(area),
      bars,
      liveCount: bars.filter((b) => b.live).length,
      doneCount: bars.filter((b) => !b.live).length,
    };
  });
}

/** The same board for purchase orders, grouped by station. */
export function poBoard(
  rows: EnrichedPo[],
  steps: Step[],
  day: string,
  kind: SegmentKind,
  rules: WorkRules,
  includeOffShift: boolean,
  now: string = new Date().toISOString()
): LiveArea[] {
  const stations = steps
    .filter((s) => s.tracks_po && s.active !== false)
    .sort((a, b) => a.sort_order - b.sort_order);

  const byStation = new Map<string, Map<string, LiveBar>>();

  for (const r of rows) {
    const name = r.step?.step_name;
    if (!name) continue;
    const { ms, live, since } = sumFor(
      r.segments,
      kind,
      day,
      rules,
      includeOffShift,
      now
    );
    if (ms <= 0 && !live) continue;

    const forStation = byStation.get(name) ?? new Map<string, LiveBar>();
    const existing = forStation.get(r.po.po_number);
    if (existing) {
      existing.ms += ms;
      existing.live = existing.live || live;
    } else {
      forStation.set(r.po.po_number, {
        ref: r.po.po_number,
        ms,
        live,
        step: name,
        since,
      });
    }
    byStation.set(name, forStation);
  }

  return stations.map((st) => {
    const bars = Array.from(byStation.get(st.step_name)?.values() ?? []).sort(
      (a, b) => {
        if (a.live !== b.live) return a.live ? -1 : 1;
        return b.ms - a.ms;
      }
    );
    return {
      area: stationLabel(st.step_name),
      bars,
      liveCount: bars.filter((b) => b.live).length,
      doneCount: bars.filter((b) => !b.live).length,
    };
  });
}

/** Longest bar on the board, so every column shares one scale. */
export function boardMax(areas: LiveArea[]): number {
  let max = 0;
  for (const a of areas) for (const b of a.bars) if (b.ms > max) max = b.ms;
  return max || 1;
}
