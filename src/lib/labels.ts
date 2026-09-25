/**
 * Short names for steps, for places where the full name will not fit.
 *
 * "Defixturing/Final Inspection" is right in a heading and far too long on a
 * chip. Rather than let a chip cut it to "Defixturing/Fin", tight spots use
 * the part that identifies the step. Anything not listed keeps its name.
 */
const SHORT: Record<string, string> = {
  "Defixturing/Final Inspection": "Defixturing",
  "Incoming Inspection": "Incoming",
  "Unloading/Defixturing": "Defixturing",
  "Final Inspection/Oil/Packing": "Final Inspection",
};

export function shortStep(name: string | null | undefined): string {
  if (!name) return "";
  return SHORT[name] ?? name;
}


/** Short names for board columns, which are area names rather than steps. */
const SHORT_COLUMN: Record<string, string> = {
  "Defixturing & Inspection": "Defixturing",
  "Incoming Inspection": "Incoming",
};

export function shortColumn(name: string): string {
  return SHORT_COLUMN[name] ?? shortStep(name);
}
