"use client";

import { supabase } from "./supabase";
import { enqueue } from "./offline";
import { openSegment, ofKind } from "./segments";
import type { Segment, SegmentKind } from "./types";

export type Action =
  | "queue_in"
  | "queue_out"
  | "process_in"
  | "process_out"
  | "back_to_queue";

export const ACTION_LABEL: Record<Action, string> = {
  queue_in: "Queue in",
  queue_out: "Queue out",
  process_in: "Process in",
  process_out: "Process out",
  back_to_queue: "Back to queue",
};

export type Parent =
  | { kind: "log"; id: string }
  | { kind: "po"; id: string };

/** What a button press will actually do to the intervals. */
export type Plan = {
  /** Interval to close, if any. */
  close: Segment | null;
  /** Interval to open, if any. */
  open: SegmentKind | null;
  /** A stretch that starts and ends at the same instant, used when a phase
   *  is finished that was never started. */
  instant: SegmentKind | null;
  /** Human wording for the toast. */
  describes: string;
  /** True when the press does not follow the natural order. */
  outOfOrder: boolean;
  /** True when the press would change nothing at all. Without this a button
   *  could report success while leaving a timer running. */
  noop: boolean;
};

/**
 * Work out what a press means given the intervals that already exist.
 * Kept separate from the writing so it can be unit tested and so the buttons
 * can show their state without duplicating the rules.
 */
export function planAction(
  segments: Segment[],
  action: Action,
  linked: boolean,
  step: { has_queue: boolean; has_process: boolean }
): Plan {
  const openQueue = openSegment(segments, "queue");
  const openProcess = openSegment(segments, "process");
  const linkable = step.has_queue && step.has_process;
  const anyQueue = ofKind(segments, "queue").length > 0;
  const anyProcess = ofKind(segments, "process").length > 0;

  /**
   * Every press must leave the record in a state that makes physical sense.
   * The rule is simple: close whatever is open, then open what the press
   * says. A press must never silently do nothing, because that is how a
   * timer ends up running forever and the floor board fills with lots that
   * are not there.
   */
  const openAny = openProcess ?? openQueue;

  switch (action) {
    case "queue_in":
      return {
        close: openAny,
        open: "queue",
        instant: null,
        describes: openProcess ? "Back to queue" : "Queue in",
        outOfOrder: Boolean(openQueue),
        noop: false,
      };

    case "back_to_queue":
      return {
        close: openAny,
        open: "queue",
        instant: null,
        describes: "Back to queue",
        outOfOrder: !openProcess,
        noop: false,
      };

    case "queue_out":
      // Ending the queue starts the process when the two are linked.
      return {
        close: openAny,
        open: linked && linkable && !openProcess ? "process" : null,
        instant: null,
        describes:
          linked && linkable && !openProcess
            ? "Queue out and process in"
            : "Queue out",
        outOfOrder: !openQueue,
        noop: !openAny && !(linked && linkable),
      };

    case "process_in":
      // Starting the process closes an open queue, which is the same
      // transition queue out performs.
      return {
        close: openAny,
        open: "process",
        instant: null,
        describes:
          openQueue && linked && linkable
            ? "Process in and queue out"
            : "Process in",
        outOfOrder: Boolean(openProcess) || (step.has_queue && !anyQueue),
        noop: false,
      };

    case "process_out":
      if (openProcess) {
        return {
          close: openProcess,
          open: null,
          instant: null,
          describes: "Process out",
          outOfOrder: false,
          noop: false,
        };
      }
      if (openQueue) {
        // Finished without ever starting the process. The queue has to end,
        // and a zero length process stretch records that the work completed
        // here even though nobody logged it starting. Leaving the queue open
        // was the old behaviour and it stranded the lot on the board.
        return {
          close: openQueue,
          open: null,
          instant: "process",
          describes: "Process out, queue closed",
          outOfOrder: true,
          noop: false,
        };
      }
      return {
        close: null,
        open: null,
        instant: null,
        describes: "Nothing to close",
        outOfOrder: !anyProcess,
        noop: true,
      };
  }
}

type WriteResult = { ok: boolean; queued: boolean };

/**
 * Apply a plan. Closing and opening are two rows, so if the connection drops
 * between them the second is parked for replay rather than lost.
 */
export async function applyPlan(
  plan: Plan,
  parent: Parent,
  ts: string,
  crew: string[]
): Promise<WriteResult> {
  let queued = false;
  const parentCol = parent.kind === "log" ? "log_id" : "po_log_id";

  if (plan.close) {
    const payload = { ended_at: ts, ended_by: crew };
    const { error } = await supabase
      .from("segments")
      .update(payload)
      .eq("id", plan.close.id);
    if (error) {
      enqueue({
        kind: "update",
        table: "segments",
        id: plan.close.id,
        payload,
        at: Date.now(),
      });
      queued = true;
    }
  }

  if (plan.instant) {
    const payload = {
      [parentCol]: parent.id,
      kind: plan.instant,
      started_at: ts,
      ended_at: ts,
      started_by: crew,
      ended_by: crew,
    };
    const { error } = await supabase.from("segments").insert(payload);
    if (error) {
      enqueue({
        kind: "insert",
        table: "segments",
        payload,
        at: Date.now(),
      });
      queued = true;
    }
  }

  if (plan.open) {
    const payload = {
      [parentCol]: parent.id,
      kind: plan.open,
      started_at: ts,
      started_by: crew,
    };
    const { error } = await supabase.from("segments").insert(payload);
    if (error) {
      enqueue({
        kind: "insert",
        table: "segments",
        payload,
        at: Date.now(),
      });
      queued = true;
    }
  }

  return { ok: true, queued };
}

/** Load every interval belonging to a record. */
export async function loadSegments(parent: Parent): Promise<Segment[]> {
  const col = parent.kind === "log" ? "log_id" : "po_log_id";
  const { data } = await supabase
    .from("segments")
    .select("*")
    .eq(col, parent.id)
    .order("started_at");
  return (data as Segment[]) ?? [];
}
