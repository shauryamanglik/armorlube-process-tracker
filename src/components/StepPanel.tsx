"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  History,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { enqueue } from "@/lib/offline";
import {
  FIELD_LABEL,
  LOT_PATTERN,
  type BlastType,
  type LogRow,
  type Operator,
  type Step,
  type TimeField,
} from "@/lib/types";
import {
  formatClock,
  formatStamp,
  nowClockInPhoenix,
  phoenixToIso,
  todayInPhoenix,
} from "@/lib/time";
import EditLogModal from "./EditLogModal";

type Props = {
  step: Step;
  operators: Operator[];
  onOperatorsChanged: () => void;
  compact?: boolean;
  onToast: (msg: string) => void;
};

type Conflict = {
  field: TimeField;
  log: LogRow;
  stamp: string;
};

export default function StepPanel({
  step,
  operators,
  onOperatorsChanged,
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
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [editing, setEditing] = useState<LogRow | null>(null);

  const lotValid = LOT_PATTERN.test(lotId);

  const fields = useMemo(() => {
    const f: TimeField[] = [];
    if (step.has_queue) f.push("queue_in", "queue_out");
    if (step.has_process) f.push("process_in", "process_out");
    return f;
  }, [step]);

  const loadLogs = useCallback(async () => {
    const { data } = await supabase
      .from("logs")
      .select("*")
      .eq("step_id", step.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (data) setLogs(data as LogRow[]);
  }, [step.id]);

  useEffect(() => {
    void loadLogs();
    const t = setInterval(() => void loadLogs(), 30000);
    return () => clearInterval(t);
  }, [loadLogs]);

  /** The record this lot is currently working against, if any. */
  const activeLog = useMemo(
    () => logs.find((l) => l.lot_id === lotId) ?? null,
    [logs, lotId]
  );

  function stampNow(): string {
    if (timeMode === "now") return new Date().toISOString();
    return phoenixToIso(customDate, customTime);
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
    if (error) enqueue({ kind: "insert", table: "log_history", payload, at: Date.now() });
  }

  async function resolveOperator(): Promise<string | null> {
    if (!showOther) return operatorId || null;
    const name = otherName.trim();
    if (!name) return null;

    const existing = operators.find(
      (o) => o.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from("operators")
      .insert({ name })
      .select()
      .single();
    if (error || !data) return null;
    onOperatorsChanged();
    return (data as Operator).id;
  }

  async function press(field: TimeField, force?: "overwrite" | "new") {
    if (busy) return;

    if (!operatorId && !showOther) {
      onToast("Pick your name first.");
      return;
    }
    if (!lotValid) {
      onToast("Enter a lot number as 000000-00.");
      return;
    }
    if (step.has_blast_type && !blastType) {
      onToast("Choose a blast type.");
      return;
    }

    setBusy(true);
    try {
      const opId = await resolveOperator();
      if (!opId) {
        onToast("Could not save that operator name.");
        return;
      }

      const ts = stampNow();
      const target = force === "new" ? null : activeLog;

      if (target && target[field] && force !== "overwrite") {
        setConflict({ field, log: target, stamp: ts });
        return;
      }

      if (!target) {
        const payload = {
          step_id: step.id,
          operator_id: opId,
          lot_id: lotId,
          log_date: timeMode === "custom" ? customDate : todayInPhoenix(),
          blast_type: step.has_blast_type ? blastType : null,
          [field]: ts,
        };
        const { error } = await supabase.from("logs").insert(payload);
        if (error) {
          enqueue({ kind: "insert", table: "logs", payload, at: Date.now() });
          onToast("Saved on this iPad. It will sync when wifi returns.");
        } else {
          onToast(`${FIELD_LABEL[field]} recorded for ${lotId}.`);
        }
      } else {
        const prev = target[field];
        const payload = { [field]: ts, operator_id: opId };
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
          if (prev) await addHistory(target.id, field, prev, ts);
          onToast(`${FIELD_LABEL[field]} recorded for ${lotId}.`);
        }
      }

      setConflict(null);
      await loadLogs();
    } finally {
      setBusy(false);
    }
  }

  async function softDelete(log: LogRow) {
    const ok = window.confirm(
      `Delete the record for lot ${log.lot_id}? It stays in the audit trail and can be restored from the dashboard.`
    );
    if (!ok) return;
    const stamp = new Date().toISOString();
    const { error } = await supabase
      .from("logs")
      .update({ deleted_at: stamp })
      .eq("id", log.id);
    if (error) {
      onToast("Could not delete right now. Check the connection.");
      return;
    }
    await addHistory(log.id, "deleted", null, stamp);
    onToast(`Record for ${log.lot_id} deleted.`);
    await loadLogs();
  }

  const iconFor = (f: TimeField) =>
    f.endsWith("_in") ? <LogIn size={19} /> : <LogOut size={19} />;

  return (
    <div className="stack">
      {/* who */}
      <div className="panel tight">
        <label className="field-label">
          <Users size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          Operator
        </label>
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
            <Plus size={14} style={{ verticalAlign: -2 }} /> Other
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

      {/* what */}
      <div className="panel tight stack">
        <div>
          <label className="field-label">Lot number</label>
          <input
            className={`input big mono ${lotId && !lotValid ? "invalid" : ""}`}
            inputMode="numeric"
            placeholder="000000-00"
            value={lotId}
            onChange={(e) => setLotId(e.target.value.trim())}
          />
          {lotId && !lotValid && (
            <div className="err" style={{ marginTop: 6 }}>
              Lot numbers are six digits, a dash, then two digits.
            </div>
          )}
        </div>

        {step.has_blast_type && (
          <div>
            <label className="field-label">Blast type</label>
            <div className="chips">
              {(["Manual Blasting", "Auto Blasting"] as BlastType[]).map((b) => (
                <button
                  key={b}
                  className="chip"
                  aria-pressed={blastType === b}
                  onClick={() => setBlastType(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="field-label">Time to record</label>
          <div className="row">
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
                <History size={15} />
                Pick a time
              </button>
            </div>
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

      {/* the buttons */}
      <div className={`actions ${compact ? "" : "two"}`}>
        {fields.map((f) => {
          const filled = activeLog?.[f] ?? null;
          return (
            <button
              key={f}
              className={`action ${f.endsWith("_in") ? "in" : "out"} ${
                filled ? "done" : ""
              }`}
              disabled={busy}
              onClick={() => void press(f)}
            >
              <span className="a-title">
                {iconFor(f)}
                {FIELD_LABEL[f]}
              </span>
              {filled ? (
                <>
                  <span className="a-value mono">{formatStamp(filled)}</span>
                  <span className="a-stamp">
                    <Check size={15} style={{ verticalAlign: -2 }} /> logged
                  </span>
                </>
              ) : (
                <span className="a-empty">
                  {lotValid ? `Tap to log for ${lotId}` : "Enter a lot number"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!step.has_process && (
        <div className="badge warn">
          <AlertTriangle size={13} />
          This step records queue time only
        </div>
      )}
      {!step.has_queue && (
        <div className="badge warn">
          <AlertTriangle size={13} />
          This step records process time only
        </div>
      )}

      {/* recent */}
      <div className="panel tight">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Recent records at this step</strong>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={() => void loadLogs()}>
            <RotateCcw size={14} />
            Refresh
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="empty">Nothing logged here yet.</div>
        ) : (
          <div className="stack scroll-y" style={{ gap: 8 }}>
            {logs.map((l) => (
              <div className="log-item" key={l.id}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lot mono">{l.lot_id}</div>
                  <div className="log-meta mono">
                    {l.queue_in && <span>Q in {formatClock(l.queue_in)}</span>}
                    {l.queue_out && <span>Q out {formatClock(l.queue_out)}</span>}
                    {l.process_in && <span>P in {formatClock(l.process_in)}</span>}
                    {l.process_out && (
                      <span>P out {formatClock(l.process_out)}</span>
                    )}
                    <span>{l.log_date}</span>
                  </div>
                </div>
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

      {/* overwrite question */}
      {conflict && (
        <div className="overlay" onClick={() => setConflict(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{FIELD_LABEL[conflict.field]} is already filled</h3>
            <p className="hint" style={{ marginTop: 6 }}>
              Lot {conflict.log.lot_id} already has{" "}
              {FIELD_LABEL[conflict.field].toLowerCase()} at{" "}
              <span className="mono">
                {formatStamp(conflict.log[conflict.field])}
              </span>
              . Replacing it keeps the old value in the audit trail.
            </p>
            <div className="row" style={{ marginTop: 18 }}>
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

      {editing && (
        <EditLogModal
          log={editing}
          step={step}
          operators={operators}
          editorId={operatorId || null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await loadLogs();
            onToast("Record updated.");
          }}
        />
      )}
    </div>
  );
}
