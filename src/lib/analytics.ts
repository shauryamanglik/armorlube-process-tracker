import {
  isoToPhoenixDate,
  measureSpan,
  phoenixToIso,
  spanValue,
  toHours,
  type Span,
} from "./time";
import { byParent, crewOf, interruptions, rollup } from "./segments";
import type {
  LogRow,
  PoLog,
  Segment,
  SegmentKind,
  Step,
  WorkRules,
} from "./types";

export type Enriched = {
  log: LogRow;
  step: Step | undefined;
  segments: Segment[];
  queue: Span | null;
  process: Span | null;
  queueMs: number;
  processMs: number;
  totalMs: number;
  /** Elapsed multiplied by the crew on each interval. */
  labourMs: number;
  /** How many times the lot was sent back to queue. */
  interruptions: number;
  /** True when a stretch runs past a shift boundary. */
  flagged: boolean;
  incomplete: boolean;
};

export function enrich(
  logs: LogRow[],
  steps: Step[],
  rules: WorkRules,
  includeOffShift: boolean,
  segments: Segment[] = []
): Enriched[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const segsByLog = byParent(segments, "log_id");

  return logs.map((log) => {
    const step = byId.get(log.step_id);
    const segs = segsByLog.get(log.id) ?? [];

    // Records created before intervals existed still carry their original
    // four timestamps, so fall back to those rather than showing zero.
    const useLegacy = segs.length === 0;

    const q = useLegacy ? null : rollup(segs, "queue", rules);
    const p = useLegacy ? null : rollup(segs, "process", rules);

    const queue = useLegacy
      ? measureSpan(log.queue_in, log.queue_out, rules)
      : null;
    const process = useLegacy
      ? measureSpan(log.process_in, log.process_out, rules)
      : null;

    const queueMs = useLegacy
      ? spanValue(queue, includeOffShift)
      : includeOffShift
      ? q!.rawMs
      : q!.businessMs;
    const processMs = useLegacy
      ? spanValue(process, includeOffShift)
      : includeOffShift
      ? p!.rawMs
      : p!.businessMs;

    const wantsQueue = step?.has_queue ?? true;
    const wantsProcess = step?.has_process ?? true;

    const incomplete = useLegacy
      ? (wantsQueue && (!log.queue_in || !log.queue_out)) ||
        (wantsProcess && (!log.process_in || !log.process_out))
      : (wantsQueue && (q!.count === 0 || q!.running)) ||
        (wantsProcess && (p!.count === 0 || p!.running));

    return {
      log,
      step,
      segments: segs,
      queue,
      process,
      queueMs,
      processMs,
      totalMs: queueMs + processMs,
      labourMs: useLegacy ? queueMs + processMs : q!.labourMs + p!.labourMs,
      interruptions: useLegacy ? 0 : interruptions(segs),
      flagged: useLegacy
        ? Boolean(queue?.crossesOffShift || process?.crossesOffShift)
        : q!.crossesOffShift || p!.crossesOffShift,
      incomplete,
    };
  });
}

/** Purchase order records, measured the same way as lots. */
export type EnrichedPo = {
  po: PoLog;
  step: Step | undefined;
  segments: Segment[];
  queueMs: number;
  processMs: number;
  totalMs: number;
  labourMs: number;
  interruptions: number;
  running: boolean;
};

export function enrichPos(
  poLogs: PoLog[],
  steps: Step[],
  rules: WorkRules,
  includeOffShift: boolean,
  segments: Segment[] = []
): EnrichedPo[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const segsByPo = byParent(segments, "po_log_id");

  return poLogs.map((po) => {
    const segs = segsByPo.get(po.id) ?? [];
    const q = rollup(segs, "queue", rules);
    const p = rollup(segs, "process", rules);
    const queueMs = includeOffShift ? q.rawMs : q.businessMs;
    const processMs = includeOffShift ? p.rawMs : p.businessMs;
    return {
      po,
      step: byId.get(po.step_id),
      segments: segs,
      queueMs,
      processMs,
      totalMs: queueMs + processMs,
      labourMs: q.labourMs + p.labourMs,
      interruptions: interruptions(segs),
      running: q.running || p.running,
    };
  });
}

export type Bucket = {
  key: string;
  label: string;
  area: string;
  count: number;
  queueAvg: number;
  processAvg: number;
  totalAvg: number;
  queueTotal: number;
  processTotal: number;
  labourTotal: number;
  interruptionTotal: number;
  flaggedCount: number;
};

function avg(nums: number[]): number {
  const real = nums.filter((n) => n > 0);
  if (real.length === 0) return 0;
  return real.reduce((a, b) => a + b, 0) / real.length;
}

export function bucketBy(
  rows: Enriched[],
  mode: "step" | "area"
): Bucket[] {
  const groups = new Map<string, Enriched[]>();

  for (const r of rows) {
    const key =
      mode === "step"
        ? r.step?.step_name ?? "Unknown step"
        : r.step?.area ?? "Unknown area";
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const out: Bucket[] = [];
  for (const [key, list] of groups) {
    const queues = list.map((r) => r.queueMs);
    const processes = list.map((r) => r.processMs);
    out.push({
      key,
      label: key,
      area: list[0]?.step?.area ?? "",
      count: list.length,
      queueAvg: avg(queues),
      processAvg: avg(processes),
      totalAvg: avg(list.map((r) => r.totalMs)),
      queueTotal: queues.reduce((a, b) => a + b, 0),
      processTotal: processes.reduce((a, b) => a + b, 0),
      labourTotal: list.reduce((a, r) => a + r.labourMs, 0),
      interruptionTotal: list.reduce((a, r) => a + r.interruptions, 0),
      flaggedCount: list.filter((r) => r.flagged).length,
    });
  }

  if (mode === "step") {
    const order = new Map(rows.map((r) => [r.step?.step_name, r.step?.sort_order ?? 99]));
    out.sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  } else {
    out.sort((a, b) => a.key.localeCompare(b.key));
  }

  return out;
}

export type TrendPoint = {
  date: string;
  queue: number;
  process: number;
  count: number;
};

export function trendByDay(rows: Enriched[]): TrendPoint[] {
  const groups = new Map<string, Enriched[]>();
  for (const r of rows) {
    const list = groups.get(r.log.log_date) ?? [];
    list.push(r);
    groups.set(r.log.log_date, list);
  }
  return Array.from(groups.entries())
    .map(([date, list]) => ({
      date,
      queue: avg(list.map((r) => r.queueMs)),
      process: avg(list.map((r) => r.processMs)),
      count: list.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Lots ranked by total time across every step they touched. */
export type LotSummary = {
  lot: string;
  steps: number;
  queueMs: number;
  processMs: number;
  totalMs: number;
  flagged: boolean;
};

export function summariseLots(rows: Enriched[]): LotSummary[] {
  const groups = new Map<string, Enriched[]>();
  for (const r of rows) {
    const list = groups.get(r.log.lot_id) ?? [];
    list.push(r);
    groups.set(r.log.lot_id, list);
  }
  return Array.from(groups.entries())
    .map(([lot, list]) => ({
      lot,
      steps: list.length,
      queueMs: list.reduce((a, r) => a + r.queueMs, 0),
      processMs: list.reduce((a, r) => a + r.processMs, 0),
      totalMs: list.reduce((a, r) => a + r.totalMs, 0),
      flagged: list.some((r) => r.flagged),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

/**
 * Steps a lot passed over. Derived rather than stored: if a lot has records
 * at step 2 and step 6 but nothing between, those steps were skipped.
 */
export type SkipCount = { step: string; skipped: number; area: string };

export function skippedSteps(rows: Enriched[], steps: Step[]): SkipCount[] {
  const ordered = [...steps].sort((a, b) => a.sort_order - b.sort_order);
  const byLot = new Map<string, Set<number>>();

  for (const r of rows) {
    if (!r.step) continue;
    const set = byLot.get(r.log.lot_id) ?? new Set<number>();
    set.add(r.step.sort_order);
    byLot.set(r.log.lot_id, set);
  }

  const counts = new Map<number, number>();
  for (const touched of byLot.values()) {
    if (touched.size === 0) continue;
    const lo = Math.min(...touched);
    const hi = Math.max(...touched);
    for (const s of ordered) {
      if (s.sort_order > lo && s.sort_order < hi && !touched.has(s.sort_order)) {
        counts.set(s.sort_order, (counts.get(s.sort_order) ?? 0) + 1);
      }
    }
  }

  return ordered
    .map((s) => ({
      step: s.step_name,
      area: s.area,
      skipped: counts.get(s.sort_order) ?? 0,
    }))
    .filter((c) => c.skipped > 0);
}

/** Lots that went round more than once. */
export function reworkCount(rows: Enriched[]): number {
  return new Set(
    rows.filter((r) => r.log.pass_no > 1).map((r) => r.log.lot_id)
  ).size;
}

export function toCsv(rows: Enriched[], opNames: Map<string, string>): string {
  const name = (id: string | null) => (id ? opNames.get(id) ?? "" : "");
  const head = [
    "Lot",
    "Pass",
    "Area",
    "Step",
    "Date",
    "Blast type",
    "Queue in",
    "Queue in by",
    "Queue out",
    "Queue out by",
    "Process in",
    "Process in by",
    "Process out",
    "Process out by",
    "Queue hours",
    "Process hours",
    "Total hours",
    "Labour hours",
    "Times sent back to queue",
    "Crew",
    "Crosses off shift",
    "Incomplete",
    "Notes",
  ];

  const lines = rows.map((r) =>
    [
      r.log.lot_id,
      r.log.pass_no,
      r.step?.area ?? "",
      r.step?.step_name ?? "",
      r.log.log_date,
      r.log.blast_type ?? "",
      r.log.queue_in ?? "",
      name(r.log.queue_in_by),
      r.log.queue_out ?? "",
      name(r.log.queue_out_by),
      r.log.process_in ?? "",
      name(r.log.process_in_by),
      r.log.process_out ?? "",
      name(r.log.process_out_by),
      (r.queueMs / 3600000).toFixed(2),
      (r.processMs / 3600000).toFixed(2),
      (r.totalMs / 3600000).toFixed(2),
      (r.labourMs / 3600000).toFixed(2),
      r.interruptions,
      crewOf(r.segments).map(name).filter(Boolean).join(" / "),
      r.flagged ? "yes" : "no",
      r.incomplete ? "yes" : "no",
      (r.log.notes ?? "").replace(/"/g, '""'),
    ]
      .map((c) => `"${String(c)}"`)
      .join(",")
  );

  return [head.join(","), ...lines].join("\n");
}


// ============================================================
// Day by day series
// ============================================================

export type Metric = "queue" | "process" | "total" | "labour";
export type Aggregate = "avg" | "sum";

export const METRIC_LABEL: Record<Metric, string> = {
  queue: "Queue time",
  process: "Process time",
  total: "Queue plus process",
  labour: "Labour hours",
};

function pick(r: Enriched, m: Metric): number {
  if (m === "queue") return r.queueMs;
  if (m === "process") return r.processMs;
  if (m === "labour") return r.labourMs;
  return r.totalMs;
}

function pickPo(r: EnrichedPo, m: Metric): number {
  if (m === "queue") return r.queueMs;
  if (m === "process") return r.processMs;
  if (m === "labour") return r.labourMs;
  return r.totalMs;
}

function combine(values: number[], how: Aggregate): number {
  const real = values.filter((v) => v > 0);
  if (real.length === 0) return 0;
  const total = real.reduce((a, b) => a + b, 0);
  return how === "sum" ? total : total / real.length;
}

/**
 * One row per day, one column per step. Keeps every day separate rather than
 * collapsing the range into a single figure, so a run of slow days is visible
 * rather than averaged away.
 */
export type DayRow = { date: string; [series: string]: string | number };

export function dailySeries(
  rows: Enriched[],
  keyOf: (r: Enriched) => string | undefined,
  metric: Metric,
  how: Aggregate
): { data: DayRow[]; series: string[] } {
  const days = new Map<string, Map<string, number[]>>();
  const seriesSeen = new Set<string>();

  for (const r of rows) {
    const key = keyOf(r);
    if (!key) continue;
    const value = pick(r, metric);
    if (value <= 0) continue;
    seriesSeen.add(key);
    const day = days.get(r.log.log_date) ?? new Map<string, number[]>();
    const list = day.get(key) ?? [];
    list.push(value);
    day.set(key, list);
    days.set(r.log.log_date, day);
  }

  const series = Array.from(seriesSeen);
  const data: DayRow[] = Array.from(days.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, byKey]) => {
      const row: DayRow = { date };
      for (const k of series) {
        row[k] = toHours(combine(byKey.get(k) ?? [], how));
      }
      return row;
    });

  return { data, series };
}

/** Same shape for purchase orders, keyed by station. */
export function dailySeriesPo(
  rows: EnrichedPo[],
  metric: Metric,
  how: Aggregate
): { data: DayRow[]; series: string[] } {
  const days = new Map<string, Map<string, number[]>>();
  const seriesSeen = new Set<string>();

  for (const r of rows) {
    const key = r.step?.step_name;
    if (!key) continue;
    const value = pickPo(r, metric);
    if (value <= 0) continue;
    seriesSeen.add(key);
    const day = days.get(r.po.log_date) ?? new Map<string, number[]>();
    const list = day.get(key) ?? [];
    list.push(value);
    day.set(key, list);
    days.set(r.po.log_date, day);
  }

  const series = Array.from(seriesSeen);
  const data: DayRow[] = Array.from(days.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, byKey]) => {
      const row: DayRow = { date };
      for (const k of series) row[k] = toHours(combine(byKey.get(k) ?? [], how));
      return row;
    });

  return { data, series };
}

/** Queue against process for one day, so the split is visible per day. */
export function dailySplit(rows: Enriched[], how: Aggregate): DayRow[] {
  const days = new Map<string, { q: number[]; p: number[] }>();
  for (const r of rows) {
    const d = days.get(r.log.log_date) ?? { q: [], p: [] };
    if (r.queueMs > 0) d.q.push(r.queueMs);
    if (r.processMs > 0) d.p.push(r.processMs);
    days.set(r.log.log_date, d);
  }
  return Array.from(days.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, d]) => ({
      date,
      Queue: toHours(combine(d.q, how)),
      Process: toHours(combine(d.p, how)),
    }));
}

/** Lots finished per day, from records at the step that ends the line. */
export function throughputByDay(rows: Enriched[]): DayRow[] {
  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.step?.is_final) continue;
    if (r.incomplete) continue;
    const set = days.get(r.log.log_date) ?? new Set<string>();
    set.add(r.log.lot_id);
    days.set(r.log.log_date, set);
  }
  return Array.from(days.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, set]) => ({ date, Lots: set.size }));
}

/** How often work is interrupted at each step. */
export function interruptionsByStep(rows: Enriched[]): DayRow[] {
  const byStep = new Map<string, { total: number; records: number }>();
  for (const r of rows) {
    const k = r.step?.step_name;
    if (!k) continue;
    const cur = byStep.get(k) ?? { total: 0, records: 0 };
    cur.total += r.interruptions;
    cur.records += 1;
    byStep.set(k, cur);
  }
  return Array.from(byStep.entries())
    .filter(([, v]) => v.total > 0)
    .map(([name, v]) => ({
      date: name,
      "Times sent back": v.total,
      "Per record": Math.round((v.total / v.records) * 100) / 100,
    }));
}

/** Per purchase order totals across every station it touched. */
export type PoSummary = {
  po: string;
  stations: number;
  queueMs: number;
  processMs: number;
  totalMs: number;
  labourMs: number;
  interruptions: number;
  running: boolean;
};

export function summarisePos(rows: EnrichedPo[]): PoSummary[] {
  const groups = new Map<string, EnrichedPo[]>();
  for (const r of rows) {
    const list = groups.get(r.po.po_number) ?? [];
    list.push(r);
    groups.set(r.po.po_number, list);
  }
  return Array.from(groups.entries())
    .map(([po, list]) => ({
      po,
      stations: list.length,
      queueMs: list.reduce((a, r) => a + r.queueMs, 0),
      processMs: list.reduce((a, r) => a + r.processMs, 0),
      totalMs: list.reduce((a, r) => a + r.totalMs, 0),
      labourMs: list.reduce((a, r) => a + r.labourMs, 0),
      interruptions: list.reduce((a, r) => a + r.interruptions, 0),
      running: list.some((r) => r.running),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function toPoCsv(
  rows: EnrichedPo[],
  opNames: Map<string, string>
): string {
  const head = [
    "PO",
    "Station",
    "Date",
    "Queue hours",
    "Process hours",
    "Total hours",
    "Labour hours",
    "Times sent back",
    "Crew",
    "State",
  ];
  const lines = rows.map((r) =>
    [
      r.po.po_number,
      r.step?.step_name ?? "",
      r.po.log_date,
      (r.queueMs / 3600000).toFixed(2),
      (r.processMs / 3600000).toFixed(2),
      (r.totalMs / 3600000).toFixed(2),
      (r.labourMs / 3600000).toFixed(2),
      r.interruptions,
      crewOf(r.segments)
        .map((id) => opNames.get(id) ?? "")
        .filter(Boolean)
        .join(" / "),
      r.po.deleted_at ? "deleted" : r.running ? "running" : "done",
    ]
      .map((c) => `"${String(c)}"`)
      .join(",")
  );
  return [head.join(","), ...lines].join("\n");
}

// ============================================================
// Further breakdowns
// ============================================================

/**
 * Hours per person, attributed stretch by stretch.
 *
 * Crews change within a record: one person can wait with a lot alone and be
 * joined by two more once work starts. Splitting a record's total across
 * everyone who ever touched it would credit the wrong people, so each
 * interval is divided only among the crew who were actually on it.
 */
export function operatorHours(
  rows: Enriched[],
  poRows: EnrichedPo[],
  opNames: Map<string, string>,
  rules: WorkRules,
  includeOffShift = false
): DayRow[] {
  const tally = new Map<string, { queue: number; process: number }>();
  const now = new Date().toISOString();

  const creditSegments = (segments: Segment[]) => {
    for (const seg of segments) {
      const crew = [
        ...new Set([...(seg.started_by ?? []), ...(seg.ended_by ?? [])]),
      ].filter(Boolean);
      if (crew.length === 0) continue;

      const span = measureSpan(seg.started_at, seg.ended_at ?? now, rules);
      if (!span) continue;
      const ms = includeOffShift ? span.rawMs : span.businessMs;
      if (ms <= 0) continue;

      const each = ms / crew.length;
      for (const id of crew) {
        const cur = tally.get(id) ?? { queue: 0, process: 0 };
        if (seg.kind === "queue") cur.queue += each;
        else cur.process += each;
        tally.set(id, cur);
      }
    }
  };

  for (const r of rows) creditSegments(r.segments);
  for (const r of poRows) creditSegments(r.segments);

  return Array.from(tally.entries())
    .map(([id, v]) => ({
      date: opNames.get(id) ?? "Unknown",
      Queue: toHours(v.queue),
      Process: toHours(v.process),
    }))
    .sort(
      (a, b) =>
        Number(b.Queue) + Number(b.Process) - (Number(a.Queue) + Number(a.Process))
    );
}

/** What share of time at each step is waiting rather than working. */
export function waitShare(buckets: Bucket[]): DayRow[] {
  return buckets
    .filter((b) => b.queueTotal + b.processTotal > 0)
    .map((b) => {
      const total = b.queueTotal + b.processTotal;
      return {
        date: b.label,
        "Waiting %": Math.round((b.queueTotal / total) * 1000) / 10,
        "Working %": Math.round((b.processTotal / total) * 1000) / 10,
      };
    });
}

/** Manual against automatic blasting. */
export function blastComparison(rows: Enriched[]): DayRow[] {
  const kinds = ["Manual Blasting", "Auto Blasting"];
  const out: DayRow[] = [];
  for (const k of kinds) {
    const list = rows.filter((r) => r.log.blast_type === k);
    if (list.length === 0) continue;
    const mean = (v: number[]) => {
      const real = v.filter((x) => x > 0);
      return real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
    };
    out.push({
      date: k.replace(" Blasting", ""),
      Queue: toHours(mean(list.map((r) => r.queueMs))),
      Process: toHours(mean(list.map((r) => r.processMs))),
      Lots: list.length,
    });
  }
  return out;
}

/** Slowest lots overall, for chasing down outliers. */
export function slowestLots(rows: Enriched[], limit = 20): DayRow[] {
  return summariseLots(rows)
    .slice(0, limit)
    .map((l) => ({
      date: l.lot,
      Queue: toHours(l.queueMs),
      Process: toHours(l.processMs),
    }));
}

/** Does the day of the week matter. */
export function byWeekday(rows: Enriched[]): DayRow[] {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const tally = new Map<number, { q: number[]; p: number[] }>();
  for (const r of rows) {
    const [y, m, d] = r.log.log_date.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const cur = tally.get(day) ?? { q: [], p: [] };
    if (r.queueMs > 0) cur.q.push(r.queueMs);
    if (r.processMs > 0) cur.p.push(r.processMs);
    tally.set(day, cur);
  }
  const mean = (v: number[]) =>
    v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => tally.has(d))
    .map((d) => ({
      date: names[d].slice(0, 3),
      Queue: toHours(mean(tally.get(d)!.q)),
      Process: toHours(mean(tally.get(d)!.p)),
    }));
}

/**
 * Orders shipped per day, counted on the day the final station finished.
 * An order that cleared incoming but has not shipped is not counted.
 */
export function poThroughputByDay(
  rows: EnrichedPo[],
  steps: Step[]
): DayRow[] {
  const stations = poStations(steps);
  const last = stations[stations.length - 1];
  if (!last) return [];

  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.step?.id !== last.id) continue;
    const closed = r.segments
      .filter((sg) => sg.kind === "process" && sg.ended_at)
      .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))[0];
    if (!closed || r.running) continue;
    const day = isoToPhoenixDate(closed.ended_at!);
    const set = days.get(day) ?? new Set<string>();
    set.add(r.po.po_number);
    days.set(day, set);
  }

  return Array.from(days.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, set]) => ({ date, "Orders shipped": set.size }));
}

/** Waiting against working per purchase order station. */
export function poWaitShare(rows: EnrichedPo[]): DayRow[] {
  const byStation = new Map<string, { q: number; p: number }>();
  for (const r of rows) {
    const k = r.step?.step_name;
    if (!k) continue;
    const cur = byStation.get(k) ?? { q: 0, p: 0 };
    cur.q += r.queueMs;
    cur.p += r.processMs;
    byStation.set(k, cur);
  }
  return Array.from(byStation.entries())
    .filter(([, v]) => v.q + v.p > 0)
    .map(([name, v]) => ({
      date: name,
      "Waiting %": Math.round((v.q / (v.q + v.p)) * 1000) / 10,
      "Working %": Math.round((v.p / (v.q + v.p)) * 1000) / 10,
    }));
}

/** Per station averages for purchase orders. */
export function poByStation(rows: EnrichedPo[]): DayRow[] {
  const byStation = new Map<string, EnrichedPo[]>();
  for (const r of rows) {
    const k = r.step?.step_name;
    if (!k) continue;
    const list = byStation.get(k) ?? [];
    list.push(r);
    byStation.set(k, list);
  }
  const mean = (v: number[]) => {
    const real = v.filter((x) => x > 0);
    return real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
  };
  return Array.from(byStation.entries()).map(([name, list]) => ({
    date: name,
    Queue: toHours(mean(list.map((r) => r.queueMs))),
    Process: toHours(mean(list.map((r) => r.processMs))),
    Orders: list.length,
  }));
}

/** Slowest purchase orders. */
export function slowestPos(rows: EnrichedPo[], limit = 20): DayRow[] {
  return summarisePos(rows)
    .slice(0, limit)
    .map((p) => ({
      date: p.po,
      Queue: toHours(p.queueMs),
      Process: toHours(p.processMs),
    }));
}

// ============================================================
// Lot and order state, and skips
// ============================================================

/**
 * Skipping the first and last stations is normal rather than an exception.
 * A lot is created at incoming and never goes to oil and shipping, because
 * by then it has been split back into orders.
 */
function countsForSkips(step: Step): boolean {
  return (
    step.active !== false &&
    step.tracks_lots !== false &&
    !step.is_entry &&
    !step.tracks_po
  );
}

export type LotStatus = {
  lot: string;
  live: boolean;
  step: string;
  area: string;
  sortOrder: number;
  state: "In queue" | "In process" | "Waiting to move" | "Finished";
  since: string | null;
  pass: number;
  skipped: string[];
  interruptions: number;
  queueMs: number;
  processMs: number;
  totalMs: number;
  records: Enriched[];
};

/** Where every lot is, what it is doing, and what it passed over. */
export function lotStatuses(rows: Enriched[], steps: Step[]): LotStatus[] {
  const skipCandidates = steps.filter(countsForSkips);
  const byLot = new Map<string, Enriched[]>();
  for (const r of rows) {
    const list = byLot.get(r.log.lot_id) ?? [];
    list.push(r);
    byLot.set(r.log.lot_id, list);
  }

  return Array.from(byLot.entries())
    .map(([lot, list]) => {
      const pass = Math.max(...list.map((r) => r.log.pass_no));
      const current = list
        .filter((r) => r.log.pass_no === pass)
        .sort((a, b) => (b.step?.sort_order ?? 0) - (a.step?.sort_order ?? 0))[0];

      const segs = current?.segments ?? [];
      const openQueue = segs.find((s) => s.kind === "queue" && !s.ended_at);
      const openProcess = segs.find((s) => s.kind === "process" && !s.ended_at);
      const finishedHere = current?.step?.is_final && segs.some(
        (s) => s.kind === "process" && s.ended_at
      );

      const state: LotStatus["state"] = openProcess
        ? "In process"
        : openQueue
        ? "In queue"
        : finishedHere
        ? "Finished"
        : "Waiting to move";

      const touched = new Set(
        list.map((r) => r.step?.sort_order).filter(Boolean) as number[]
      );
      const highest = Math.max(...Array.from(touched), 0);
      const skipped = skipCandidates
        .filter((s) => s.sort_order < highest && !touched.has(s.sort_order))
        .map((s) => s.step_name);

      return {
        lot,
        live: !finishedHere,
        step: current?.step?.step_name ?? "Unknown",
        area: current?.step?.area ?? "",
        sortOrder: current?.step?.sort_order ?? 0,
        state,
        since:
          openProcess?.started_at ??
          openQueue?.started_at ??
          current?.log.updated_at ??
          null,
        pass,
        skipped,
        interruptions: list.reduce((a, r) => a + r.interruptions, 0),
        queueMs: list.reduce((a, r) => a + r.queueMs, 0),
        processMs: list.reduce((a, r) => a + r.processMs, 0),
        totalMs: list.reduce((a, r) => a + r.totalMs, 0),
        records: list.sort(
          (a, b) => (a.step?.sort_order ?? 0) - (b.step?.sort_order ?? 0)
        ),
      };
    })
    .sort((a, b) => a.lot.localeCompare(b.lot));
}

export type PoStatus = {
  po: string;
  /** Still on the books. Only a closed process at the last station ends it. */
  live: boolean;
  station: string;
  state:
    | "In queue"
    | "In process"
    | "Awaiting next station"
    | "Not started"
    | "Completed";
  since: string | null;
  /** Stations the order was never logged at, before one it reached. */
  skipped: string[];
  /** True once the final station has a closed process stretch. */
  shipped: boolean;
  queueMs: number;
  processMs: number;
  totalMs: number;
  labourMs: number;
  interruptions: number;
  records: EnrichedPo[];
};

/** The stations an order passes through, in order. */
export function poStations(steps: Step[]): Step[] {
  return steps
    .filter((s) => s.active !== false && s.tracks_po)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * An order is not finished when the paperwork at incoming is done. It runs
 * until the last station, oil and shipping, records a process out. Anything
 * before that is still in progress, even when no timer happens to be running.
 */
export function poStatuses(rows: EnrichedPo[], steps: Step[]): PoStatus[] {
  const stations = poStations(steps);
  const lastStation = stations[stations.length - 1];

  const byPo = new Map<string, EnrichedPo[]>();
  for (const r of rows) {
    const list = byPo.get(r.po.po_number) ?? [];
    list.push(r);
    byPo.set(r.po.po_number, list);
  }

  return Array.from(byPo.entries())
    .map(([po, list]) => {
      const ordered = [...list].sort(
        (a, b) => (a.step?.sort_order ?? 0) - (b.step?.sort_order ?? 0)
      );
      const current = ordered[ordered.length - 1];

      // Shipped means the final station finished its work.
      const atLast = lastStation
        ? ordered.find((r) => r.step?.id === lastStation.id)
        : undefined;
      const shipped = Boolean(
        atLast?.segments.some((sg) => sg.kind === "process" && sg.ended_at) &&
          !atLast?.running
      );

      const openQueue = current?.segments.find(
        (sg) => sg.kind === "queue" && !sg.ended_at
      );
      const openProcess = current?.segments.find(
        (sg) => sg.kind === "process" && !sg.ended_at
      );

      const state: PoStatus["state"] = shipped
        ? "Completed"
        : openProcess
        ? "In process"
        : openQueue
        ? "In queue"
        : ordered.some((r) => r.segments.length > 0)
        ? "Awaiting next station"
        : "Not started";

      const touched = new Set(
        ordered.map((r) => r.step?.sort_order).filter(Boolean) as number[]
      );
      const highest = Math.max(...Array.from(touched), 0);
      const skipped = stations
        .filter((st) => st.sort_order < highest && !touched.has(st.sort_order))
        .map((st) => st.step_name);

      return {
        po,
        live: !shipped,
        station: current?.step?.step_name ?? "Unknown",
        state,
        since:
          openProcess?.started_at ??
          openQueue?.started_at ??
          current?.po.updated_at ??
          null,
        skipped,
        shipped,
        queueMs: list.reduce((a, r) => a + r.queueMs, 0),
        processMs: list.reduce((a, r) => a + r.processMs, 0),
        totalMs: list.reduce((a, r) => a + r.totalMs, 0),
        labourMs: list.reduce((a, r) => a + r.labourMs, 0),
        interruptions: list.reduce((a, r) => a + r.interruptions, 0),
        records: ordered,
      };
    })
    .sort((a, b) => a.po.localeCompare(b.po));
}

/** Warnings worth surfacing on a record. */
export function warningsFor(r: Enriched): string[] {
  const out: string[] = [];
  if (r.incomplete) out.push("A timestamp is missing, so this time is partial");
  if (r.flagged) out.push("A stretch runs past a shift boundary");
  if (r.log.pass_no > 1) out.push(`Rework, this is pass ${r.log.pass_no}`);
  if (r.interruptions > 0)
    out.push(
      `Sent back to queue ${r.interruptions} ${
        r.interruptions === 1 ? "time" : "times"
      }`
    );
  if (r.step?.has_blast_type && !r.log.blast_type)
    out.push("Blast type was never recorded");
  if (r.log.deleted_at) out.push("This record was deleted");
  return out;
}

// ============================================================
// Live floor view
// ============================================================

export type FloorItem = {
  /** Lot number or PO number. */
  ref: string;
  /** Step or station it is sitting at. */
  step: string;
  /** How long it has been there, or how long it was there. */
  ms: number;
  running: boolean;
  startedAt: string;
  endedAt: string | null;
  crew: string[];
};

export type FloorGroup = {
  name: string;
  items: FloorItem[];
  runningCount: number;
  doneCount: number;
};

/** Phoenix day bounds as real instants. */
function dayBounds(day: string): { from: number; to: number } {
  const from = new Date(phoenixToIso(day, "00:00")).getTime();
  return { from, to: from + 24 * 3600 * 1000 };
}

/**
 * A stretch belongs to a day if any part of it happened that day. A lot that
 * queued overnight still matters this morning, so it is shown rather than
 * dropped for having started yesterday.
 */
function touchesDay(seg: Segment, from: number, to: number, now: number): boolean {
  const s = new Date(seg.started_at).getTime();
  const e = seg.ended_at ? new Date(seg.ended_at).getTime() : now;
  return s < to && e >= from;
}

/**
 * What is on the floor, grouped for the live board. Each item is one stretch,
 * so a lot sent back to queue twice shows twice, which is the truth of what
 * the floor looks like.
 */
export function floorView(
  rows: Enriched[],
  kind: SegmentKind,
  day: string,
  rules: WorkRules,
  includeOffShift: boolean,
  groupBy: "area" | "step" = "area"
): FloorGroup[] {
  const { from, to } = dayBounds(day);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const groups = new Map<string, FloorItem[]>();

  for (const r of rows) {
    if (!r.step) continue;
    const key = groupBy === "area" ? r.step.area : r.step.step_name;

    for (const seg of r.segments) {
      if (seg.kind !== kind) continue;
      if (!touchesDay(seg, from, to, now)) continue;

      const span = measureSpan(seg.started_at, seg.ended_at ?? nowIso, rules);
      if (!span) continue;

      const list = groups.get(key) ?? [];
      list.push({
        ref: r.log.lot_id,
        step: r.step.step_name,
        ms: includeOffShift ? span.rawMs : span.businessMs,
        running: !seg.ended_at,
        startedAt: seg.started_at,
        endedAt: seg.ended_at,
        crew: [...new Set([...(seg.started_by ?? []), ...(seg.ended_by ?? [])])],
      });
      groups.set(key, list);
    }
  }

  return Array.from(groups.entries())
    .map(([name, items]) => ({
      name,
      // Running first, then longest, so the things that need attention are
      // at the top of every column.
      items: items.sort((a, b) => {
        if (a.running !== b.running) return a.running ? -1 : 1;
        return b.ms - a.ms;
      }),
      runningCount: items.filter((i) => i.running).length,
      doneCount: items.filter((i) => !i.running).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The same board for purchase orders, grouped by station. */
export function floorViewPo(
  rows: EnrichedPo[],
  kind: SegmentKind,
  day: string,
  rules: WorkRules,
  includeOffShift: boolean
): FloorGroup[] {
  const { from, to } = dayBounds(day);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const groups = new Map<string, FloorItem[]>();

  for (const r of rows) {
    if (!r.step) continue;
    for (const seg of r.segments) {
      if (seg.kind !== kind) continue;
      if (!touchesDay(seg, from, to, now)) continue;
      const span = measureSpan(seg.started_at, seg.ended_at ?? nowIso, rules);
      if (!span) continue;
      const list = groups.get(r.step.step_name) ?? [];
      list.push({
        ref: r.po.po_number,
        step: r.step.step_name,
        ms: includeOffShift ? span.rawMs : span.businessMs,
        running: !seg.ended_at,
        startedAt: seg.started_at,
        endedAt: seg.ended_at,
        crew: [...new Set([...(seg.started_by ?? []), ...(seg.ended_by ?? [])])],
      });
      groups.set(r.step.step_name, list);
    }
  }

  return Array.from(groups.entries())
    .map(([name, items]) => ({
      name,
      items: items.sort((a, b) => {
        if (a.running !== b.running) return a.running ? -1 : 1;
        return b.ms - a.ms;
      }),
      runningCount: items.filter((i) => i.running).length,
      doneCount: items.filter((i) => !i.running).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Make sure every area shows, even the empty ones, so the board keeps shape. */
export function padGroups(groups: FloorGroup[], names: string[]): FloorGroup[] {
  const have = new Map(groups.map((g) => [g.name, g]));
  return names.map(
    (n) =>
      have.get(n) ?? { name: n, items: [], runningCount: 0, doneCount: 0 }
  );
}
