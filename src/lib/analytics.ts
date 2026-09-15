import { measureSpan, spanValue, type Span } from "./time";
import type { LogRow, Step, WorkRules } from "./types";

export type Enriched = {
  log: LogRow;
  step: Step | undefined;
  queue: Span | null;
  process: Span | null;
  queueMs: number;
  processMs: number;
  totalMs: number;
  /** True when either span runs past a shift boundary. */
  flagged: boolean;
  incomplete: boolean;
};

export function enrich(
  logs: LogRow[],
  steps: Step[],
  rules: WorkRules,
  includeOffShift: boolean
): Enriched[] {
  const byId = new Map(steps.map((s) => [s.id, s]));

  return logs.map((log) => {
    const step = byId.get(log.step_id);
    const queue = measureSpan(log.queue_in, log.queue_out, rules);
    const process = measureSpan(log.process_in, log.process_out, rules);

    const queueMs = spanValue(queue, includeOffShift);
    const processMs = spanValue(process, includeOffShift);

    const wantsQueue = step?.has_queue ?? true;
    const wantsProcess = step?.has_process ?? true;

    const incomplete =
      (wantsQueue && (!log.queue_in || !log.queue_out)) ||
      (wantsProcess && (!log.process_in || !log.process_out));

    return {
      log,
      step,
      queue,
      process,
      queueMs,
      processMs,
      totalMs: queueMs + processMs,
      flagged: Boolean(queue?.crossesOffShift || process?.crossesOffShift),
      incomplete,
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
      r.flagged ? "yes" : "no",
      r.incomplete ? "yes" : "no",
      (r.log.notes ?? "").replace(/"/g, '""'),
    ]
      .map((c) => `"${String(c)}"`)
      .join(",")
  );

  return [head.join(","), ...lines].join("\n");
}
