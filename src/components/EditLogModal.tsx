"use client";

import { useEffect, useState } from "react";
import { History, Save, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  FIELD_LABEL,
  LOT_HINT,
  LOT_PATTERN,
  normalizeLot,
  TIME_FIELDS,
  type BlastType,
  type HistoryRow,
  type LogRow,
  type Operator,
  type Step,
  type TimeField,
} from "@/lib/types";
import {
  formatStamp,
  isoToPhoenixDate,
  isoToPhoenixTime,
  phoenixToIso,
} from "@/lib/time";

type Props = {
  log: LogRow;
  step: Step;
  operators: Operator[];
  editorId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

type Pair = { date: string; time: string };

function toPair(iso: string | null): Pair {
  if (!iso) return { date: "", time: "" };
  return { date: isoToPhoenixDate(iso), time: isoToPhoenixTime(iso) };
}

export default function EditLogModal({
  log,
  step,
  operators,
  editorId,
  onClose,
  onSaved,
}: Props) {
  const [lotId, setLotId] = useState(log.lot_id);
  const [logDate, setLogDate] = useState(log.log_date);
  const [operatorId, setOperatorId] = useState(log.operator_id);
  const [blastType, setBlastType] = useState<BlastType | "">(
    log.blast_type ?? ""
  );
  const [notes, setNotes] = useState(log.notes ?? "");
  const [pairs, setPairs] = useState<Record<TimeField, Pair>>({
    queue_in: toPair(log.queue_in),
    queue_out: toPair(log.queue_out),
    process_in: toPair(log.process_in),
    process_out: toPair(log.process_out),
  });
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("log_history")
        .select("*")
        .eq("log_id", log.id)
        .order("changed_at", { ascending: false });
      if (data) setHistory(data as HistoryRow[]);
    })();
  }, [log.id]);

  const visible = TIME_FIELDS.filter((f) =>
    f.startsWith("queue") ? step.has_queue : step.has_process
  );

  function setPair(f: TimeField, patch: Partial<Pair>) {
    setPairs((p) => ({ ...p, [f]: { ...p[f], ...patch } }));
  }

  async function save() {
    if (!LOT_PATTERN.test(lotId)) {
      setError(LOT_HINT);
      return;
    }
    setSaving(true);
    setError(null);

    const next: Record<string, unknown> = {
      lot_id: lotId,
      log_date: logDate,
      operator_id: operatorId,
      blast_type: step.has_blast_type ? blastType || null : null,
      notes: notes || null,
    };

    for (const f of TIME_FIELDS) {
      const p = pairs[f];
      next[f] = p.date && p.time ? phoenixToIso(p.date, p.time) : null;
    }

    const changes: { field: string; from: string | null; to: string | null }[] =
      [];
    for (const key of Object.keys(next)) {
      const before = (log as unknown as Record<string, unknown>)[key] ?? null;
      const after = next[key] ?? null;
      const b = before === null ? null : String(before);
      const a = after === null ? null : String(after);
      if (b !== a) changes.push({ field: key, from: b, to: a });
    }

    if (changes.length === 0) {
      setSaving(false);
      onClose();
      return;
    }

    const { error: updErr } = await supabase
      .from("logs")
      .update(next)
      .eq("id", log.id);

    if (updErr) {
      setError("Could not save. Check the connection and try again.");
      setSaving(false);
      return;
    }

    await supabase.from("log_history").insert(
      changes.map((c) => ({
        log_id: log.id,
        changed_by: editorId,
        field_changed: c.field,
        old_value: c.from,
        new_value: c.to,
      }))
    );

    setSaving(false);
    onSaved();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ position: "sticky", top: -22, background: "var(--surface)", paddingTop: 2, paddingBottom: 6, zIndex: 2 }}>
          <h3>Edit record</h3>
          <div className="spacer" />
          <button className="btn sm icon ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div>
          <label className="field-label">Lot number</label>
          <input
            className="input mono"
            value={lotId}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setLotId(normalizeLot(e.target.value))}
          />
        </div>

        <div className="grid-2">
          <div>
            <label className="field-label">Log date</label>
            <input
              type="date"
              className="input"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Operator</label>
            <select
              className="select"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
            >
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {step.has_blast_type && (
          <div>
            <label className="field-label">Blast type</label>
            <select
              className="select"
              value={blastType}
              onChange={(e) => setBlastType(e.target.value as BlastType | "")}
            >
              <option value="">Not set</option>
              <option value="Manual Blasting">Manual Blasting</option>
              <option value="Auto Blasting">Auto Blasting</option>
            </select>
          </div>
        )}

        <div className="divider" />

        {visible.map((f) => (
          <div key={f}>
            <label className="field-label">{FIELD_LABEL[f]}</label>
            <div className="grid-2">
              <input
                type="date"
                className="input"
                value={pairs[f].date}
                onChange={(e) => setPair(f, { date: e.target.value })}
              />
              <input
                type="time"
                className="input"
                value={pairs[f].time}
                onChange={(e) => setPair(f, { time: e.target.value })}
              />
            </div>
            {(pairs[f].date || pairs[f].time) && (
              <button
                className="btn sm ghost"
                style={{ marginTop: 6 }}
                onClick={() => setPair(f, { date: "", time: "" })}
              >
                Clear this time
              </button>
            )}
          </div>
        ))}

        <div>
          <label className="field-label">Notes</label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth flagging about this lot"
          />
        </div>

        {error && <div className="err">{error}</div>}

        <div className="row">
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            {saving ? "Saving" : "Save changes"}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>

        {history.length > 0 && (
          <>
            <div className="divider" />
            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <History size={15} color="#9aa8b8" />
                <strong style={{ fontSize: 14 }}>Change history</strong>
              </div>
              <div className="stack scroll-y" style={{ gap: 6 }}>
                {history.map((h) => (
                  <div key={h.id} className="hint">
                    <span className="mono">{formatStamp(h.changed_at)}</span>
                    {"  "}
                    {FIELD_LABEL[h.field_changed as TimeField] ?? h.field_changed}
                    {": "}
                    {h.old_value ? formatStamp(h.old_value) || h.old_value : "empty"}
                    {" to "}
                    {h.new_value ? formatStamp(h.new_value) || h.new_value : "empty"}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
