"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CircleCheck,
  Clock,
  CornerUpLeft,
  Pencil,
  Send,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Wind,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  exitField,
  LOT_HINT,
  LOT_PATTERN,
  normalizeLot,
  type ActiveLot,
  type BlastType,
  type LogRow,
  type Operator,
  type Segment,
  type Step,
} from "@/lib/types";
import {
  DEFAULT_RULES,
  formatDuration,
  formatStamp,
  nowClockInPhoenix,
  phoenixToIso,
  todayInPhoenix,
} from "@/lib/time";
import { openSegment, rollup } from "@/lib/segments";
import {
  applyPlan,
  loadSegments,
  planAction,
  type Action,
} from "@/lib/segmentActions";
import CrewPicker from "./CrewPicker";
import RecordEditor, { type EditorTarget } from "./RecordEditor";
import LotPicker, { type LotHere, type LotState } from "./LotPicker";
import PhaseControls, { liveState } from "./PhaseControls";
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

export default function StepPanel({
  step,
  allSteps,
  operators,
  lots,
  onOperatorsChanged,
  onLotsChanged,
  onToast,
}: Props) {
  const [crew, setCrew] = useState<string[]>([]);
  const [lotId, setLotId] = useState("");
  const [blastType, setBlastType] = useState<BlastType | "">("");
  const [timeMode, setTimeMode] = useState<"now" | "custom">("now");
  const [customDate, setCustomDate] = useState(todayInPhoenix());
  const [customTime, setCustomTime] = useState(nowClockInPhoenix());

  const [recent, setRecent] = useState<LogRow[]>([]);
  const [record, setRecord] = useState<LogRow | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);
  const [routing, setRouting] = useState<{ lot: string; stamp: string } | null>(
    null
  );
  const [routeBusy, setRouteBusy] = useState(false);
  const [editing, setEditing] = useState<EditorTarget | null>(null);

  const lotValid = LOT_PATTERN.test(lotId);


  const [hereStates, setHereStates] = useState<LotHere[]>([]);

  /**
   * Lots with a record at this station, and whether each is waiting or being
   * worked. This is the default list an operator sees, because it is almost
   * always the one they want.
   */
  const loadHere = useCallback(async () => {
    const { data: recs } = await supabase
      .from("logs")
      .select("id, lot_id, pass_no")
      .eq("step_id", step.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(120);
    if (!recs || recs.length === 0) {
      setHereStates([]);
      return;
    }
    const ids = recs.map((r) => r.id as string);
    const { data: segs } = await supabase
      .from("segments")
      .select("*")
      .in("log_id", ids);

    const byLog = new Map<string, Segment[]>();
    for (const sg of (segs ?? []) as Segment[]) {
      if (!sg.log_id) continue;
      const list = byLog.get(sg.log_id) ?? [];
      list.push(sg);
      byLog.set(sg.log_id, list);
    }

    /**
     * A lot is at this step when it has a stretch still open here. That is
     * the same rule the dashboard board uses, so the two can never disagree.
     *
     * Two things used to break that. Records with nothing logged at all read
     * as "Not started" and stayed in this list forever, and only the newest
     * record per lot was checked, so an open stretch on an earlier pass was
     * missed. Both are handled by looking at every record the lot has here
     * and asking only whether something is open.
     */
    const byLot = new Map<string, Segment[]>();
    for (const r of recs) {
      const lot = r.lot_id as string;
      const segsFor = byLog.get(r.id as string) ?? [];
      byLot.set(lot, [...(byLot.get(lot) ?? []), ...segsFor]);
    }

    const out: LotHere[] = [];
    for (const [lot, segsFor] of byLot) {
      const st = liveState(segsFor);
      // Only work that is genuinely open is "at" this step.
      if (st.tone !== "queue" && st.tone !== "process") continue;
      out.push({ lot_id: lot, label: st.label, tone: st.tone, since: st.since });
    }
    out.sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
    setHereStates(out);
  }, [step.id]);

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
    void loadHere();
  }, [loadRecent, loadHere]);

  /**
   * Look the lot up at this step directly, newest pass first. Searching the
   * capped recent list instead would miss an older lot and quietly create a
   * duplicate record for it.
   */
  const lookup = useCallback(async () => {
    if (!LOT_PATTERN.test(lotId)) {
      setRecord(null);
      setSegments([]);
      return;
    }
    const { data } = await supabase
      .from("logs")
      .select("*")
      .eq("step_id", step.id)
      .eq("lot_id", lotId)
      .is("deleted_at", null)
      .order("pass_no", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    const found = data && data.length ? (data[0] as LogRow) : null;
    setRecord(found);
    setSegments(found ? await loadSegments({ kind: "log", id: found.id }) : []);
  }, [lotId, step.id]);

  useEffect(() => {
    const t = setTimeout(() => void lookup(), 250);
    return () => clearTimeout(t);
  }, [lookup]);

  const knownLot = useMemo(
    () => lots.find((l) => l.lot_id === lotId),
    [lots, lotId]
  );

  const q = rollup(segments, "queue", DEFAULT_RULES);
  const p = rollup(segments, "process", DEFAULT_RULES);
  const effectiveBlast = record?.blast_type ?? blastType ?? "";

  const lotState: LotState = useMemo(() => {
    if (!lotId) return { kind: "empty" };
    if (!lotValid) return { kind: "invalid" };
    if (record) {
      return {
        kind: "repeat",
        lot: knownLot,
        detail: `This lot is already open at this step with ${segments.length} ${
          segments.length === 1 ? "stretch" : "stretches"
        } logged. Recording adds to that same record.`,
      };
    }
    if (knownLot) return { kind: "known", lot: knownLot };
    return { kind: "new" };
  }, [lotId, lotValid, record, knownLot, segments.length]);

  function stamp(): string {
    if (timeMode === "now") return new Date().toISOString();
    return phoenixToIso(customDate, customTime);
  }

  async function press(action: Action) {
    if (busy) return;
    if (crew.length === 0) {
      onToast("Pick at least one name first.");
      return;
    }
    if (!lotValid) {
      onToast(`Choose or type a lot number. ${LOT_HINT}`);
      return;
    }
    if (
      step.has_blast_type &&
      action.startsWith("process") &&
      !effectiveBlast
    ) {
      onToast("Choose a blast type before logging process time.");
      return;
    }

    setBusy(true);
    try {
      let target = record;

      // First press on a lot creates its record at this step.
      if (!target) {
        const { data, error } = await supabase
          .from("logs")
          .insert({
            step_id: step.id,
            operator_id: crew[0],
            lot_id: lotId,
            log_date: timeMode === "custom" ? customDate : todayInPhoenix(),
            blast_type: step.has_blast_type ? blastType || null : null,
            pass_no: 1,
          })
          .select()
          .single();
        if (error || !data) {
          onToast("Could not start that lot. Check the connection.");
          return;
        }
        target = data as LogRow;
        setRecord(target);
      } else if (step.has_blast_type && blastType && !target.blast_type) {
        await supabase
          .from("logs")
          .update({ blast_type: blastType })
          .eq("id", target.id);
      }

      const plan = planAction(segments, action, true, step);
      if (plan.noop) {
        onToast("Nothing is running here, so there is nothing to close.");
        return;
      }
      const ts = stamp();
      const res = await applyPlan(plan, { kind: "log", id: target.id }, ts, crew);

      onToast(
        res.queued
          ? "Saved on this iPad. It will sync when wifi returns."
          : `${plan.describes} recorded for ${lotId}.`
      );

      const fresh = await loadSegments({ kind: "log", id: target.id });
      setSegments(fresh);
      await Promise.all([loadRecent(), loadHere()]);
      onLotsChanged();

      // Closing the step's exit phase hands the lot onward. The final step
      // has nowhere to send it, so the lot simply closes.
      const exit = exitField(step);
      const closingExit =
        (exit === "process_out" && action === "process_out") ||
        (exit === "queue_out" && action === "queue_out");
      if (closingExit && !step.is_final && !openSegment(fresh)) {
        setRouting({ lot: lotId, stamp: ts });
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Hand the lot to the next step, starting its first interval at the same
   * instant this one ended so queue time measures the real gap.
   */
  async function routeTo(choice: RouteChoice) {
    if (!routing) return;
    setRouteBusy(true);
    try {
      const target = choice.target;
      const entryKind = target.has_queue ? "queue" : "process";

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
      const foundSegs = found
        ? await loadSegments({ kind: "log", id: found.id })
        : [];

      let destId: string;

      // Rework, or a target that already has intervals, opens a new pass so
      // the original run stays intact.
      if (choice.rework || foundSegs.length > 0) {
        const { data: made, error } = await supabase
          .from("logs")
          .insert({
            step_id: target.id,
            operator_id: crew[0] ?? null,
            lot_id: routing.lot,
            log_date: todayInPhoenix(),
            blast_type: target.has_blast_type ? choice.blastType : null,
            pass_no: (found?.pass_no ?? 0) + 1,
            auto_from_step_id: step.id,
          })
          .select()
          .single();
        if (error || !made) {
          onToast("Could not hand the lot over. Check the connection.");
          return;
        }
        destId = (made as LogRow).id;
      } else if (found) {
        destId = found.id;
        const patch: Record<string, unknown> = { auto_from_step_id: step.id };
        if (target.has_blast_type && choice.blastType && !found.blast_type) {
          patch.blast_type = choice.blastType;
        }
        await supabase.from("logs").update(patch).eq("id", found.id);
      } else {
        const { data: made, error } = await supabase
          .from("logs")
          .insert({
            step_id: target.id,
            operator_id: crew[0] ?? null,
            lot_id: routing.lot,
            log_date: todayInPhoenix(),
            blast_type: target.has_blast_type ? choice.blastType : null,
            pass_no: 1,
            auto_from_step_id: step.id,
          })
          .select()
          .single();
        if (error || !made) {
          onToast("Could not hand the lot over. Check the connection.");
          return;
        }
        destId = (made as LogRow).id;
      }

      const { error: segErr } = await supabase.from("segments").insert({
        log_id: destId,
        kind: entryKind,
        started_at: routing.stamp,
        started_by: crew,
      });
      if (segErr) {
        onToast("Handoff saved but the timer may need checking.");
      } else {
        onToast(
          choice.rework
            ? `Lot ${routing.lot} sent back to ${target.step_name} as a new pass.`
            : `Lot ${routing.lot} sent to ${target.step_name}.`
        );
      }

      setRouting(null);
      setLotId("");
      onLotsChanged();
    } finally {
      setRouteBusy(false);
    }
  }

  /** Open the full editor for a record, loading its stretches first. */
  async function openEditor(l: LogRow) {
    const segs = await loadSegments({ kind: "log", id: l.id });
    setEditing({
      mode: "edit",
      kind: "log",
      id: l.id,
      step,
      lotId: l.lot_id,
      logDate: l.log_date,
      blastType: l.blast_type,
      notes: l.notes,
      segments: segs,
    });
  }

  async function softDelete(l: LogRow) {
    if (
      !window.confirm(
        `Delete the record for lot ${l.lot_id}? It stays in the audit trail.`
      )
    )
      return;
    const { error } = await supabase
      .from("logs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", l.id);
    if (error) {
      onToast("Could not delete right now. Check the connection.");
      return;
    }
    onToast(`Record for ${l.lot_id} deleted.`);
    await Promise.all([loadRecent(), lookup(), loadHere()]);
    onLotsChanged();
  }

  /**
   * A release step does not time anything. It stamps the moment the lot was
   * created and opens the routing dialog so it can be sent onward. The stamp
   * is stored as a zero length process interval, which keeps every record in
   * the same shape without inventing a duration that did not happen.
   */
  async function release() {
    if (busy) return;
    if (crew.length === 0) {
      onToast("Pick at least one name first.");
      return;
    }
    if (!lotValid) {
      onToast(`Choose or type a lot number. ${LOT_HINT}`);
      return;
    }

    setBusy(true);
    try {
      let target = record;
      if (!target) {
        const { data, error } = await supabase
          .from("logs")
          .insert({
            step_id: step.id,
            operator_id: crew[0],
            lot_id: lotId,
            log_date: timeMode === "custom" ? customDate : todayInPhoenix(),
            pass_no: 1,
          })
          .select()
          .single();
        if (error || !data) {
          onToast("Could not create that lot. Check the connection.");
          return;
        }
        target = data as LogRow;
        setRecord(target);
      }

      const ts = stamp();
      const { error: segErr } = await supabase.from("segments").insert({
        log_id: target.id,
        kind: "process",
        started_at: ts,
        ended_at: ts,
        started_by: crew,
        ended_by: crew,
      });
      if (segErr) {
        onToast("Could not record that. Check the connection.");
        return;
      }

      setSegments(await loadSegments({ kind: "log", id: target.id }));
      await Promise.all([loadRecent(), loadHere()]);
      onLotsChanged();
      setRouting({ lot: lotId, stamp: ts });
    } finally {
      setBusy(false);
    }
  }

  const arrivedFrom = record?.auto_from_step_id
    ? allSteps.find((x) => x.id === record.auto_from_step_id)?.step_name ?? null
    : null;

  return (
    <div className="stack">
      <div className="panel tight">
        <CrewPicker
          operators={operators}
          value={crew}
          onChange={setCrew}
          onOperatorsChanged={onOperatorsChanged}
        />
      </div>

      <div className="panel tight">
        <LotPicker
          value={lotId}
          onChange={(v) => setLotId(normalizeLot(v))}
          lots={lots}
          here={hereStates}
          stepName={step.step_name}
          state={lotState}
          entryStep={Boolean(step.is_entry)}
        />
      </div>

      {record && record.pass_no > 1 && (
        <div className="lot-status repeat">
          <CornerUpLeft size={16} />
          <span>
            Lot {lotId} is on pass {record.pass_no} at this step. Earlier passes
            are kept separately.
          </span>
        </div>
      )}

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

      {step.release_only ? (
        <div className="stack">
          <button
            className="release-btn"
            disabled={busy || !lotValid}
            onClick={() => void release()}
          >
            <Send size={22} />
            <span>
              <span className="r-main">Release lot</span>
              <span className="r-sub">
                Records the moment it was created, then asks where it goes
              </span>
            </span>
          </button>
          {segments.length > 0 && (
            <div className="lot-status known">
              <CircleCheck size={16} />
              <span>
                Lot {lotId} was released at{" "}
                <span className="mono">
                  {formatStamp(segments[0].started_at)}
                </span>
                .
              </span>
            </div>
          )}
          <p className="hint">
            Lots are not timed here. They queue at the next step, so this
            station only records when the lot came into existence.
          </p>
        </div>
      ) : (
        <PhaseControls
          segments={segments}
          step={step}
          operators={operators}
          onPress={(a) => void press(a)}
          disabled={busy || !lotValid}
          arrivedFrom={arrivedFrom}
        />
      )}

      {!step.release_only && (q.count > 0 || p.count > 0) && (
        <div className="grid-2">
          <div className="stat">
            <div className="k">Queue total</div>
            <div className="v">{formatDuration(q.businessMs)}</div>
          </div>
          <div className="stat">
            <div className="k">Process total</div>
            <div className="v">{formatDuration(p.businessMs)}</div>
          </div>
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

      {step.is_final && p.count > 0 && !p.running && (
        <div className="lot-status known">
          <CircleCheck size={16} />
          <span>Lot {lotId} is complete and has come off the active list.</span>
        </div>
      )}

      <div className="panel tight">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Recent records at this step</strong>
          <div className="spacer" />
          <button
            className="btn sm ghost"
            onClick={() => void Promise.all([loadRecent(), lookup()])}
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
                  style={{ minWidth: 0, flex: 1, textAlign: "left" }}
                  onClick={() => setLotId(l.lot_id)}
                >
                  <div className="lot mono">
                    {l.lot_id}
                    {l.pass_no > 1 && (
                      <span className="badge warn" style={{ marginLeft: 8 }}>
                        pass {l.pass_no}
                      </span>
                    )}
                  </div>
                  <div className="log-meta mono">
                    <span>{l.log_date}</span>
                    <span>{formatStamp(l.updated_at)}</span>
                  </div>
                </button>
                <button
                  className="btn sm icon ghost"
                  aria-label={`Edit ${l.lot_id}`}
                  onClick={() => void openEditor(l)}
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
        <RecordEditor
          target={editing}
          operators={operators}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([loadRecent(), lookup(), loadHere()]);
            onLotsChanged();
            onToast("Record updated.");
          }}
        />
      )}
    </div>
  );
}
