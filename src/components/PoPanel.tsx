"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  CirclePlus,
  FileText,
  Info,
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
import PhaseControls from "./PhaseControls";

type Props = {
  step: Step;
  operators: Operator[];
  onOperatorsChanged: () => void;
  onToast: (m: string) => void;
};

export default function PoPanel({
  step,
  operators,
  onOperatorsChanged,
  onToast,
}: Props) {
  const [crew, setCrew] = useState<string[]>([]);
  const [poNumber, setPoNumber] = useState("");
  const [mode, setMode] = useState<"pick" | "type">("pick");
  const [search, setSearch] = useState("");
  const [linked, setLinked] = useState(true);

  const [registry, setRegistry] = useState<PoRegistryRow[]>([]);
  const [here, setHere] = useState<PoLog[]>([]);
  const [record, setRecord] = useState<PoLog | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);

  const valid = LOT_PATTERN.test(poNumber);

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
    if (mine.data) setHere(mine.data as PoLog[]);
  }, [step.id]);

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

  /** Open POs at this station float to the top, then everything else. */
  const listed = useMemo(() => {
    const openHere = new Set(here.map((h) => h.po_number));
    const q = search.trim().toUpperCase();
    const rows = registry.filter((r) => !q || r.po_number.includes(q));
    return rows
      .map((r) => ({ ...r, openHere: openHere.has(r.po_number) }))
      .sort((a, b) => Number(b.openHere) - Number(a.openHere))
      .slice(0, 60);
  }, [registry, here, search]);

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

      const plan = planAction(segments, action, linked, step);
      const ts = new Date().toISOString();
      const res = await applyPlan(plan, { kind: "po", id: target.id }, ts, crew);

      onToast(
        res.queued
          ? "Saved on this iPad. It will sync when wifi returns."
          : `${plan.describes} recorded for PO ${poNumber}.`
      );

      setSegments(await loadSegments({ kind: "po", id: target.id }));
      await loadRegistry();
    } finally {
      setBusy(false);
    }
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
            <button aria-pressed={mode === "pick"} onClick={() => setMode("pick")}>
              <Search size={15} />
              Known POs
              {registry.length > 0 && (
                <span className="badge" style={{ padding: "1px 7px" }}>
                  {registry.length}
                </span>
              )}
            </button>
            <button aria-pressed={mode === "type"} onClick={() => setMode("type")}>
              <CirclePlus size={15} />
              Type it
            </button>
          </div>
        </div>

        {mode === "type" ? (
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
                {registry.length === 0
                  ? "No POs yet. Use Type it to start one."
                  : "No PO matches that filter."}
              </div>
            ) : (
              <div className="lot-list">
                {listed.map((r) => (
                  <button
                    key={r.po_number}
                    className="lot-row"
                    aria-pressed={poNumber === r.po_number}
                    onClick={() => setPoNumber(r.po_number)}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="lid mono">{r.po_number}</div>
                      <div className="where">Last at {r.last_step}</div>
                    </div>
                    {r.openHere ? (
                      <span className="badge warn">Open here</span>
                    ) : (
                      <span className="badge">{r.record_count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {poNumber && !valid && <div className="err">{LOT_HINT}</div>}

        {valid && !record && knownElsewhere && (
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

      <PhaseControls
        segments={segments}
        step={step}
        operators={operators}
        linked={linked}
        onLinkChange={setLinked}
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
