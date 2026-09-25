"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  CirclePlus,
  FileText,
  Inbox,
  Info,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
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
import { formatDuration, formatStamp, todayInPhoenix } from "@/lib/time";
import { openSegment, rollup } from "@/lib/segments";
import { DEFAULT_RULES } from "@/lib/time";
import {
  applyPlan,
  loadSegments,
  planAction,
  type Action,
} from "@/lib/segmentActions";
import CrewPicker from "./CrewPicker";
import { closeOpenForPo } from "@/lib/handoff";
import RecordEditor, { type EditorTarget } from "./RecordEditor";
import { PriorityMark, PriorityRow } from "./PriorityControls";
import { byPriority, dueLabel, loadPriorities, type PriorityMap } from "@/lib/priority";
import PhaseControls, { liveState } from "./PhaseControls";

type Props = {
  step: Step;
  allSteps: Step[];
  operators: Operator[];
  onOperatorsChanged: () => void;
  onToast: (m: string) => void;
};

export default function PoPanel({
  step,
  allSteps,
  operators,
  onOperatorsChanged,
  onToast,
}: Props) {
  const [crew, setCrew] = useState<string[]>([]);
  const [poNumber, setPoNumber] = useState("");
  const [scope, setScope] = useState<"here" | "ready" | "all" | "type">("here");
  const [hereStates, setHereStates] = useState<
    Map<string, { label: string; tone: string; since: string | null }>
  >(new Map());
  /**
   * Orders finished at an earlier station and not yet logged here. They are
   * shown so they are easy to pick up, but nothing is written and no timer
   * starts until an operator actually presses a button.
   */
  const [arrived, setArrived] = useState<
    Map<string, { from: string; at: string | null }>
  >(new Map());
  const [search, setSearch] = useState("");

  const [registry, setRegistry] = useState<PoRegistryRow[]>([]);
  const [here, setHere] = useState<PoLog[]>([]);
  const [record, setRecord] = useState<PoLog | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [prio, setPrio] = useState<PriorityMap>(new Map());

  const loadPrio = useCallback(async () => {
    setPrio(await loadPriorities("po"));
  }, []);

  useEffect(() => {
    void loadPrio();
  }, [loadPrio]);

  const valid = LOT_PATTERN.test(poNumber);

  const poStations = useMemo(
    () =>
      allSteps
        .filter((s) => s.tracks_po && s.active !== false)
        .sort((a, b) => a.sort_order - b.sort_order),
    [allSteps]
  );

  const earlierStations = useMemo(
    () => poStations.filter((s) => s.sort_order < step.sort_order),
    [poStations, step.sort_order]
  );

  const loadRegistry = useCallback(async () => {
    const [reg, mine] = await Promise.all([
      supabase
        .from("po_registry")
        .select("*")
        .order("last_activity", { ascending: false }),
      supabase
        .from("po_logs")
        .select("*")
        .eq("step_id", step.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(40),
    ]);
    if (reg.data) setRegistry(reg.data as PoRegistryRow[]);
    const rows = (mine.data ?? []) as PoLog[];
    setHere(rows);

    // Work out what each order at this station is currently doing.
    if (rows.length) {
      const { data: segs } = await supabase
        .from("segments")
        .select("*")
        .in(
          "po_log_id",
          rows.map((r) => r.id)
        );
      const byPo = new Map<string, Segment[]>();
      for (const sg of (segs ?? []) as Segment[]) {
        if (!sg.po_log_id) continue;
        const list = byPo.get(sg.po_log_id) ?? [];
        list.push(sg);
        byPo.set(sg.po_log_id, list);
      }
      // Every record an order has here, not just the newest, so an open
      // stretch is never missed. Matches the rule the dashboard uses.
      const allFor = new Map<string, Segment[]>();
      for (const r of rows) {
        allFor.set(r.po_number, [
          ...(allFor.get(r.po_number) ?? []),
          ...(byPo.get(r.id) ?? []),
        ]);
      }
      const states = new Map<
        string,
        { label: string; tone: string; since: string | null }
      >();
      for (const [num, segsFor] of allFor) {
        states.set(num, liveState(segsFor));
      }
      setHereStates(states);
    } else {
      setHereStates(new Map());
    }

    // Anything that finished upstream and has not been started here.
    if (earlierStations.length === 0) {
      setArrived(new Map());
      return;
    }

    const { data: upstream } = await supabase
      .from("po_logs")
      .select("id, po_number, step_id")
      .in(
        "step_id",
        earlierStations.map((s) => s.id)
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (!upstream || upstream.length === 0) {
      setArrived(new Map());
      return;
    }

    const { data: upSegs } = await supabase
      .from("segments")
      .select("*")
      .in(
        "po_log_id",
        upstream.map((u) => u.id as string)
      );

    const segsByPoLog = new Map<string, Segment[]>();
    for (const sg of (upSegs ?? []) as Segment[]) {
      if (!sg.po_log_id) continue;
      const list = segsByPoLog.get(sg.po_log_id) ?? [];
      list.push(sg);
      segsByPoLog.set(sg.po_log_id, list);
    }

    const startedHere = new Set(rows.map((r) => r.po_number));
    const waiting = new Map<string, { from: string; at: string | null }>();

    for (const u of upstream) {
      const num = u.po_number as string;
      if (startedHere.has(num) || waiting.has(num)) continue;
      const segs = segsByPoLog.get(u.id as string) ?? [];
      const finished = segs
        .filter((sg) => sg.kind === "process" && sg.ended_at)
        .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))[0];
      if (!finished) continue;
      const from =
        earlierStations.find((s) => s.id === u.step_id)?.step_name ?? "upstream";
      waiting.set(num, { from, at: finished.ended_at });
    }
    setArrived(waiting);
  }, [step.id, earlierStations]);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  /** Find this PO's record at this station, newest first. */
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

    const found = data && data.length ? (data[0] as PoLog) : null;
    setRecord(found);
    setSegments(found ? await loadSegments({ kind: "po", id: found.id }) : []);
  }, [poNumber, step.id]);

  useEffect(() => {
    const t = setTimeout(() => void lookup(), 250);
    return () => clearTimeout(t);
  }, [lookup]);

  /**
   * Orders finished upstream that have never been logged here. They are shown
   * ready to pick rather than queued automatically, because queue time should
   * start when someone actually starts waiting on the order, not the moment
   * the paperwork cleared at the station before.
   */
  const readyToStart = useMemo(() => {
    return registry.filter(
      (r) =>
        r.furthest_finished > 0 &&
        r.furthest_finished < step.sort_order &&
        !(r.seen_at ?? []).includes(step.step_name)
    );
  }, [registry, step]);

  /**
   * Orders at this station by default, because that is what the person
   * standing here is working on. Everything ever seen is one tap away.
   */
  const listed = useMemo(() => {
    const q = search.trim().toUpperCase();
    const atStation = new Set(
      here
        .filter((h) => hereStates.get(h.po_number)?.tone !== "done")
        .map((h) => h.po_number)
    );

    // At this station means either already started here, or finished
    // upstream and waiting to be picked up.
    const source =
      scope === "here"
        ? registry.filter(
            (r) => atStation.has(r.po_number) || arrived.has(r.po_number)
          )
        : registry;

    return source
      .filter((r) => !q || r.po_number.includes(q))
      .map((r) => ({
        ...r,
        openHere: atStation.has(r.po_number),
        state: hereStates.get(r.po_number),
        waiting: arrived.get(r.po_number),
      }))
      .sort((a, b) => {
        // Started here first, then arrivals, newest arrival first.
        const rank = (x: typeof a) => (x.openHere ? 0 : x.waiting ? 1 : 2);
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        return (b.waiting?.at ?? "").localeCompare(a.waiting?.at ?? "");
      })
      .slice(0, 60);
  }, [registry, here, hereStates, arrived, search, scope]);

  const orderedPos = useMemo(
    () =>
      byPriority(listed, (x) => x.po_number, (x) => x.state?.since ?? null, prio),
    [listed, prio]
  );
  const todayStr = todayInPhoenix();

  async function press(action: Action) {
    if (busy) return;
    if (crew.length === 0) {
      onToast("Pick at least one name first.");
      return;
    }
    if (!valid) {
      onToast(`Choose or type a PO number. ${LOT_HINT}`);
      return;
    }

    setBusy(true);
    try {
      let target = record;

      // First press on a PO creates its record at this station.
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
          onToast("Could not start that PO. Check the connection.");
          return;
        }
        target = data as PoLog;
        setRecord(target);
      }

      const plan = planAction(segments, action, true, step);
      if (plan.noop) {
        onToast("Nothing is running here, so there is nothing to close.");
        return;
      }
      const ts = new Date().toISOString();
      if (plan.open) await closeOpenForPo(poNumber, ts, crew, target.id);
      const res = await applyPlan(plan, { kind: "po", id: target.id }, ts, crew);

      const handedOn =
        action === "process_out" && !res.queued && step.is_entry;
      onToast(
        res.queued
          ? "Saved on this iPad. It will sync when wifi returns."
          : handedOn
          ? `PO ${poNumber} is done here and is now showing at the shipping station.`
          : `${plan.describes} recorded for PO ${poNumber}.`
      );

      setSegments(await loadSegments({ kind: "po", id: target.id }));
      await loadRegistry();
    } finally {
      setBusy(false);
    }
  }

  /** Open the full editor for a record, loading its stretches first. */
  async function openEditor(r: PoLog) {
    const segs = await loadSegments({ kind: "po", id: r.id });
    setEditing({
      mode: "edit",
      kind: "po",
      id: r.id,
      step,
      poNumber: r.po_number,
      logDate: r.log_date,
      notes: r.notes,
      segments: segs,
    });
  }

  async function removeRecord(r: PoLog) {
    if (!window.confirm(`Delete the record for PO ${r.po_number}?`)) return;
    const { error } = await supabase
      .from("po_logs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) {
      onToast("Could not delete right now.");
      return;
    }
    onToast(`Record for PO ${r.po_number} deleted.`);
    if (record?.id === r.id) {
      setRecord(null);
      setSegments([]);
    }
    await loadRegistry();
  }

  const q = rollup(segments, "queue", DEFAULT_RULES);
  const p = rollup(segments, "process", DEFAULT_RULES);
  const knownElsewhere = registry.find((r) => r.po_number === poNumber);

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

      <div className="panel tight stack" style={{ gap: 10 }}>
        <div className="row">
          <span className="field-label" style={{ margin: 0 }}>
            <FileText size={14} />
            Purchase order
          </span>
          <div className="spacer" />
          <div className="seg">
            <button aria-pressed={scope === "here"} onClick={() => setScope("here")}>
              At this station
              <span className="badge" style={{ padding: "1px 7px" }}>
                {new Set([
                  ...here
                    .filter((h) => hereStates.get(h.po_number)?.tone !== "done")
                    .map((h) => h.po_number),
                  ...arrived.keys(),
                ]).size}
              </span>
            </button>
            {readyToStart.length > 0 && (
              <button
                aria-pressed={scope === "ready"}
                onClick={() => setScope("ready")}
              >
                <Inbox size={15} />
                Ready to start
                <span className="badge warn" style={{ padding: "1px 7px" }}>
                  {readyToStart.length}
                </span>
              </button>
            )}
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
              <Search size={15} />
              All known
              <span className="badge" style={{ padding: "1px 7px" }}>
                {registry.length}
              </span>
            </button>
            <button aria-pressed={scope === "type"} onClick={() => setScope("type")}>
              <CirclePlus size={15} />
              Type it
            </button>
          </div>
        </div>

        {scope === "type" ? (
          <input
            className={`input big mono ${poNumber && !valid ? "invalid" : ""}`}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="PO number"
            value={poNumber}
            onChange={(e) => setPoNumber(normalizeLot(e.target.value))}
          />
        ) : (
          <>
            <input
              className="input mono"
              placeholder="Filter POs"
              value={search}
              onChange={(e) => setSearch(e.target.value.toUpperCase())}
            />
            {listed.length === 0 ? (
              <div className="empty" style={{ padding: 22 }}>
                {scope === "here"
                  ? `Nothing is waiting at ${step.step_name}. Switch to All known, or type one.`
                  : registry.length === 0
                  ? "No POs yet. Use Type it to start one."
                  : "No PO matches that filter."}
              </div>
            ) : (
              <div className="lot-list">
                {orderedPos.map((r) => (
                  <button
                    key={r.po_number}
                    className="lot-row"
                    aria-pressed={poNumber === r.po_number}
                    onClick={() => setPoNumber(r.po_number)}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="lid mono">{r.po_number}</div>
                      <div className="where">
                        {r.openHere && r.state?.since
                          ? `${r.state.label} since ${formatStamp(r.state.since)}`
                          : r.waiting
                          ? `Finished ${r.waiting.from}${
                              r.waiting.at
                                ? ` at ${formatStamp(r.waiting.at)}`
                                : ""
                            }`
                          : `Last at ${r.last_step}`}
                      <PriorityMark
                          hot={prio.get(r.po_number)?.hot}
                          due={dueLabel(prio.get(r.po_number)?.due_date ?? null, todayStr)}
                        />
                      </div>
                    </div>
                    {r.openHere && r.state ? (
                      <span className={`state-pill ${r.state.tone}`}>
                        {r.state.label}
                      </span>
                    ) : r.waiting ? (
                      <span className="state-pill arrived">
                        <ArrowRight size={12} />
                        Ready to start
                      </span>
                    ) : (
                      <span className="badge">{r.last_step}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {poNumber && !valid && <div className="err">{LOT_HINT}</div>}

        {valid && !record && arrived.has(poNumber) && (
          <div className="lot-status known">
            <ArrowRight size={16} />
            <span>
              Finished {arrived.get(poNumber)!.from}
              {arrived.get(poNumber)!.at
                ? ` at ${formatStamp(arrived.get(poNumber)!.at)}`
                : ""}
              . Nothing is running yet. Press queue in when it starts waiting
              here, or start the process straight away.
            </span>
          </div>
        )}

        {valid && !record && !arrived.has(poNumber) && knownElsewhere && (
          <div className="lot-status known">
            <CircleCheck size={16} />
            <span>
              Carried over from {knownElsewhere.last_step}. Logging here starts a
              fresh record at this station.
            </span>
          </div>
        )}

        {valid && !record && !knownElsewhere && (
          <div className="lot-status new">
            <Info size={16} />
            <span>New PO. It will show up at the other inspection station too.</span>
          </div>
        )}
      </div>

      {step.is_entry && valid && (
        <div className="panel tight">
          <PriorityRow
            kind="po"
            refId={poNumber}
            map={prio}
            others={registry.map((r) => r.po_number)}
            onChanged={() => void loadPrio()}
          />
        </div>
      )}

      <PhaseControls
        segments={segments}
        step={step}
        operators={operators}
        onPress={(a) => void press(a)}
        disabled={busy || !valid}
      />

      {(q.count > 0 || p.count > 0) && (
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

      {editing && (
        <RecordEditor
          target={editing}
          operators={operators}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await Promise.all([loadRegistry(), lookup()]);
            onToast("Record updated.");
          }}
        />
      )}

      <div className="panel tight">
        <div className="row" style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Recent POs at this station</strong>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={() => void loadRegistry()}>
            <RotateCcw size={14} />
            Refresh
          </button>
        </div>
        {here.length === 0 ? (
          <div className="empty">Nothing logged here yet.</div>
        ) : (
          <div className="stack scroll-y" style={{ gap: 8 }}>
            {here.map((r) => (
              <div className="log-item" key={r.id}>
                <button
                  style={{ minWidth: 0, flex: 1, textAlign: "left" }}
                  onClick={() => setPoNumber(r.po_number)}
                >
                  <div className="lot mono">{r.po_number}</div>
                  <div className="log-meta mono">
                    <span>{r.log_date}</span>
                    <span>{formatStamp(r.updated_at)}</span>
                  </div>
                </button>
                <button
                  className="btn sm icon ghost"
                  aria-label={`Edit ${r.po_number}`}
                  onClick={() => void openEditor(r)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="btn sm icon danger"
                  aria-label={`Delete ${r.po_number}`}
                  onClick={() => void removeRecord(r)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
