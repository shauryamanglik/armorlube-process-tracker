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
};

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

export const LOT_PATTERN = /^\d{6}-\d{2}$/;

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
