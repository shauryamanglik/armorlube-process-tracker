"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Cog,
  Hourglass,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  isoToPhoenixDate,
  isoToPhoenixTime,
  phoenixToIso,
  todayInPhoenix,
} from "@/lib/time";
import type {
  BlastType,
  Operator,
  Segment,
  SegmentKind,
  Step,
} from "@/lib/types";

type Draft = {
  id?: string;
  kind: SegmentKind;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  crew: string[];
  removed?: boolean;
};

export type EditorTarget =
  | {
      mode: "edit";
      kind: "log";
      id: string;
      step: Step;
      lotId: string;
      logDate: string;
      blastType: BlastType | null;
      notes: string | null;
      segments: Segment[];
    }
  | {
      mode: "edit";
      kind: "po";
      id: string;
      step: Step;
      poNumber: string;
      logDate: string;
      notes: string | null;
      segments: Segment[];
    }
  | {
      /** Filling in a step that was passed over. */
      mode: "create";
      kind: "log";
      step: Step;
      lotId: string;
      passNo: number;
    };

function toDraft(s: Segment): Draft {
  return {
    id: s.id,
    kind: s.kind,
    startDate: isoToPhoenixDate(s.started_at),
    startTime: isoToPhoenixTime(s.started_at),
    endDate: s.ended_at ? isoToPhoenixDate(s.ended_at) : "",
    endTime: s.ended_at ? isoToPhoenixTime(s.ended_at) : "",
    crew: [...new Set([...(s.started_by ?? []), ...(s.ended_by ?? [])])],
  };
}

export default function RecordEditor({
  target,
  operators,
  onClose,
  onSaved,
}: {
  target: EditorTarget;
  operators: Operator[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = target.mode === "create";
  const step = target.step;

  const [logDate, setLogDate] = useState(
    target.mode === "edit" ? target.logDate : todayInPhoenix()
  );
  const [blastType, setBlastType] = useState<BlastType | "">(
    target.mode === "edit" && target.kind === "log"
      ? target.blastType ?? ""
      : ""
  );
  const [notes, setNotes] = useState(
    target.mode === "edit" ? target.notes ?? "" : ""
  );
  const [drafts, setDrafts] = useState<Draft[]>(
    target.mode === "edit"
      ? target.segments
          .slice()
          .sort((a, b) => a.started_at.localeCompare(b.started_at))
          .map(toDraft)
      : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A step that was passed over starts with a sensible shape to fill in.
  useEffect(() => {
    if (!isCreate || drafts.length > 0) return;
    const seed: Draft[] = [];
    if (step.has_queue)
      seed.push({
        kind: "queue",
        startDate: todayInPhoenix(),
        startTime: "07:00",
        endDate: todayInPhoenix(),
        endTime: "08:00",
        crew: [],
      });
    if (step.has_process)
      seed.push({
        kind: "process",
        startDate: todayInPhoenix(),
        startTime: "08:00",
        endDate: todayInPhoenix(),
        endTime: "09:00",
        crew: [],
      });
    setDrafts(seed);
  }, [isCreate, step, drafts.length]);

  const visible = useMemo(() => drafts.filter((d) => !d.removed), [drafts]);

  function patch(i: number, p: Partial<Draft>) {
    setDrafts((d) => d.map((x, n) => (n === i ? { ...x, ...p } : x)));
  }

  function addStretch(kind: SegmentKind) {
    setDrafts((d) => [
      ...d,
      {
        kind,
        startDate: logDate || todayInPhoenix(),
        startTime: "08:00",
        endDate: logDate || todayInPhoenix(),
        endTime: "09:00",
        crew: [],
      },
    ]);
  }

  function toggleCrew(i: number, id: string) {
    const cur = drafts[i].crew;
    patch(i, {
      crew: cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id],
    });
  }

  function validate(): string | null {
    for (const d of visible) {
      if (!d.startDate || !d.startTime) return "Every stretch needs a start.";
      if ((d.endDate && !d.endTime) || (!d.endDate && d.endTime))
        return "An end needs both a date and a time, or leave both blank to mean still running.";
      if (d.endDate && d.endTime) {
        const a = phoenixToIso(d.startDate, d.startTime);
        const b = phoenixToIso(d.endDate, d.endTime);
        if (new Date(b) < new Date(a))
          return "A stretch cannot end before it starts.";
      }
    }
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);

    try {
      let recordId: string;
      const parentCol = target.kind === "log" ? "log_id" : "po_log_id";

      if (isCreate && target.kind === "log") {
        const { data, error: insErr } = await supabase
          .from("logs")
          .insert({
            step_id: step.id,
            operator_id: visible[0]?.crew[0] ?? operators[0]?.id,
            lot_id: target.lotId,
            log_date: logDate,
            blast_type: step.has_blast_type ? blastType || null : null,
            notes: notes || null,
            pass_no: target.passNo,
          })
          .select()
          .single();
        if (insErr || !data) {
          setError("Could not create that record.");
          return;
        }
        recordId = data.id as string;
      } else if (target.mode === "edit") {
        recordId = target.id;
        const table = target.kind === "log" ? "logs" : "po_logs";
        const patchBody: Record<string, unknown> = {
          log_date: logDate,
          notes: notes || null,
        };
        if (target.kind === "log" && step.has_blast_type) {
          patchBody.blast_type = blastType || null;
        }
        const { error: updErr } = await supabase
          .from(table)
          .update(patchBody)
          .eq("id", recordId);
        if (updErr) {
          setError("Could not save that record.");
          return;
        }
      } else {
        setError("Nothing to save.");
        return;
      }

      // Apply the stretches: remove, update, insert.
      for (const d of drafts) {
        const started = phoenixToIso(d.startDate, d.startTime);
        const ended =
          d.endDate && d.endTime ? phoenixToIso(d.endDate, d.endTime) : null;

        if (d.removed && d.id) {
          await supabase.from("segments").delete().eq("id", d.id);
          continue;
        }
        if (d.removed) continue;

        if (d.id) {
          await supabase
            .from("segments")
            .update({
              kind: d.kind,
              started_at: started,
              ended_at: ended,
              started_by: d.crew,
              ended_by: ended ? d.crew : [],
            })
            .eq("id", d.id);
        } else {
          await supabase.from("segments").insert({
            [parentCol]: recordId,
            kind: d.kind,
            started_at: started,
            ended_at: ended,
            started_by: d.crew,
            ended_by: ended ? d.crew : [],
          });
        }
      }

      // Lots keep an audit trail, so note that this was changed by hand.
      if (target.kind === "log") {
        await supabase.from("log_history").insert({
          log_id: recordId,
          changed_by: null,
          field_changed: isCreate ? "created from dashboard" : "edited from dashboard",
          old_value: null,
          new_value: `${visible.length} stretches`,
        });
      }

      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const title = isCreate
    ? `Add ${step.step_name}`
    : `Edit ${step.step_name}`;
  const reference =
    target.kind === "log"
      ? target.mode === "edit"
        ? target.lotId
        : target.lotId
      : target.mode === "edit"
      ? target.poNumber
      : "";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="row detail-head">
          <div style={{ minWidth: 0 }}>
            <h3>{title}</h3>
            <div className="hint mono">{reference}</div>
          </div>
          <div className="spacer" />
          <button className="btn sm icon ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        {isCreate && (
          <div className="lot-status new">
            <TriangleAlert size={16} />
            <span>
              This step was passed over. Adding it here fills the gap by hand, so
              put in the times as they actually happened rather than now.
            </span>
          </div>
        )}

        <div className="grid-2">
          <div>
            <span className="field-label">Record date</span>
            <input
              type="date"
              className="input"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
            />
          </div>
          {target.kind === "log" && step.has_blast_type && (
            <div>
              <span className="field-label">Blast type</span>
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
        </div>

        <div>
          <span className="field-label">Notes</span>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why this was edited, or anything worth recording"
          />
        </div>

        <div className="divider" />

        <div className="row">
          <strong style={{ fontSize: 14 }}>Stretches</strong>
          <div className="spacer" />
          {step.has_queue && (
            <button className="btn sm" onClick={() => addStretch("queue")}>
              <Plus size={14} />
              Queue
            </button>
          )}
          {step.has_process && (
            <button className="btn sm" onClick={() => addStretch("process")}>
              <Plus size={14} />
              Process
            </button>
          )}
        </div>

        {visible.length === 0 && (
          <div className="empty">
            No stretches. Add a queue or process stretch above.
          </div>
        )}

        {drafts.map((d, i) =>
          d.removed ? null : (
            <div className={`edit-seg ${d.kind}`} key={d.id ?? `new-${i}`}>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className={`state-pill ${d.kind}`}>
                  {d.kind === "queue" ? (
                    <Hourglass size={12} />
                  ) : (
                    <Cog size={12} />
                  )}
                  {d.kind === "queue" ? "Queue" : "Process"}
                </span>
                <div className="spacer" />
                <button
                  className="btn sm icon danger"
                  aria-label="Remove stretch"
                  onClick={() => patch(i, { removed: true })}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid-4">
                <div>
                  <span className="field-label">Start date</span>
                  <input
                    type="date"
                    className="input"
                    value={d.startDate}
                    onChange={(e) => patch(i, { startDate: e.target.value })}
                  />
                </div>
                <div>
                  <span className="field-label">Start time</span>
                  <input
                    type="time"
                    className="input"
                    value={d.startTime}
                    onChange={(e) => patch(i, { startTime: e.target.value })}
                  />
                </div>
                <div>
                  <span className="field-label">End date</span>
                  <input
                    type="date"
                    className="input"
                    value={d.endDate}
                    onChange={(e) => patch(i, { endDate: e.target.value })}
                  />
                </div>
                <div>
                  <span className="field-label">End time</span>
                  <input
                    type="time"
                    className="input"
                    value={d.endTime}
                    onChange={(e) => patch(i, { endTime: e.target.value })}
                  />
                </div>
              </div>

              {!d.endDate && !d.endTime && (
                <p className="hint" style={{ marginTop: 6 }}>
                  No end means this stretch is still running.
                </p>
              )}

              <span className="field-label" style={{ marginTop: 10 }}>
                Who worked it
              </span>
              <div className="chips">
                {operators.map((o) => (
                  <button
                    key={o.id}
                    className="chip"
                    aria-pressed={d.crew.includes(o.id)}
                    onClick={() => toggleCrew(i, o.id)}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {error && <div className="err">{error}</div>}

        <div className="row">
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            <Save size={16} />
            {saving ? "Saving" : isCreate ? "Add record" : "Save changes"}
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
