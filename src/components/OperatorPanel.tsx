"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cog, Hourglass, Search, Send, Wind } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  exitField,
  LOT_HINT,
  LOT_PATTERN,
  lotSteps,
  normalizeLot,
  type ActiveLot,
  type BlastType,
  type LogRow,
  type Operator,
  type Segment,
  type Step,
} from "@/lib/types";
import { formatClock, todayInPhoenix } from "@/lib/time";
import { openSegment } from "@/lib/segments";
import { applyPlan, loadSegments, planAction } from "@/lib/segmentActions";
import { liveState } from "./PhaseControls";
import RouteDialog, { type RouteChoice } from "./RouteDialog";
import EndConfirm from "./EndConfirm";
import { ActionRow, CrewRow, StatusStrip, type OpAction } from "./OperatorShell";

type Here = {
  lot_id: string;
  label: string;
  tone: "queue" | "process" | "idle" | "done";
  since: string | null;
};

export default function OperatorPanel({
  step,
  allSteps,
  operators,
  lots,
  onLotsChanged,
  onToast,
}: {
  step: Step;
  allSteps: Step[];
  operators: Operator[];
  lots: ActiveLot[];
  onLotsChanged: () => void;
  onToast: (m: string) => void;
}) {
  const [crew, setCrew] = useState<string[]>([]);
  const [lotId, setLotId] = useState("");
  const [blastType, setBlastType] = useState<BlastType | "">("");
  const [scope, setScope] = useState<"here" | "all">("here");
  const [typed, setTyped] = useState("");

  const [here, setHere] = useState<Here[]>([]);
  const [record, setRecord] = useState<LogRow | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);
  const [routing, setRouting] = useState<{ lot: string; stamp: string } | null>(
    null
  );
  const [routeBusy, setRouteBusy] = useState(false);
  const [ending, setEnding] = useState<{ lot: string; stamp: string } | null>(
    null
  );

  // Lots are created at the first step only. Everywhere else the number is
  // picked from a list, because typing a number that already exists is the
  // easiest way to end up with two records for one lot.
  const canType = Boolean(step.is_entry);

  const laterSteps = useMemo(
    () => lotSteps(allSteps).filter((s) => s.sort_order > step.sort_order),
    [allSteps, step.sort_order]
  );
  const isEndOfLine = step.is_final === true || laterSteps.length === 0;

  /** What is sitting at this step, and what each one is doing. */
  const loadHere = useCallback(async () => {
    const { data: recs } = await supabase
      .from("logs")
      .select("id, lot_id")
      .eq("step_id", step.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(150);
    if (!recs?.length) {
      setHere([]);
      return;
    }
    const { data: segs } = await supabase
      .from("segments")
      .select("*")
      .in(
        "log_id",
        recs.map((r) => r.id)
      );

    const byLot = new Map<string, Segment[]>();
    for (const r of recs) {
      const forId = ((segs ?? []) as Segment[]).filter(
        (s) => s.log_id === r.id
      );
      byLot.set(r.lot_id as string, [
        ...(byLot.get(r.lot_id as string) ?? []),
        ...forId,
      ]);
    }

    const out: Here[] = [];
    for (const [lot, sg] of byLot) {
      const st = liveState(sg);
      if (st.tone !== "queue" && st.tone !== "process") continue;
      out.push({ lot_id: lot, label: st.label, tone: st.tone, since: st.since });
    }
    out.sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
    setHere(out);
  }, [step.id]);

  useEffect(() => {
    void loadHere();
    const t = setInterval(() => void loadHere(), 30000);
    return () => clearInterval(t);
  }, [loadHere]);

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
    const found = data?.length ? (data[0] as LogRow) : null;
    setRecord(found);
    setSegments(found ? await loadSegments({ kind: "log", id: found.id }) : []);
  }, [lotId, step.id]);

  useEffect(() => {
    const t = setTimeout(() => void lookup(), 200);
    return () => clearTimeout(t);
  }, [lookup]);

  const listed = useMemo(() => {
    if (scope === "here") return here;
    return lots.map((l) => {
      const h = here.find((x) => x.lot_id === l.lot_id);
      return {
        lot_id: l.lot_id,
        label: h?.label ?? l.last_step,
        tone: h?.tone ?? ("idle" as const),
        since: h?.since ?? null,
      };
    });
  }, [scope, here, lots]);

  const lotValid = LOT_PATTERN.test(lotId);
  const effectiveBlast = record?.blast_type ?? blastType ?? "";
  const needsBlast = step.has_blast_type && !effectiveBlast;
  const ready = crew.length > 0 && lotValid && !needsBlast;

  /**
   * Lots are born here. There is no work to time at this station, so the whole
   * job is a name, a number and a button: the lot is stamped into existence
   * and handed to the floor.
   */
  async function sendToFloor() {
    if (busy) return;
    const lot = normalizeLot(typed || lotId);
    if (crew.length === 0) {
      onToast("Tap your name first.");
      return;
    }
    if (!LOT_PATTERN.test(lot)) {
      onToast(`Enter a lot number. ${LOT_HINT}`);
      return;
    }
    setBusy(true);
    try {
      const { data: existing } = await supabase
        .from("logs")
        .select("id")
        .eq("step_id", step.id)
        .eq("lot_id", lot)
        .is("deleted_at", null)
        .limit(1);

      let id: string;
      if (existing?.length) {
        id = existing[0].id as string;
      } else {
        const { data, error } = await supabase
          .from("logs")
          .insert({
            step_id: step.id,
            operator_id: crew[0],
            lot_id: lot,
            log_date: todayInPhoenix(),
            pass_no: 1,
          })
          .select()
          .single();
        if (error || !data) {
          onToast("Could not create that lot. Check the connection.");
          return;
        }
        id = (data as LogRow).id;
      }

      const ts = new Date().toISOString();
      await supabase.from("segments").insert({
        log_id: id,
        kind: "process",
        started_at: ts,
        ended_at: ts,
        started_by: crew,
        ended_by: crew,
      });

      setTyped("");
      setLotId(lot);
      await loadHere();
      onLotsChanged();
      setRouting({ lot, stamp: ts });
    } finally {
      setBusy(false);
    }
  }

  async function press(a: OpAction) {
    if (busy || !ready) return;
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
            log_date: todayInPhoenix(),
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
      }

      const action =
        a === "start" ? "process_in" : a === "pause" ? "back_to_queue" : "process_out";
      const plan = planAction(segments, action, true, step);
      const ts = new Date().toISOString();
      const res = await applyPlan(plan, { kind: "log", id: target.id }, ts, crew);

      const said =
        a === "start"
          ? `Started ${lotId}`
          : a === "pause"
          ? `${lotId} paused, back in the queue`
          : isEndOfLine
          ? `${lotId} finished and off the line`
          : `${lotId} stopped`;
      onToast(res.queued ? "Saved on this iPad, will sync when wifi returns." : said);

      const fresh = await loadSegments({ kind: "log", id: target.id });
      setSegments(fresh);
      await loadHere();
      onLotsChanged();

      if (a === "stop" && !openSegment(fresh)) {
        if (isEndOfLine) setEnding({ lot: lotId, stamp: ts });
        else setRouting({ lot: lotId, stamp: ts });
      }
    } finally {
      setBusy(false);
    }
  }

  /** Same handoff the admin view performs. */
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
        .limit(1);
      const found = data?.length ? (data[0] as LogRow) : null;
      const foundSegs = found
        ? await loadSegments({ kind: "log", id: found.id })
        : [];

      let destId: string;
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
          onToast("Could not send it on. Check the connection.");
          return;
        }
        destId = (made as LogRow).id;
      } else if (found) {
        destId = found.id;
        await supabase
          .from("logs")
          .update({ auto_from_step_id: step.id })
          .eq("id", found.id);
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
          onToast("Could not send it on. Check the connection.");
          return;
        }
        destId = (made as LogRow).id;
      }

      await supabase.from("segments").insert({
        log_id: destId,
        kind: entryKind,
        started_at: routing.stamp,
        started_by: crew,
      });

      onToast(`${routing.lot} sent to ${target.step_name}`);
      setRouting(null);
      setLotId("");
      await loadHere();
      onLotsChanged();
    } finally {
      setRouteBusy(false);
    }
  }

  const openQ = openSegment(segments, "queue");

  if (step.release_only) {
    const lot = normalizeLot(typed);
    const canSend = crew.length > 0 && LOT_PATTERN.test(lot);
    return (
      <div className="op-wrap">
        <CrewRow operators={operators} value={crew} onChange={setCrew} />

        <div className="op-make">
          <label className="op-make-k">New lot number</label>
          <input
            className="input mono op-make-in"
            placeholder="000000-00"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(normalizeLot(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSend) void sendToFloor();
            }}
          />
          {typed && !LOT_PATTERN.test(lot) && (
            <div className="err" style={{ marginTop: 8 }}>
              {LOT_HINT}
            </div>
          )}
        </div>

        <button
          className="op-btn start op-send"
          disabled={!canSend || busy}
          onClick={() => void sendToFloor()}
        >
          <Send size={28} />
          <span>
            <span className="op-btn-main">Send to floor</span>
            <span className="op-btn-sub">
              Creates the lot and hands it to the next step
            </span>
          </span>
        </button>

        {!canSend && (
          <div className="op-hint">
            {crew.length === 0 ? "Tap your name to begin" : "Type a lot number"}
          </div>
        )}

        {routing && (
          <RouteDialog
            lotId={routing.lot}
            from={step}
            steps={allSteps}
            stamp={formatClock(routing.stamp)}
            busy={routeBusy}
            onHold={() => {
              setRouting(null);
              setLotId("");
              onToast(`${routing.lot} created, holding here`);
            }}
            onConfirm={(c) => void routeTo(c)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="op-wrap">
      <CrewRow operators={operators} value={crew} onChange={setCrew} />

      <div className="op-pick">
        <div className="op-pick-head">
          <span className="op-pick-title">
            {lotId ? (
              <span className="mono op-chosen">{lotId}</span>
            ) : (
              "Choose a lot"
            )}
          </span>
          <div className="op-scope">
            <button
              aria-pressed={scope === "here"}
              onClick={() => setScope("here")}
            >
              At this step
              <span className="op-pill">{here.length}</span>
            </button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              <Search size={14} />
              All lots
              <span className="op-pill">{lots.length}</span>
            </button>
          </div>
        </div>

        {/* Fixed height, so the buttons below never move off screen no
            matter how many lots are lined up. */}
        <div className="op-lot-list">
          {listed.length === 0 ? (
            <div className="op-none">
              {scope === "here"
                ? "Nothing at this step"
                : "No lots on the line"}
            </div>
          ) : (
            listed.map((l) => (
              <button
                key={l.lot_id}
                className="op-lot"
                aria-pressed={lotId === l.lot_id}
                onClick={() => setLotId(l.lot_id)}
              >
                <span className="mono op-lot-id">{l.lot_id}</span>
                <span className={`op-tag ${l.tone}`}>
                  {l.tone === "process" ? (
                    <Cog size={12} />
                  ) : l.tone === "queue" ? (
                    <Hourglass size={12} />
                  ) : null}
                  {l.since ? formatClock(l.since) : l.label}
                </span>
              </button>
            ))
          )}
        </div>

        {canType && (
          <div className="op-type">
            <input
              className="input mono"
              placeholder="New lot number"
              autoCapitalize="characters"
              autoCorrect="off"
              value={typed}
              onChange={(e) => setTyped(normalizeLot(e.target.value))}
            />
            <button
              className="btn primary"
              disabled={!LOT_PATTERN.test(typed)}
              onClick={() => {
                setLotId(typed);
                setTyped("");
              }}
            >
              <Send size={16} />
              Use
            </button>
          </div>
        )}
        {canType && typed && !LOT_PATTERN.test(typed) && (
          <div className="err" style={{ fontSize: 12 }}>
            {LOT_HINT}
          </div>
        )}
      </div>

      {step.has_blast_type && lotValid && (
        <div className="op-blast">
          <span className="op-blast-k">
            <Wind size={14} /> Blast type
          </span>
          {(["Manual Blasting", "Auto Blasting"] as BlastType[]).map((b) => (
            <button
              key={b}
              className="op-name"
              aria-pressed={effectiveBlast === b}
              onClick={() => setBlastType(b)}
            >
              {b.replace(" Blasting", "")}
            </button>
          ))}
        </div>
      )}

      <StatusStrip
        segments={segments}
        label={
          lotValid
            ? openQ
              ? "waiting here"
              : "nothing recorded yet"
            : "pick a lot"
        }
      />

      <ActionRow
        segments={segments}
        ready={ready}
        busy={busy}
        onPress={(a) => void press(a)}
        finalStep={isEndOfLine}
      />

      {!ready && (
        <div className="op-hint">
          {crew.length === 0
            ? "Tap your name to begin"
            : !lotValid
            ? "Choose a lot"
            : needsBlast
            ? "Choose a blast type"
            : ""}
        </div>
      )}

      {ending && (
        <EndConfirm
          reference={ending.lot}
          kind="lot"
          stepName={step.step_name}
          busy={busy}
          onEnd={() => {
            onToast(`${ending.lot} finished and off the line`);
            setEnding(null);
            setLotId("");
          }}
          onRework={() => {
            setRouting({ lot: ending.lot, stamp: ending.stamp });
            setEnding(null);
          }}
          onCancel={() => setEnding(null)}
        />
      )}

      {routing && (
        <RouteDialog
          lotId={routing.lot}
          from={step}
          steps={allSteps}
          stamp={formatClock(routing.stamp)}
          busy={routeBusy}
          onHold={() => {
            setRouting(null);
            setLotId("");
            onToast(`${routing.lot} is holding here`);
          }}
          onConfirm={(c) => void routeTo(c)}
        />
      )}
    </div>
  );
}
