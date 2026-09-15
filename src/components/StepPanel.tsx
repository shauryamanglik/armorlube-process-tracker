"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  CircleCheck,
  CornerDownRight,
  CornerUpLeft,
  Clock,
  Cog,
  Hourglass,
  Link2,
  LogIn,
  LogOut,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Unlink,
  Users,
  Wind,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { enqueue } from "@/lib/offline";
import {
  BY_FIELD,
  entryField,
  exitField,
  FIELD_LABEL,
  LOT_PATTERN,
  type ActiveLot,
  type BlastType,
  type LogRow,
  type Operator,
  type Step,
  type TimeField,
} from "@/lib/types";
import {
  formatClock,
  formatDuration,
  formatStamp,
  nowClockInPhoenix,
  phoenixToIso,
  todayInPhoenix,
} from "@/lib/time";
import EditLogModal from "./EditLogModal";
import LotPicker, { type LotState } from "./LotPicker";
import RouteDialog, { type RouteChoice } from "./RouteDialog";

type Props = {
  step: Step;
  allSteps: Step[];
  operators: Operator[];
  lots: ActiveLot[];
  onOperatorsChanged: () => void;
  onLotsChanged: () => void;
  compact?: boolean;
  onToast: (msg: string) => void;
};

type Conflict = { field: TimeField; log: LogRow; stamp: string };

export default function StepPanel({
  step,
  allSteps,
  operators,
  lots,
  onOperatorsChanged,
  onLotsChanged,
  compact,
  onToast,
}: Props) {
  const [operatorId, setOperatorId] = useState("");
  const [otherName, setOtherName] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [lotId, setLotId] = useState("");
  const [blastType, setBlastType] = useState<BlastType | "">("");
  const [timeMode, setTimeMode] = useState<"now" | "custom">("now");
  const [customDate, setCustomDate] = useState(todayInPhoenix());
  const [customTime, setCustomTime] = useState(nowClockInPhoenix());

  const [recent, setRecent] = useState<LogRow[]>([]);
  /** The record this exact lot already has at this step, fetched directly. */
  const [existing, setExisting] = useState<LogRow | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<TimeField | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [routing, setRouting] = useState<{ lot: string; stamp: string } | null>(
    null
  );
  const [routeBusy, setRouteBusy] = useState(false);
  /** Queue out and process in are the same moment on most steps. Linked by
   *  default, and the choice resets with each lot so it never carries over. */
  const [linked, setLinked] = useState(true);
  const [editing, setEditing] = useState<LogRow | null>(null);
  const [tick, setTick] = useState(0);

  const lotValid = LOT_PATTERN.test(lotId);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const loadRecent = useCallback(async () => {
    const { data } = await supabase
      .from("logs")
      .select("*")
      .eq("step_id", step.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (data) setRecent(data as LogRow[]);
  }, [step.id]);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  /**
   * Look the lot up at this step directly rather than searching the recent
   * list. The recent list is capped, so a lot logged a while back would not
   * be found there and a duplicate record would be created.
   */
  const lookup = useCallback(async () => {
    if (!LOT_PATTERN.test(lotId)) {
      setExisting(null);
      return;
    }
    setLookingUp(true);
    const { data } = await supabase
      .from("logs")
      .select("*")
      .eq("step_id", step.id)
      .eq("lot_id", lotId)
      .is("deleted_at", null)
      .order("pass_no", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    setExisting(data && data.length ? (data[0] as LogRow) : null);
    setLookingUp(false);
  }, [lotId, step.id]);

  useEffect(() => {
    const t = setTimeout(() => void lookup(), 250);
    return () => clearTimeout(t);
  }, [lookup]);

  useEffect(() => {
    setArmed(null);
    setLinked(true);
  }, [lotId]);

  const knownLot = useMemo(
    () => lots.find((l) => l.lot_id === lotId),
    [lots, lotId]
  );

  const lotState: LotState = useMemo(() => {
    if (!lotId) return { kind: "empty" };
    if (!lotValid) return { kind: "invalid" };
    if (existing) {
      const done = [
        existing.queue_in && "queue in",
        existing.queue_out && "queue out",
        existing.process_in && "process in",
        existing.process_out && "process out",
      ].filter(Boolean);
      return {
        kind: "repeat",
        lot: knownLot,
        detail: `This lot already has a record at this step with ${done.join(
          ", "
        )}. Logging adds to that same record rather than making a new one.`,
      };
    }
    if (knownLot) return { kind: "known", lot: knownLot };
    return { kind: "new" };
  }, [lotId, lotValid, existing, knownLot]);

  /** Blast type already stored on the record beats the local picker. */
  const effectiveBlast = existing?.blast_type ?? blastType ?? "";

  const linkable = step.has_queue && step.has_process;

  /**
   * When linked, ending the queue also starts the process and the other way
   * round. The partner is only filled when it is empty, so a later press can
   * never silently rewrite a boundary that was already recorded.
   */
  function partnerPatch(
    f: TimeField,
    ts: string,
    opId: string,
    target: LogRow | null
  ): Record<string, unknown> {
    if (!linked || !linkable) return {};
    if (f === "queue_out" && !target?.process_in) {
      return { process_in: ts, process_in_by: opId };
    }
    if (f === "process_in" && !target?.queue_out) {
      return { queue_out: ts, queue_out_by: opId };
    }
    return {};
  }

  function stamp(): string {
    if (timeMode === "now") return new Date().toISOString();
    return phoenixToIso(customDate, customTime);
  }

  /** Name both timestamps when the link filled a partner. */
  function logMessage(f: TimeField, payload: Record<string, unknown>): string {
    const alsoQ = f !== "queue_out" && payload.queue_out !== undefined;
    const alsoP = f !== "process_in" && payload.process_in !== undefined;
    if (alsoQ) return `Process in and queue out recorded for ${lotId}.`;
    if (alsoP) return `Queue out and process in recorded for ${lotId}.`;
    return `${FIELD_LABEL[f]} recorded for ${lotId}.`;
  }

  async function addHistory(
    logId: string,
    field: string,
    oldVal: string | null,
    newVal: string | null
  ) {
    const payload = {
      log_id: logId,
      changed_by: operatorId || null,
      field_changed: field,
      old_value: oldVal,
      new_value: newVal,
    };
    const { error } = await supabase.from("log_history").insert(payload);
    if (error)
      enqueue({ kind: "insert", table: "log_history", payload, at: Date.now() });
  }

  async function resolveOperator(): Promise<string | null> {
    if (!showOther) return operatorId || null;
    const name = otherName.trim();
    if (!name) return null;
    const hit = operators.find(
      (o) => o.name.toLowerCase() === name.toLowerCase()
    );
    if (hit) return hit.id;
    const { data, error } = await supabase
      .from("operators")
      .insert({ name })
      .select()
      .single();
    if (error || !data) return null;
    onOperatorsChanged();
    return (data as Operator).id;
  }

  /** What a waiting button is waiting on, in plain words. */
  function waitingOn(f: TimeField): string {
    if (f === "queue_out") return "Queue in not logged yet";
    if (f === "process_in")
      return step.has_queue ? "Queue out not logged yet" : "";
    if (f === "process_out") return "Process in not logged yet";
    return "";
  }

  /** Whether this button is the natural next action for the current record. */
  function expectation(f: TimeField): "ready" | "filled" | "waiting" {
    const v = existing?.[f] ?? null;
    if (v) return "filled";
    if (f === "queue_in") return "ready";
    if (f === "queue_out") return existing?.queue_in ? "ready" : "waiting";
    if (f === "process_in") {
      if (!step.has_queue) return "ready";
      return existing?.queue_out ? "ready" : "waiting";
    }
    return existing?.process_in ? "ready" : "waiting";
  }

  async function press(f: TimeField, force?: "overwrite" | "new") {
    if (busy) return;

    if (!operatorId && !showOther) {
      onToast("Pick your name first.");
      return;
    }
    if (!lotValid) {
      onToast("Choose or type a lot number as 000000-00.");
      return;
    }
    const needsBlast =
      step.has_blast_type && f.startsWith("process") && !effectiveBlast;
    if (needsBlast) {
      onToast("Choose a blast type before logging process time.");
      return;
    }

    // Out of sequence presses need a second tap, which is what stops a
    // mis-hit turning into a bad record.
    if (!force && expectation(f) === "waiting" && armed !== f) {
      setArmed(f);
      return;
    }

    setBusy(true);
    setArmed(null);
    try {
      const opId = await resolveOperator();
      if (!opId) {
        onToast("Could not save that operator name.");
        return;
      }

      await lookup();
      const ts = stamp();
      const target = force === "new" ? null : existing;

      if (target && target[f] && force !== "overwrite") {
        setConflict({ field: f, log: target, stamp: ts });
        return;
      }

      if (!target) {
        const payload = {
          step_id: step.id,
          operator_id: opId,
          lot_id: lotId,
          log_date: timeMode === "custom" ? customDate : todayInPhoenix(),
          blast_type: step.has_blast_type ? blastType || null : null,
          pass_no: 1,
          [f]: ts,
          [BY_FIELD[f]]: opId,
          ...partnerPatch(f, ts, opId, null),
        };
        const { error } = await supabase.from("logs").insert(payload);
        if (error) {
          enqueue({ kind: "insert", table: "logs", payload, at: Date.now() });
          onToast("Saved on this iPad. It will sync when wifi returns.");
        } else {
          onToast(logMessage(f, payload));
        }
      } else {
        const prev = target[f];
        const payload: Record<string, unknown> = {
          [f]: ts,
          [BY_FIELD[f]]: opId,
          ...partnerPatch(f, ts, opId, target),
        };
        if (step.has_blast_type && blastType && !target.blast_type) {
          payload.blast_type = blastType;
        }
        const { error } = await supabase
          .from("logs")
          .update(payload)
          .eq("id", target.id);
        if (error) {
          enqueue({
            kind: "update",
            table: "logs",
            id: target.id,
            payload,
            at: Date.now(),
          });
          onToast("Saved on this iPad. It will sync when wifi returns.");
        } else {
          if (prev) await addHistory(target.id, f, prev, ts);
          onToast(logMessage(f, payload));
        }
      }

      setConflict(null);
      await Promise.all([loadRecent(), lookup()]);
      onLotsChanged();

      // Leaving this step hands the lot to the next one. The final step has
      // nowhere to send it, so the lot simply closes.
      if (f === exitField(step) && !step.is_final) {
        setRouting({ lot: lotId, stamp: ts });
      }
    } finally {
      setBusy(false);
    }
  }


  /**
   * Write the entry timestamp at the target step using the same instant the
   * lot left this one, so queue time at the next step measures the real gap.
   */
  async function routeTo(choice: RouteChoice) {
    if (!routing) return;
    setRouteBusy(true);
    try {
      const opId = await resolveOperator();
      const target = choice.target;
      const entry = entryField(target);

      // Find what the lot already has at the target, newest pass first.
      const { data } = await supabase
        .from("logs")
        .select("*")
        .eq("step_id", target.id)
        .eq("lot_id", routing.lot)
        .is("deleted_at", null)
        .order("pass_no", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);

      const found = data && data.length ? (data[0] as LogRow) : null;

      // Rework opens a new pass rather than touching the original run.
      if (choice.rework || (found && found[entry])) {
        const nextPass = (found?.pass_no ?? 0) + 1;
        const payload = {
          step_id: target.id,
          operator_id: opId,
          lot_id: routing.lot,
          log_date: todayInPhoenix(),
          blast_type: target.has_blast_type ? choice.blastType : null,
          pass_no: choice.rework ? nextPass : found ? nextPass : 1,
          auto_from_step_id: step.id,
          [entry]: routing.stamp,
          [BY_FIELD[entry]]: opId,
        };
        const { error } = await supabase.from("logs").insert(payload);
        if (error) {
          enqueue({ kind: "insert", table: "logs", payload, at: Date.now() });
          onToast("Handoff saved on this iPad. It will sync when wifi returns.");
        } else {
          onToast(
            choice.rework
              ? `Lot ${routing.lot} sent back to ${target.step_name} as pass ${payload.pass_no}.`
              : `Lot ${routing.lot} sent to ${target.step_name}.`
          );
        }
      } else if (found) {
        // Record exists with the entry slot empty, so fill it.
        const payload: Record<string, unknown> = {
          [entry]: routing.stamp,
          [BY_FIELD[entry]]: opId,
          auto_from_step_id: step.id,
        };
        if (target.has_blast_type && choice.blastType && !found.blast_type) {
          payload.blast_type = choice.blastType;
        }
        const { error } = await supabase
          .from("logs")
          .update(payload)
          .eq("id", found.id);
        if (error) {
          enqueue({
            kind: "update",
            table: "logs",
            id: found.id,
            payload,
            at: Date.now(),
          });
          onToast("Handoff saved on this iPad. It will sync when wifi returns.");
        } else {
          onToast(`Lot ${routing.lot} sent to ${target.step_name}.`);
        }
      } else {
        const payload = {
          step_id: target.id,
          operator_id: opId,
          lot_id: routing.lot,
          log_date: todayInPhoenix(),
          blast_type: target.has_blast_type ? choice.blastType : null,
          pass_no: 1,
          auto_from_step_id: step.id,
          [entry]: routing.stamp,
          [BY_FIELD[entry]]: opId,
        };
        const { error } = await supabase.from("logs").insert(payload);
        if (error) {
          enqueue({ kind: "insert", table: "logs", payload, at: Date.now() });
          onToast("Handoff saved on this iPad. It will sync when wifi returns.");
        } else {
          onToast(`Lot ${routing.lot} sent to ${target.step_name}.`);
        }
      }

      setRouting(null);
      setLotId("");
      onLotsChanged();
    } finally {
      setRouteBusy(false);
    }
  }

  async function softDelete(l: LogRow) {
    if (
      !window.confirm(
        `Delete the record for lot ${l.lot_id}? It stays in the audit trail.`
      )
    )
      return;
    const ts = new Date().toISOString();
    const { error } = await supabase
      .from("logs")
      .update({ deleted_at: ts })
      .eq("id", l.id);
    if (error) {
      onToast("Could not delete right now. Check the connection.");
      return;
    }
    await addHistory(l.id, "deleted", null, ts);
    onToast(`Record for ${l.lot_id} deleted.`);
    await Promise.all([loadRecent(), lookup()]);
    onLotsChanged();
  }

  /** Live elapsed time for a phase that has started but not finished. */
  function elapsed(inV: string | null, outV: string | null): string | null {
    void tick;
    if (!inV) return null;
    const end = outV ? new Date(outV).getTime() : Date.now();
    return formatDuration(end - new Date(inV).getTime());
  }

  /** True when queue out and process in hold the same instant, which only
   *  happens when the two were recorded together. */
  function linkFilled(f: TimeField): boolean {
    if (f !== "queue_out" && f !== "process_in") return false;
    const q = existing?.queue_out;
    const pr = existing?.process_in;
    return Boolean(q && pr && q === pr);
  }

  const arrivedFrom = existing?.auto_from_step_id
    ? allSteps.find((x) => x.id === existing.auto_from_step_id)?.step_name ?? null
    : null;

  const phases = [
    step.has_queue && {
      id: "queue" as const,
      name: "Queue",
      sub: "Waiting before work starts",
      icon: <Hourglass size={17} />,
      fields: ["queue_in", "queue_out"] as TimeField[],
      live: elapsed(existing?.queue_in ?? null, existing?.queue_out ?? null),
      running: Boolean(existing?.queue_in && !existing?.queue_out),
    },
    step.has_process && {
      id: "process" as const,
      name: "Process",
      sub: "Work being done on the lot",
      icon: <Cog size={17} />,
      fields: ["process_in", "process_out"] as TimeField[],
      live: elapsed(existing?.process_in ?? null, existing?.process_out ?? null),
      running: Boolean(existing?.process_in && !existing?.process_out),
    },
  ].filter(Boolean) as {
    id: "queue" | "process";
    name: string;
    sub: string;
    icon: React.ReactNode;
    fields: TimeField[];
    live: string | null;
    running: boolean;
  }[];

  return (
    <div className="stack">
      {/* operator */}
      <div className="panel tight">
        <span className="field-label">
          <Users size={14} />
          Operator
        </span>
        <div className="chips">
          {operators.map((o) => (
            <button
              key={o.id}
              className="chip"
              aria-pressed={operatorId === o.id && !showOther}
              onClick={() => {
                setOperatorId(o.id);
                setShowOther(false);
              }}
            >
              {o.name}
            </button>
          ))}
          <button
            className="chip"
            aria-pressed={showOther}
            onClick={() => {
              setShowOther(true);
              setOperatorId("");
            }}
          >
            Other
          </button>
        </div>
        {showOther && (
          <input
            className="input"
            style={{ marginTop: 10 }}
            placeholder="Type the operator name"
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
          />
        )}
      </div>

      {/* lot */}
      <div className="panel tight">
        <LotPicker
          value={lotId}
          onChange={setLotId}
          lots={lots}
          state={lotState}
          entryStep={Boolean(step.is_entry)}
        />
      </div>

      {existing && existing.pass_no > 1 && (
        <div className="lot-status repeat">
          <CornerUpLeft size={16} />
          <span>
            Lot {lotId} is on pass {existing.pass_no} at this step. Earlier passes
            are kept separately.
          </span>
        </div>
      )}

      {/* blast type and time source */}
      <div className="panel tight stack">
        {step.has_blast_type && (
          <div>
            <span className="field-label">
              <Wind size={14} />
              Blast type
            </span>
            <div className="chips">
              {(["Manual Blasting", "Auto Blasting"] as BlastType[]).map((b) => (
                <button
                  key={b}
                  className="chip"
                  aria-pressed={effectiveBlast === b}
                  onClick={() => setBlastType(b)}
                >
                  {b}
                </button>
              ))}
            </div>
            {lotValid && !effectiveBlast && (
              <p className="hint" style={{ marginTop: 8 }}>
                Needed before process in. The upstream station left this open.
              </p>
            )}
          </div>
        )}

        <div>
          <span className="field-label">
            <CalendarClock size={14} />
            Time to record
          </span>
          <div className="seg">
            <button
              aria-pressed={timeMode === "now"}
              onClick={() => setTimeMode("now")}
            >
              <Clock size={15} />
              Right now
            </button>
            <button
              aria-pressed={timeMode === "custom"}
              onClick={() => {
                setTimeMode("custom");
                setCustomDate(todayInPhoenix());
                setCustomTime(nowClockInPhoenix());
              }}
            >
              <CalendarClock size={15} />
              Pick a time
            </button>
          </div>
          {timeMode === "custom" && (
            <div className="grid-2" style={{ marginTop: 10 }}>
              <input
                type="date"
                className="input"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
              <input
                type="time"
                className="input"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* the phases */}
      <div className="phases">
        {phases.map((p, idx) => (
          <div key={p.id} style={{ display: "contents" }}>
          <section className={`phase ${p.id}`}>
            <div className="phase-head">
              <span className="phase-mark">{p.icon}</span>
              <div style={{ minWidth: 0 }}>
                <div className="phase-name">{p.name}</div>
                <div className="phase-sub">{p.sub}</div>
              </div>
              {p.live && (
                <div className="phase-live">
                  <div className="n">{p.live}</div>
                  <div className="l">{p.running ? "running" : "recorded"}</div>
                </div>
              )}
            </div>

            <div className="phase-body">
              {p.fields.map((f) => {
                const mode = expectation(f);
                const isArmed = armed === f;
                const val = existing?.[f] ?? null;
                const isIn = f.endsWith("_in");

                const word = isIn ? "In" : "Out";

                return (
                  <button
                    key={f}
                    className={[
                      "tbtn",
                      isIn ? "in" : "out",
                      isArmed ? "armed" : mode,
                    ].join(" ")}
                    disabled={busy || !lotValid}
                    onClick={() => void press(f)}
                  >
                    <span className="t-top">
                      {isIn ? <LogIn size={18} /> : <LogOut size={18} />}
                      {p.name} {word.toLowerCase()}
                      {mode === "filled" && (
                        <span className="tick">
                          <CircleCheck size={16} />
                        </span>
                      )}
                    </span>
                    {isArmed ? (
                      <span className="t-val">
                        Out of order. Tap again to record it.
                      </span>
                    ) : val ? (
                      <>
                        <span className="t-val mono">{formatStamp(val)}</span>
                        {linkFilled(f) && (
                          <span className="link-note">
                            <Link2 size={12} />
                            Set with {f === "queue_out" ? "process in" : "queue out"}
                          </span>
                        )}
                        {arrivedFrom && f === entryField(step) && (
                          <span className="arrived">
                            <CornerDownRight size={12} />
                            Arrived from {arrivedFrom}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="t-val">
                        {mode === "ready" ? "Tap to record" : waitingOn(f)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {linkable && idx === 0 && phases.length === 2 && (
            <div className={`link-strip ${linked ? "on" : ""}`}>
              <span className="link-line" />
              <button
                className="link-toggle"
                onClick={() => setLinked((v) => !v)}
                aria-pressed={linked}
              >
                {linked ? <Link2 size={14} /> : <Unlink size={14} />}
                {linked
                  ? "Queue out starts the process"
                  : "Logged separately"}
              </button>
              <span className="link-line" />
            </div>
          )}
          </div>
        ))}
      </div>

      {!lotValid && (
        <div className="hint">
          Choose a lot from the line, or type one, before recording a time.
        </div>
      )}

      {(!step.has_process || !step.has_queue) && (
        <div className="badge warn">
          <TriangleAlert size={13} />
          {step.has_process
            ? "This step records process time only"
            : "This step records queue time only"}
        </div>
      )}

      {step.is_final && existing?.process_out && (
        <div className="lot-status known">
          <CircleCheck size={16} />
          <span>
            Lot {lotId} is complete and has come off the active list.
          </span>
        </div>
      )}

      {/* recent */}
      <div className="panel tight">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Recent records at this step</strong>
          <div className="spacer" />
          <button
            className="btn sm ghost"
            onClick={() => void Promise.all([loadRecent(), lookup()])}
            disabled={lookingUp}
          >
            <RotateCcw size={14} />
            Refresh
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="empty">Nothing logged here yet.</div>
        ) : (
          <div className="stack scroll-y" style={{ gap: 8 }}>
            {recent.map((l) => (
              <div className="log-item" key={l.id}>
                <button
                  style={{
                    minWidth: 0,
                    flex: 1,
                    textAlign: "left",
                    background: "none",
                  }}
                  onClick={() => setLotId(l.lot_id)}
                  title={`Load ${l.lot_id}`}
                >
                  <div className="lot mono">{l.lot_id}</div>
                  <div className="log-meta mono">
                    {l.queue_in && (
                      <span>
                        <LogIn size={11} /> Q {formatClock(l.queue_in)}
                      </span>
                    )}
                    {l.queue_out && (
                      <span>
                        <LogOut size={11} /> Q {formatClock(l.queue_out)}
                      </span>
                    )}
                    {l.process_in && (
                      <span>
                        <LogIn size={11} /> P {formatClock(l.process_in)}
                      </span>
                    )}
                    {l.process_out && (
                      <span>
                        <LogOut size={11} /> P {formatClock(l.process_out)}
                      </span>
                    )}
                    <span>{l.log_date}</span>
                  </div>
                </button>
                <button
                  className="btn sm icon ghost"
                  aria-label={`Edit ${l.lot_id}`}
                  onClick={() => setEditing(l)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="btn sm icon danger"
                  aria-label={`Delete ${l.lot_id}`}
                  onClick={() => void softDelete(l)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {conflict && (
        <div className="overlay" onClick={() => setConflict(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{FIELD_LABEL[conflict.field]} is already filled</h3>
            <p className="hint">
              Lot {conflict.log.lot_id} already has{" "}
              {FIELD_LABEL[conflict.field].toLowerCase()} at{" "}
              <span className="mono">
                {formatStamp(conflict.log[conflict.field])}
              </span>
              . Replacing it keeps the old value in the audit trail.
            </p>
            <div className="row">
              <button
                className="btn primary"
                onClick={() => void press(conflict.field, "overwrite")}
              >
                Replace the time
              </button>
              <button
                className="btn"
                onClick={() => void press(conflict.field, "new")}
              >
                Start a second record
              </button>
              <button className="btn ghost" onClick={() => setConflict(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {routing && (
        <RouteDialog
          lotId={routing.lot}
          from={step}
          steps={allSteps}
          stamp={formatStamp(routing.stamp)}
          busy={routeBusy}
          onHold={() => {
            setRouting(null);
            setLotId("");
            onToast(`Lot ${routing.lot} is holding at ${step.step_name}.`);
          }}
          onConfirm={(c) => void routeTo(c)}
        />
      )}

      {editing && (
        <EditLogModal
          log={editing}
          step={step}
          operators={operators}
          editorId={operatorId || null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([loadRecent(), lookup()]);
            onLotsChanged();
            onToast("Record updated.");
          }}
        />
      )}
    </div>
  );
}
