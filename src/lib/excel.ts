import * as XLSX from "xlsx";
import { crewOf, ofKind } from "./segments";
import { isoToPhoenixDate } from "./time";
import type { Enriched, EnrichedPo } from "./analytics";
import type { Operator, Segment, Step } from "./types";

/**
 * The workbook is laid out wide: one row per lot, with a block of columns for
 * every step it passed through. That is the shape people actually pivot and
 * filter on, rather than one row per record.
 */

const H = 3600000;

function hours(ms: number): number {
  return Math.round((ms / H) * 100) / 100;
}

/** The day, or the span of days, a step's intervals actually covered. */
function dateSpan(segments: Segment[]): string {
  if (segments.length === 0) return "";
  const days = new Set<string>();
  for (const s of segments) {
    days.add(isoToPhoenixDate(s.started_at));
    if (s.ended_at) days.add(isoToPhoenixDate(s.ended_at));
  }
  const sorted = Array.from(days).sort();
  if (sorted.length === 1) return sorted[0];
  return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
}

function names(ids: string[], ops: Map<string, string>): string {
  return ids
    .map((id) => ops.get(id))
    .filter(Boolean)
    .join(", ");
}

/** Column headers for one step's block. */
function stepHeaders(step: Step): string[] {
  const base = [
    `${step.step_name} - Date`,
    `${step.step_name} - Operators`,
    `${step.step_name} - Queue (h)`,
    `${step.step_name} - Process (h)`,
    `${step.step_name} - Total (h)`,
  ];
  if (step.has_blast_type) {
    base.splice(2, 0, `${step.step_name} - Blast type`);
  }
  if (step.has_emperion) {
    base.splice(2, 0, `${step.step_name} - Emperion`);
  }
  return base;
}

/** Values for one step's block, blank when the lot never went there. */
function stepValues(
  step: Step,
  row: Enriched | undefined,
  ops: Map<string, string>
): (string | number)[] {
  if (!row) {
    const extra = (step.has_blast_type ? 1 : 0) + (step.has_emperion ? 1 : 0);
    return Array(5 + extra).fill("");
  }
  const base: (string | number)[] = [
    dateSpan(row.segments) || row.log.log_date,
    names(crewOf(row.segments), ops),
    hours(row.queueMs),
    hours(row.processMs),
    hours(row.totalMs),
  ];
  if (step.has_blast_type) {
    base.splice(2, 0, row.log.blast_type ?? "");
  }
  if (step.has_emperion) {
    base.splice(2, 0, row.log.emperion ?? "");
  }
  return base;
}

export type BuildArgs = {
  rows: Enriched[];
  poRows: EnrichedPo[];
  steps: Step[];
  operators: Operator[];
  from: string;
  to: string;
  includeOffShift: boolean;
};

export function buildWorkbook({
  rows,
  poRows,
  steps,
  operators,
  from,
  to,
  includeOffShift,
}: BuildArgs): XLSX.WorkBook {
  const ops = new Map(operators.map((o) => [o.id, o.name]));
  const wb = XLSX.utils.book_new();

  // ---------------------------------------------------------
  // Sheet 1: one row per lot, a block of columns per step
  // ---------------------------------------------------------
  const lotSteps = steps
    .filter((s) => s.active !== false && s.tracks_lots !== false)
    .sort((a, b) => a.sort_order - b.sort_order);

  const lotHeader = [
    "Lot number",
    ...lotSteps.flatMap(stepHeaders),
    "Total queue (h)",
    "Total process (h)",
    "Total time (h)",
    "Labour (h)",
    "Passes",
    "Times sent back",
    "Steps logged",
  ];

  // Group every record by lot, then by step within that lot.
  const byLot = new Map<string, Map<string, Enriched>>();
  for (const r of rows) {
    if (!r.step) continue;
    const forLot = byLot.get(r.log.lot_id) ?? new Map<string, Enriched>();
    // A lot can have more than one pass at a step. Keep the latest, and the
    // pass count column tells the reader when that happened.
    const existing = forLot.get(r.step.id);
    if (!existing || r.log.pass_no >= existing.log.pass_no) {
      forLot.set(r.step.id, r);
    }
    byLot.set(r.log.lot_id, forLot);
  }

  const lotBody = Array.from(byLot.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lot, forLot]) => {
      const all = Array.from(forLot.values());
      return [
        lot,
        ...lotSteps.flatMap((s) => stepValues(s, forLot.get(s.id), ops)),
        hours(all.reduce((a, r) => a + r.queueMs, 0)),
        hours(all.reduce((a, r) => a + r.processMs, 0)),
        hours(all.reduce((a, r) => a + r.totalMs, 0)),
        hours(all.reduce((a, r) => a + r.labourMs, 0)),
        Math.max(...all.map((r) => r.log.pass_no)),
        all.reduce((a, r) => a + r.interruptions, 0),
        all.length,
      ];
    });

  const lotSheet = XLSX.utils.aoa_to_sheet([lotHeader, ...lotBody]);
  lotSheet["!cols"] = lotHeader.map((h, i) => ({
    wch: i === 0 ? 16 : h.includes("Operators") ? 22 : h.includes("Date") ? 22 : 13,
  }));
  lotSheet["!freeze"] = { xSplit: 1, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, lotSheet, "Lots");

  // ---------------------------------------------------------
  // Sheet 2: same shape for purchase orders
  // ---------------------------------------------------------
  const poStations = steps
    .filter((s) => s.active !== false && s.tracks_po)
    .sort((a, b) => a.sort_order - b.sort_order);

  const poHeader = [
    "PO number",
    ...poStations.flatMap((s) => [
      `${s.step_name} - Date`,
      `${s.step_name} - Operators`,
      `${s.step_name} - Queue (h)`,
      `${s.step_name} - Process (h)`,
      `${s.step_name} - Total (h)`,
    ]),
    "Total queue (h)",
    "Total process (h)",
    "Total time (h)",
    "Labour (h)",
    "Times sent back",
    "Stations logged",
  ];

  const byPo = new Map<string, Map<string, EnrichedPo>>();
  for (const r of poRows) {
    if (!r.step) continue;
    const forPo = byPo.get(r.po.po_number) ?? new Map<string, EnrichedPo>();
    forPo.set(r.step.id, r);
    byPo.set(r.po.po_number, forPo);
  }

  const poBody = Array.from(byPo.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([po, forPo]) => {
      const all = Array.from(forPo.values());
      return [
        po,
        ...poStations.flatMap((s) => {
          const r = forPo.get(s.id);
          if (!r) return ["", "", "", "", ""];
          return [
            dateSpan(r.segments) || r.po.log_date,
            names(crewOf(r.segments), ops),
            hours(r.queueMs),
            hours(r.processMs),
            hours(r.totalMs),
          ];
        }),
        hours(all.reduce((a, r) => a + r.queueMs, 0)),
        hours(all.reduce((a, r) => a + r.processMs, 0)),
        hours(all.reduce((a, r) => a + r.totalMs, 0)),
        hours(all.reduce((a, r) => a + r.labourMs, 0)),
        all.reduce((a, r) => a + r.interruptions, 0),
        all.length,
      ];
    });

  const poSheet = XLSX.utils.aoa_to_sheet([poHeader, ...poBody]);
  poSheet["!cols"] = poHeader.map((h, i) => ({
    wch: i === 0 ? 16 : h.includes("Operators") ? 22 : h.includes("Date") ? 22 : 13,
  }));
  poSheet["!freeze"] = { xSplit: 1, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, poSheet, "Purchase Orders");

  // ---------------------------------------------------------
  // Sheet 3: every stretch, for anyone who wants the detail
  // ---------------------------------------------------------
  const detailHeader = [
    "Type",
    "Reference",
    "Step",
    "Area",
    "Pass",
    "Kind",
    "Started",
    "Ended",
    "Hours",
    "Crew",
    "Still running",
  ];
  const detail: (string | number)[][] = [];

  for (const r of rows) {
    for (const s of ofKind(r.segments, "queue").concat(
      ofKind(r.segments, "process")
    )) {
      detail.push([
        "Lot",
        r.log.lot_id,
        r.step?.step_name ?? "",
        r.step?.area ?? "",
        r.log.pass_no,
        s.kind === "queue" ? "Queue" : "Process",
        s.started_at,
        s.ended_at ?? "",
        s.ended_at
          ? hours(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())
          : "",
        names([...new Set([...(s.started_by ?? []), ...(s.ended_by ?? [])])], ops),
        s.ended_at ? "" : "yes",
      ]);
    }
  }
  for (const r of poRows) {
    for (const s of ofKind(r.segments, "queue").concat(
      ofKind(r.segments, "process")
    )) {
      detail.push([
        "PO",
        r.po.po_number,
        r.step?.step_name ?? "",
        r.step?.area ?? "",
        1,
        s.kind === "queue" ? "Queue" : "Process",
        s.started_at,
        s.ended_at ?? "",
        s.ended_at
          ? hours(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())
          : "",
        names([...new Set([...(s.started_by ?? []), ...(s.ended_by ?? [])])], ops),
        s.ended_at ? "" : "yes",
      ]);
    }
  }

  detail.sort((a, b) => String(a[6]).localeCompare(String(b[6])));
  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detail]);
  detailSheet["!cols"] = [
    { wch: 7 }, { wch: 16 }, { wch: 26 }, { wch: 10 }, { wch: 6 },
    { wch: 9 }, { wch: 22 }, { wch: 22 }, { wch: 9 }, { wch: 24 }, { wch: 12 },
  ];
  detailSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, detailSheet, "Every stretch");

  // ---------------------------------------------------------
  // Sheet 4: per step summary
  // ---------------------------------------------------------
  const summaryHeader = [
    "Step",
    "Area",
    "Records",
    "Avg queue (h)",
    "Avg process (h)",
    "Avg total (h)",
    "Total queue (h)",
    "Total process (h)",
    "Labour (h)",
    "Times sent back",
  ];
  const summary = lotSteps.map((s) => {
    const list = rows.filter((r) => r.step?.id === s.id);
    const avg = (v: number[]) => {
      const real = v.filter((x) => x > 0);
      return real.length ? real.reduce((a, b) => a + b, 0) / real.length : 0;
    };
    return [
      s.step_name,
      s.area,
      list.length,
      hours(avg(list.map((r) => r.queueMs))),
      hours(avg(list.map((r) => r.processMs))),
      hours(avg(list.map((r) => r.totalMs))),
      hours(list.reduce((a, r) => a + r.queueMs, 0)),
      hours(list.reduce((a, r) => a + r.processMs, 0)),
      hours(list.reduce((a, r) => a + r.labourMs, 0)),
      list.reduce((a, r) => a + r.interruptions, 0),
    ];
  });
  const summarySheet = XLSX.utils.aoa_to_sheet([summaryHeader, ...summary]);
  summarySheet["!cols"] = [{ wch: 28 }, { wch: 10 }, ...Array(8).fill({ wch: 15 })];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Step summary");

  // ---------------------------------------------------------
  // Sheet 5: what the numbers mean
  // ---------------------------------------------------------
  const about = [
    ["Armorlube process time export"],
    [],
    ["Date range", `${from} to ${to}`],
    [
      "Time basis",
      includeOffShift
        ? "Raw elapsed, including nights and weekends"
        : "Working hours only, nights and weekends excluded",
    ],
    ["Generated", new Date().toISOString()],
    [],
    ["Sheet", "What it holds"],
    ["Lots", "One row per lot, a block of columns for every step it went through"],
    ["Purchase Orders", "One row per PO, a block per station that handled it"],
    ["Every stretch", "One row per interval, the raw detail behind the totals"],
    ["Step summary", "Averages and totals per step across the whole range"],
    [],
    ["Column", "Meaning"],
    ["Queue (h)", "Waiting before work started, including time sent back to queue"],
    ["Process (h)", "Hands-on time"],
    ["Total (h)", "Queue plus process"],
    ["Labour (h)", "Each stretch multiplied by how many people were on it"],
    ["Passes", "2 or more means the lot was reworked"],
    ["Times sent back", "How often work was interrupted and requeued"],
    ["Emperion", "Which coating machine ran the lot, 2301 or 2302"],
    ["Blank step block", "The lot never went to that step"],
  ];
  const aboutSheet = XLSX.utils.aoa_to_sheet(about);
  aboutSheet["!cols"] = [{ wch: 22 }, { wch: 74 }];
  XLSX.utils.book_append_sheet(wb, aboutSheet, "About");

  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { compression: true });
}
