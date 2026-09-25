"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Cog, Hourglass, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  LOT_HINT,
  LOT_PATTERN,
  normalizeLot,
  type Operator,
  type PoLog,
  type PoRegistryRow,
  type Segment,
  type Step,
} from "@/lib/types";
import { formatClock, todayInPhoenix } from "@/lib/time";
import { closeOpenForPo } from "@/lib/handoff";
import { applyPlan, loadSegments, planAction } from "@/lib/segmentActions";
import { liveState } from "./PhaseControls";
import { ActionRow, CrewRow, StatusStrip, type OpAction } from "./OperatorShell";
import EndConfirm from "./EndConfirm";
import RefChip, { chipMinWidth } from "./RefChip";
import { PriorityMark, PriorityRow } from "./PriorityControls";
import { byPriority, dueLabel, loadPriorities, type PriorityMap } from "@/lib/priority";

type Row = {
  po_number: string;
  label: string;
  tone: "queue" | "process" | "idle" | "done";
  since: string | null;
  ready: boolean;
};

export default function OperatorPoPanel({
  step,
  operators,
  onToast,
}: {
  step: Step;
  operators: Operator[];
  onToast: (m: string) => void;
}) {
  const [crew, setCrew] = useState<string[]>([]);
  const [poNumber, setPoNumber] = useState("");
  const [typed, setTyped] = useState("");
  const [scope, setScope] = useState<"here" | "all" | "new">(
    step.is_entry ? "new" : "here"
  );
  const [ending, setEnding] = useState<string | null>(null);
  const [prio, setPrio] = useState<PriorityMap>(new Map());

  const loadPrio = useCallback(async () => {
    setPrio(await loadPriorities("po"));
  }, []);

  useEffect(() => {
    void loadPrio();
    const t = setInterval(() => void loadPrio(), 30000);
    return () => clearInterval(t);
  }, [loadPrio]);

  const [registry, setRegistry] = useState<PoRegistryRow[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [record, setRecord] = useState<PoLog | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [reg, mine] = await Promise.all([
      supabase
        .from("po_registry")
        .select("*")
        .order("last_activity", { ascending: false }),
      supabase
        .from("po_logs")
        .select("id, po_number")
        .eq("step_id", step.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(150),
    ]);

    const regRows = (reg.data ?? []) as PoRegistryRow[];
    setRegistry(regRows);

    const recs = (mine.data ?? []) as { id: string; po_number: string }[];
    let segs: Segment[] = [];
    if (recs.length) {
      const { data } = await supabase
        .from("segments")
        .select("*")
        .in(
          "po_log_id",
          recs.map((r) => r.id)
        );
      segs = (data ?? []) as Segment[];
    }

    const byPo = new Map<string, Segment[]>();
    for (const r of recs) {
      byPo.set(r.po_number, [
        ...(byPo.get(r.po_number) ?? []),
        ...segs.filter((s) => s.po_log_id === r.id),
      ]);
    }

    const out: Row[] = [];
    for (const [num, sg] of byPo) {
      const st = liveState(sg);
      if (st.tone !== "queue" && st.tone !== "process") continue;
      out.push({
        po_number: num,
        label: st.label,
        tone: st.tone,
        since: st.since,
        ready: false,
      });
    }

    // Orders finished upstream and never started here, shown ready to pick.
    for (const r of regRows) {
      if (byPo.has(r.po_number)) continue;
      if (r.furthest_finished > 0 && r.furthest_finished < step.sort_order) {
        out.push({
          po_number: r.po_number,
          label: "Ready",
          tone: "idle",
          since: null,
          ready: true,
        });
      }
    }

    out.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? 1 : -1;
      return (b.since ?? "").localeCompare(a.since ?? "");
    });
    setRows(out);
  }, [step.id, step.sort_order]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  const lookup = useCallback(async () => {
    if (!LOT_PATTERN.test(poNumber)) {
      setRecord(null);
      setSegments([]);
      return;
    }
    const { data } = await supabase
      .from("po_logs")
      .select("*")
      .eq("step_id", step.id)
      .eq("po_number", poNumber)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const found = data?.length ? (data[0] as PoLog) : null;
    setRecord(found);
    setSegments(found ? await loadSegments({ kind: "po", id: found.id }) : []);
  }, [poNumber, step.id]);

  useEffect(() => {
    const t = setTimeout(() => void lookup(), 200);
    return () => clearTimeout(t);
  }, [lookup]);

  /** Closest due date first, hot jobs above everything. */
  const listed = useMemo(() => {
    const raw =
      scope === "here"
        ? rows
        : registry.map((r) => {
            const hit = rows.find((x) => x.po_number === r.po_number);
            return (
              hit ?? {
                po_number: r.po_number,
                label: r.last_step,
                tone: "idle" as const,
                since: null,
                ready: false,
              }
            );
          });
    return byPriority(raw, (x) => x.po_number, (x) => x.since, prio);
  }, [scope, rows, registry, prio]);

  const today = todayInPhoenix();

  const valid = LOT_PATTERN.test(poNumber);
  const ready = crew.length > 0 && valid;
  /** Orders finish at the last station that handles them. */
  const isLastStation = !step.is_entry;

  async function press(a: OpAction) {
    if (busy || !ready) return;
    setBusy(true);
    try {
      let target = record;
      if (!target) {
        const { data, error } = await supabase
          .from("po_logs")
          .insert({
            step_id: step.id,
            po_number: poNumber,
            log_date: todayInPhoenix(),
          })
          .select()
          .single();
        if (error || !data) {
          onToast("Could not start that order. Check the connection.");
          return;
        }
        target = data as PoLog;
        setRecord(target);
      }

      const action =
        a === "queue"
          ? "queue_in"
          : a === "start"
          ? "process_in"
          : a === "pause"
          ? "back_to_queue"
          : "process_out";
      const plan = planAction(segments, action, true, step);
      const ts = new Date().toISOString();
      if (plan.open) await closeOpenForPo(poNumber, ts, crew, target.id);
      const res = await applyPlan(plan, { kind: "po", id: target.id }, ts, crew);

      const said =
        a === "queue"
          ? `${poNumber} queued at ${step.step_name}`
          : a === "start"
          ? `Started ${poNumber}`
          : a === "pause"
          ? `${poNumber} paused`
          : `${poNumber} done here`;
      onToast(res.queued ? "Saved on this iPad, will sync when wifi returns." : said);

      setSegments(await loadSegments({ kind: "po", id: target.id }));
      await load();
      // Stopping at the shipping end finishes the order, so confirm rather
      // than closing it silently.
      if (a === "stop") {
        if (isLastStation) setEnding(poNumber);
        else setPoNumber("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="op-wrap">
      <CrewRow operators={operators} value={crew} onChange={setCrew} />

      <div className="op-pick">
        <div className="op-pick-head">
          <span className="op-pick-title">
            {poNumber ? (
              <span className="mono op-chosen">{poNumber}</span>
            ) : (
              "Choose an order"
            )}
          </span>
          <div className="op-scope">
            <button aria-pressed={scope === "here"} onClick={() => setScope("here")}>
              At this station
              <span className="op-pill">{rows.length}</span>
            </button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              <Search size={14} />
              All orders
              <span className="op-pill">{registry.length}</span>
            </button>
            <button aria-pressed={scope === "new"} onClick={() => setScope("new")}>
              <Plus size={14} />
              New
            </button>
          </div>
        </div>

        {scope === "new" ? (
          <div className="op-make" style={{ height: 196 }}>
            <label className="op-make-k">New order number</label>
            <input
              className="input mono op-make-in"
              placeholder="Order number"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(normalizeLot(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && LOT_PATTERN.test(typed)) {
                  setPoNumber(typed);
                  setTyped("");
                }
              }}
            />
            <button
              className="btn primary"
              style={{ marginTop: 10 }}
              disabled={!LOT_PATTERN.test(typed)}
              onClick={() => {
                setPoNumber(typed);
                setTyped("");
              }}
            >
              <Check size={16} />
              Use this number
            </button>
            {typed && !LOT_PATTERN.test(typed) && (
              <div className="err" style={{ marginTop: 8 }}>
                {LOT_HINT}
              </div>
            )}
          </div>
        ) : (
        <div
          className="op-lot-list"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${chipMinWidth(
              listed.map((r) => r.po_number)
            )}px, 1fr))`,
          }}
        >
          {listed.length === 0 ? (
            <div className="op-none">
              {scope === "here" ? "Nothing at this station" : "No orders yet"}
            </div>
          ) : (
            listed.map((r) => (
              <RefChip
                key={r.po_number}
                refId={r.po_number}
                tone={r.ready ? "ready" : r.tone}
                since={r.since}
                where={r.since ? undefined : r.ready ? "ready to start" : r.label}
                priority={prio.get(r.po_number)}
                today={today}
                selected={poNumber === r.po_number}
                onClick={() => setPoNumber(r.po_number)}
              />
            ))
          )}
        </div>
        )}
      </div>

      {step.is_entry && valid && (
        <PriorityRow
          kind="po"
          refId={poNumber}
          map={prio}
          others={registry.map((r) => r.po_number)}
          onChanged={() => void loadPrio()}
        />
      )}

      <StatusStrip
        segments={segments}
        label={valid ? "nothing recorded yet" : "pick an order"}
      />

      <ActionRow
        segments={segments}
        ready={ready}
        busy={busy}
        onPress={(a) => void press(a)}
        finalStep={isLastStation}
        showQueue
      />

      {!ready && (
        <div className="op-hint">
          {crew.length === 0
            ? "Tap your name above to begin"
            : scope === "new"
            ? "Type an order number and tap Use this number"
            : "Choose an order"}
        </div>
      )}

      {ending && (
        <EndConfirm
          reference={ending}
          kind="order"
          stepName={step.step_name}
          busy={busy}
          onEnd={() => {
            onToast(`${ending} complete`);
            setEnding(null);
            setPoNumber("");
          }}
          onCancel={() => setEnding(null)}
        />
      )}
    </div>
  );
}
