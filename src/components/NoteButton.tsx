"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, StickyNote, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Note = { stepName: string; note: string; pass: number; mine: boolean };

/**
 * A note for this lot at this station.
 *
 * It lives on the station's own record, so every station keeps its own note
 * and none overwrites another. The button is small and sits beside the lot
 * number, and everything else happens in a dialog, so it adds no height to
 * the screen and never pushes the buttons off it.
 *
 * Notes left at earlier stations are shown read only underneath, because the
 * person at coating usually needs to know what the person at blasting saw.
 */
export default function NoteButton({
  lotId,
  recordId,
  stepName,
  onSaved,
}: {
  lotId: string;
  /** The record for this lot at this station. No record, no note yet. */
  recordId: string | null;
  stepName: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [others, setOthers] = useState<Note[]>([]);
  const [hasNote, setHasNote] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!lotId) return;
    const { data } = await supabase
      .from("logs")
      .select("id, notes, pass_no, steps(step_name, sort_order)")
      .eq("lot_id", lotId)
      .is("deleted_at", null);

    type Row = {
      id: string;
      notes: string | null;
      pass_no: number;
      steps: { step_name: string; sort_order: number } | null;
    };
    const rows = (data ?? []) as unknown as Row[];

    const mine = rows.find((r) => r.id === recordId);
    setText(mine?.notes ?? "");
    setHasNote(Boolean(mine?.notes?.trim()));

    setOthers(
      rows
        .filter((r) => r.id !== recordId && r.notes && r.notes.trim())
        .sort((a, b) => (a.steps?.sort_order ?? 0) - (b.steps?.sort_order ?? 0))
        .map((r) => ({
          stepName: r.steps?.step_name ?? "Unknown step",
          note: r.notes as string,
          pass: r.pass_no,
          mine: false,
        }))
    );
  }, [lotId, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!recordId) return;
    setSaving(true);
    try {
      await supabase
        .from("logs")
        .update({ notes: text.trim() || null })
        .eq("id", recordId);
      setHasNote(Boolean(text.trim()));
      setOpen(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  const earlier = others.length;

  return (
    <>
      <button
        className={`note-btn ${hasNote ? "has" : ""}`}
        disabled={!lotId}
        onClick={() => {
          void load();
          setOpen(true);
        }}
        title={
          recordId
            ? "Add a note for this lot here"
            : "Start or queue it here to add a note"
        }
      >
        <StickyNote size={16} />
        {hasNote ? "Note" : "Add note"}
        {earlier > 0 && <span className="note-count">{earlier}</span>}
      </button>

      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="modal note-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3 style={{ margin: 0 }}>
                Note for <span className="mono">{lotId}</span>
              </h3>
              <div className="spacer" />
              <button
                className="btn sm icon ghost"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            {recordId ? (
              <>
                <span className="field-label" style={{ margin: 0 }}>
                  At {stepName}
                </span>
                <textarea
                  className="input note-text"
                  rows={4}
                  autoFocus
                  placeholder="Anything the next person should know"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="row">
                  <button
                    className="btn primary"
                    disabled={saving}
                    onClick={() => void save()}
                  >
                    <Check size={16} />
                    {saving ? "Saving" : "Save note"}
                  </button>
                  {hasNote && (
                    <button
                      className="btn ghost"
                      onClick={() => setText("")}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="hint" style={{ margin: 0 }}>
                This lot has nothing recorded at {stepName} yet. Press Start
                first, then add a note.
              </p>
            )}

            {earlier > 0 && (
              <div className="note-earlier">
                <span className="field-label" style={{ margin: 0 }}>
                  From earlier stations
                </span>
                {others.map((o, i) => (
                  <div className="note-item" key={i}>
                    <div className="note-where">
                      {o.stepName}
                      {o.pass > 1 && (
                        <span className="badge warn" style={{ marginLeft: 6 }}>
                          pass {o.pass}
                        </span>
                      )}
                    </div>
                    <div className="note-body">{o.note}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
