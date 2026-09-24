import { supabase } from "./supabase";

/**
 * Which lot or order should be worked next.
 *
 * Everything sits on one number line measured in days. A due date becomes
 * days since 1970. When someone drags an item above or below another, it is
 * given a value between its two new neighbours, on the same scale, so manual
 * placements and due dates sort together without a second rule to reconcile.
 *
 * Hot jobs sit above the whole line. Items with no due date and no placement
 * sit below everything dated, in the order they arrived.
 */

export type PriorityKind = "lot" | "po";

export type Priority = {
  kind: PriorityKind;
  ref: string;
  due_date: string | null;
  hot: boolean;
  manual_rank: number | null;
};

/** Undated work sorts last, but still needs a finite number for maths. */
const UNDATED = 1e7;

function daysSinceEpoch(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Where an item sits on the line. */
export function rankOf(p: Priority | undefined): number {
  if (!p) return UNDATED;
  if (p.manual_rank !== null && p.manual_rank !== undefined) return p.manual_rank;
  if (p.due_date) return daysSinceEpoch(p.due_date);
  return UNDATED;
}

export type PriorityMap = Map<string, Priority>;

/**
 * Sort any list by priority. Hot first, then by position on the line, then
 * by whichever arrived first, so two undated items keep a stable order.
 */
export function byPriority<T>(
  items: T[],
  refOf: (t: T) => string,
  sinceOf: (t: T) => string | null,
  map: PriorityMap
): T[] {
  return [...items].sort((a, b) => {
    const pa = map.get(refOf(a));
    const pb = map.get(refOf(b));
    const ha = pa?.hot ? 1 : 0;
    const hb = pb?.hot ? 1 : 0;
    if (ha !== hb) return hb - ha;
    const ra = rankOf(pa);
    const rb = rankOf(pb);
    if (ra !== rb) return ra - rb;
    return (sinceOf(a) ?? "").localeCompare(sinceOf(b) ?? "");
  });
}

export async function loadPriorities(kind: PriorityKind): Promise<PriorityMap> {
  const { data } = await supabase.from("priorities").select("*").eq("kind", kind);
  const map: PriorityMap = new Map();
  for (const row of (data ?? []) as Priority[]) map.set(row.ref, row);
  return map;
}

export async function savePriority(
  kind: PriorityKind,
  ref: string,
  patch: Partial<Pick<Priority, "due_date" | "hot" | "manual_rank">>
): Promise<boolean> {
  const { error } = await supabase
    .from("priorities")
    .upsert({ kind, ref, ...patch }, { onConflict: "kind,ref" });
  return !error;
}

/**
 * The value that puts an item between two neighbours. Given only one
 * neighbour it steps a day past it; given none it goes to the top.
 */
export function between(above: number | null, below: number | null): number {
  if (above === null && below === null) return 0;
  if (above === null) return (below as number) - 1;
  if (below === null) return above + 1;
  return (above + below) / 2;
}

/** Human wording for a due date, relative to today. */
export function dueLabel(
  date: string | null,
  today: string
): { text: string; tone: "late" | "soon" | "ok" } | null {
  if (!date) return null;
  const diff = Math.round(daysSinceEpoch(date) - daysSinceEpoch(today));
  if (diff < 0) return { text: `${-diff}d late`, tone: "late" };
  if (diff === 0) return { text: "due today", tone: "late" };
  if (diff === 1) return { text: "due tomorrow", tone: "soon" };
  if (diff <= 3) return { text: `due in ${diff}d`, tone: "soon" };
  const [, m, d] = date.split("-");
  return { text: `due ${Number(m)}/${Number(d)}`, tone: "ok" };
}
