"use client";

import { supabase } from "./supabase";
import type { BlastType, Emperion, LogRow, Segment, Step } from "./types";

/**
 * Moving a lot from one step to the next.
 *
 * This used to be written out separately in the operator and admin screens,
 * and both copies had the same three faults, which together made lots look
 * stuck no matter how many times they were sent on:
 *
 *   1. Timers left running anywhere else were never closed, so a lot could
 *      be "in process" at two steps at once.
 *   2. Arriving at a step the lot had visited before created a new pass even
 *      on an ordinary forward move.
 *   3. The new record was always pass 1, while the dashboard decided where a
 *      lot was by its highest pass. A lot reworked once had pass 2 behind it
 *      and every forward move landed at pass 1, so it never appeared to move.
 *
 * One function now does it, and it enforces a single rule: a lot is in one
 * place at a time. Everything open elsewhere is closed at the moment of the
 * handoff, the pass carries forward unless this is rework, and a record that
 * already holds the lot at the target is reused rather than duplicated.
 */

type HandoffArgs = {
  lotId: string;
  fromStepId: string;
  target: Step;
  rework: boolean;
  /** The instant the lot left, so queue time at the next step starts then. */
  stamp: string;
  crew: string[];
  blastType?: BlastType | null;
  emperion?: Emperion | null;
};

export type HandoffResult = { ok: boolean; message: string };

/** Every live record this lot has, anywhere on the line. */
async function recordsFor(lotId: string): Promise<LogRow[]> {
  const { data } = await supabase
    .from("logs")
    .select("*")
    .eq("lot_id", lotId)
    .is("deleted_at", null);
  return (data ?? []) as LogRow[];
}

/**
 * Close every timer still open for this lot. Each one ends at the handoff
 * moment, or at its own start if it somehow began later, since a stretch may
 * never end before it began.
 */
export async function closeOpenFor(
  lotId: string,
  stamp: string,
  crew: string[],
  exceptRecordId?: string
): Promise<number> {
  const recs = await recordsFor(lotId);
  const ids = recs.map((r) => r.id).filter((id) => id !== exceptRecordId);
  if (ids.length === 0) return 0;

  const { data } = await supabase
    .from("segments")
    .select("*")
    .in("log_id", ids)
    .is("ended_at", null);
  const open = (data ?? []) as Segment[];

  for (const sg of open) {
    const end = sg.started_at > stamp ? sg.started_at : stamp;
    await supabase
      .from("segments")
      .update({ ended_at: end, ended_by: crew })
      .eq("id", sg.id);
  }
  return open.length;
}

export async function handOff(a: HandoffArgs): Promise<HandoffResult> {
  // 1. The lot is leaving, so nothing it has open anywhere survives.
  await closeOpenFor(a.lotId, a.stamp, a.crew);

  // 2. The pass carries forward. Only rework starts a new one.
  const recs = await recordsFor(a.lotId);
  const currentPass = recs.reduce((n, r) => Math.max(n, r.pass_no || 1), 1);
  const pass = a.rework ? currentPass + 1 : currentPass;

  // 3. Reuse a record that already holds this lot at the target on this pass.
  const existing = recs.find(
    (r) => r.step_id === a.target.id && (r.pass_no || 1) === pass
  );

  let destId: string;
  if (existing) {
    destId = existing.id;
    const patch: Record<string, unknown> = { auto_from_step_id: a.fromStepId };
    if (a.target.has_blast_type && a.blastType && !existing.blast_type)
      patch.blast_type = a.blastType;
    if (a.target.has_emperion && a.emperion && !existing.emperion)
      patch.emperion = a.emperion;
    await supabase.from("logs").update(patch).eq("id", existing.id);
  } else {
    const { data, error } = await supabase
      .from("logs")
      .insert({
        step_id: a.target.id,
        operator_id: a.crew[0] ?? null,
        lot_id: a.lotId,
        log_date: new Date(new Date(a.stamp).getTime() - 7 * 3600000)
          .toISOString()
          .slice(0, 10),
        blast_type: a.target.has_blast_type ? a.blastType ?? null : null,
        emperion: a.target.has_emperion ? a.emperion ?? null : null,
        pass_no: pass,
        auto_from_step_id: a.fromStepId,
      })
      .select()
      .single();
    if (error || !data) {
      return { ok: false, message: "Could not send it on. Check the connection." };
    }
    destId = (data as LogRow).id;
  }

  // 4. It starts waiting at the target at the same moment it left.
  const entryKind = a.target.has_queue ? "queue" : "process";
  const { error: segErr } = await supabase.from("segments").insert({
    log_id: destId,
    kind: entryKind,
    started_at: a.stamp,
    started_by: a.crew,
  });
  if (segErr) {
    return {
      ok: false,
      message: "Sent on, but the timer at the next step did not start.",
    };
  }

  return {
    ok: true,
    message: a.rework
      ? `${a.lotId} sent back to ${a.target.step_name} for rework`
      : `${a.lotId} sent to ${a.target.step_name}`,
  };
}

/**
 * Of a lot's records at one step, the one to act on: whichever has a timer
 * running, and failing that the newest. Picking the newest blindly is how an
 * older record's timer ended up running unseen underneath the one on screen.
 */
export async function recordToActOn(
  lotId: string,
  stepId: string
): Promise<{ record: LogRow | null; segments: Segment[] }> {
  const { data } = await supabase
    .from("logs")
    .select("*")
    .eq("step_id", stepId)
    .eq("lot_id", lotId)
    .is("deleted_at", null)
    .order("pass_no", { ascending: false })
    .order("created_at", { ascending: false });
  const recs = (data ?? []) as LogRow[];
  if (recs.length === 0) return { record: null, segments: [] };

  const { data: segData } = await supabase
    .from("segments")
    .select("*")
    .in(
      "log_id",
      recs.map((r) => r.id)
    )
    .order("started_at");
  const segs = (segData ?? []) as Segment[];

  const live = recs.find((r) =>
    segs.some((s) => s.log_id === r.id && !s.ended_at)
  );
  const record = live ?? recs[0];
  return { record, segments: segs.filter((s) => s.log_id === record.id) };
}

/**
 * The same one-place rule for purchase orders. An order is queued in at
 * shipping by hand rather than handed on, so if its incoming timer was never
 * stopped it would otherwise be running at both stations at once.
 */
export async function closeOpenForPo(
  poNumber: string,
  stamp: string,
  crew: string[],
  exceptRecordId?: string
): Promise<number> {
  const { data: recs } = await supabase
    .from("po_logs")
    .select("id")
    .eq("po_number", poNumber)
    .is("deleted_at", null);
  const ids = ((recs ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => id !== exceptRecordId);
  if (ids.length === 0) return 0;

  const { data } = await supabase
    .from("segments")
    .select("*")
    .in("po_log_id", ids)
    .is("ended_at", null);
  const open = (data ?? []) as Segment[];
  for (const sg of open) {
    const end = sg.started_at > stamp ? sg.started_at : stamp;
    await supabase
      .from("segments")
      .update({ ended_at: end, ended_by: crew })
      .eq("id", sg.id);
  }
  return open.length;
}
