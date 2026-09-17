export type Operator = {
  id: string;
  name: string;
  is_default: boolean;
  created_at?: string;
};

export type Step = {
  id: string;
  area: string;
  step_name: string;
  has_queue: boolean;
  has_process: boolean;
  has_blast_type: boolean;
  sort_order: number;
  is_entry?: boolean;
  is_final?: boolean;
  tracks_po?: boolean;
  /** False on steps that handle purchase orders only, such as oil and
   *  shipping, where lots no longer exist because they have been split. */
  tracks_lots?: boolean;
  /** True where a lot is created and handed straight on, with no timing. */
  release_only?: boolean;
  /** Retired steps stay in the database so old records keep a valid
   *  reference, but they never appear in the pickers or routing. */
  active?: boolean;
};

/** Steps still running on the line, in order. */
export function liveSteps(steps: Step[]): Step[] {
  return steps
    .filter((s) => s.active !== false)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Steps a lot can actually be routed to. */
export function lotSteps(steps: Step[]): Step[] {
  return liveSteps(steps).filter((s) => s.tracks_lots !== false);
}

/** Steps that handle purchase orders. */
export function poSteps(steps: Step[]): Step[] {
  return liveSteps(steps).filter((s) => s.tracks_po);
}

export type ActiveLot = {
  lot_id: string;
  step_count: number;
  last_activity: string;
  furthest_step: number;
  last_step: string;
  last_area: string;
  pass_no: number;
};

export type BlastType = "Manual Blasting" | "Auto Blasting";

export type LogRow = {
  id: string;
  step_id: string;
  operator_id: string;
  lot_id: string;
  log_date: string;
  blast_type: BlastType | null;
  queue_in: string | null;
  queue_out: string | null;
  process_in: string | null;
  process_out: string | null;
  notes: string | null;
  pass_no: number;
  auto_from_step_id: string | null;
  queue_in_by: string | null;
  queue_out_by: string | null;
  process_in_by: string | null;
  process_out_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SegmentKind = "queue" | "process";

/**
 * One interval of waiting or working. A record owns a list of these, so a lot
 * can go back to queue as many times as the floor needs and every stretch is
 * kept rather than overwritten.
 */
export type Segment = {
  id: string;
  log_id: string | null;
  po_log_id: string | null;
  kind: SegmentKind;
  started_at: string;
  /** Null while the interval is still running. */
  ended_at: string | null;
  started_by: string[];
  ended_by: string[];
  created_at: string;
};

export type PoLog = {
  id: string;
  step_id: string;
  po_number: string;
  log_date: string;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PoRegistryRow = {
  po_number: string;
  last_activity: string;
  record_count: number;
  seen_at_incoming: boolean;
  seen_at_final: boolean;
  last_step: string;
};

export type HistoryRow = {
  id: string;
  log_id: string;
  changed_by: string | null;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
};

export type WorkRules = {
  work_start: string;
  work_end: string;
  work_days: number[];
  timezone: string;
};

export type TimeField = "queue_in" | "queue_out" | "process_in" | "process_out";

export const TIME_FIELDS: TimeField[] = [
  "queue_in",
  "queue_out",
  "process_in",
  "process_out",
];

export const FIELD_LABEL: Record<TimeField, string> = {
  queue_in: "Queue in",
  queue_out: "Queue out",
  process_in: "Process in",
  process_out: "Process out",
};

/**
 * Lot numbers vary in shape: letters, digits, and one or more dashes as
 * separators. Validation stays loose enough to accept any real format but
 * still rejects the things that create orphan records: spaces, stray
 * punctuation, leading or trailing separators, and doubled separators.
 */
export const LOT_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/;

export const LOT_HINT =
  "Letters, numbers, dashes and underscores. No spaces, and no dash or underscore at the start or end.";

/**
 * Fold case so ABC-1 and abc-1 are never two lots, and trim the outside for
 * pasted values. Internal spaces are deliberately kept so they fail
 * validation: silently closing the gap would turn a typo like "123 456"
 * into a different, perfectly valid lot number.
 */
export function normalizeLot(v: string): string {
  return v.trim().toUpperCase();
}

/** Which operator column pairs with which timestamp. */
export const BY_FIELD: Record<TimeField, string> = {
  queue_in: "queue_in_by",
  queue_out: "queue_out_by",
  process_in: "process_in_by",
  process_out: "process_out_by",
};

/** The timestamp that starts a step, given what phases it has. */
export function entryField(step: {
  has_queue: boolean;
  has_process: boolean;
}): TimeField {
  return step.has_queue ? "queue_in" : "process_in";
}

/** The timestamp that finishes a step and hands the lot onward. */
export function exitField(step: {
  has_queue: boolean;
  has_process: boolean;
}): TimeField {
  return step.has_process ? "process_out" : "queue_out";
}
