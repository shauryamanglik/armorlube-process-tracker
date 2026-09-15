"use client";

import { supabase } from "./supabase";

/**
 * Shop-floor wifi drops. Writes that fail get parked in localStorage and
 * replayed in order once the network comes back, so an operator never loses
 * a timestamp they already pressed.
 */

const KEY = "apt.pending.v1";

export type PendingOp =
  | { kind: "insert"; table: "logs"; payload: Record<string, unknown>; at: number }
  | {
      kind: "update";
      table: "logs";
      id: string;
      payload: Record<string, unknown>;
      at: number;
    }
  | {
      kind: "insert";
      table: "log_history";
      payload: Record<string, unknown>;
      at: number;
    }
  | {
      kind: "insert";
      table: "operators";
      payload: Record<string, unknown>;
      at: number;
    };

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

async function runOne(op: PendingOp): Promise<boolean> {
  try {
    if (op.kind === "insert") {
      const { error } = await supabase.from(op.table).insert(op.payload);
      return !error;
    }
    const { error } = await supabase
      .from(op.table)
      .update(op.payload)
      .eq("id", op.id);
    return !error;
  } catch {
    return false;
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
      const ok = await runOne(ops[0]);
      if (!ok) break;
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
