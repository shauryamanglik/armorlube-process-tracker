"use client";

import { supabase } from "./supabase";

/**
 * Shop-floor wifi drops. Writes that fail get parked in localStorage and
 * replayed in order once the network comes back, so an operator never loses
 * a timestamp they already pressed.
 */

const KEY = "apt.pending.v1";

type Table = "logs" | "log_history" | "operators" | "segments" | "po_logs";

export type PendingOp = {
  kind: "insert" | "update";
  table: Table;
  id?: string;
  payload: Record<string, unknown>;
  at: number;
  /** Failed replay attempts, used to stop a doomed write blocking the queue. */
  tries?: number;
};

const MAX_TRIES = 4;
const REJECTED_KEY = "apt.rejected.v1";

function read(): PendingOp[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(ops: PendingOp[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(ops));
  window.dispatchEvent(new CustomEvent("apt:pending", { detail: ops.length }));
}

export function pendingCount(): number {
  return read().length;
}

export function enqueue(op: PendingOp) {
  const ops = read();
  ops.push(op);
  write(ops);
}

/** Park a write the server will never accept, so the queue can move on. */
function setAside(op: PendingOp, reason: string) {
  try {
    const list = JSON.parse(localStorage.getItem(REJECTED_KEY) || "[]");
    list.push({ ...op, reason, at: Date.now() });
    localStorage.setItem(REJECTED_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // storage full or unavailable, nothing useful to do
  }
}

export function rejectedCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    return JSON.parse(localStorage.getItem(REJECTED_KEY) || "[]").length;
  } catch {
    return 0;
  }
}

export function clearRejected() {
  localStorage.removeItem(REJECTED_KEY);
}

type RunOutcome = "done" | "retry" | "rejected";

/**
 * A dropped connection and a write the database refuses are different
 * problems. Only the first one fixes itself by waiting, so a rejected write
 * is set aside instead of retried forever at the head of the queue.
 */
async function runOne(op: PendingOp): Promise<RunOutcome> {
  try {
    const res =
      op.kind === "insert"
        ? await supabase.from(op.table).insert(op.payload)
        : await supabase.from(op.table).update(op.payload).eq("id", op.id!);

    if (!res.error) return "done";

    // Postgres class 22 and 23 are data and constraint violations. Retrying
    // cannot help, so the write is set aside rather than left blocking.
    const code = res.error.code ?? "";
    if (code.startsWith("22") || code.startsWith("23")) {
      setAside(op, res.error.message);
      return "rejected";
    }
    return "retry";
  } catch {
    return "retry";
  }
}

let draining = false;

/** Replay parked writes oldest first. Stops at the first failure. */
export async function drain(): Promise<number> {
  if (draining) return pendingCount();
  draining = true;
  try {
    let ops = read();
    while (ops.length) {
      const head = ops[0];
      const outcome = await runOne(head);

      if (outcome === "retry") {
        const tries = (head.tries ?? 0) + 1;
        if (tries >= MAX_TRIES) {
          setAside(head, "gave up after repeated failures");
          ops = ops.slice(1);
          write(ops);
          continue;
        }
        ops = [{ ...head, tries }, ...ops.slice(1)];
        write(ops);
        break;
      }

      // done or rejected: either way it leaves the queue
      ops = ops.slice(1);
      write(ops);
    }
    return ops.length;
  } finally {
    draining = false;
  }
}

/** Start background retries. Returns a cleanup function. */
export function watchConnection(): () => void {
  const tick = () => {
    if (navigator.onLine && pendingCount() > 0) void drain();
  };
  const interval = setInterval(tick, 15000);
  window.addEventListener("online", tick);
  tick();
  return () => {
    clearInterval(interval);
    window.removeEventListener("online", tick);
  };
}
