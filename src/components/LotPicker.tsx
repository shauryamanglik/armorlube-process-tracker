"use client";

import { useMemo, useState } from "react";
import {
  CircleCheck,
  CirclePlus,
  Cog,
  Hourglass,
  Info,
  MapPin,
  PackageSearch,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { ActiveLot, Segment } from "@/lib/types";
import { LOT_HINT, LOT_PATTERN } from "@/lib/types";
import { formatStamp, todayInPhoenix } from "@/lib/time";
import { byPriority, dueLabel, type PriorityMap } from "@/lib/priority";
import { PriorityMark } from "./PriorityControls";
import { shortStep } from "@/lib/labels";

export type LotState =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "new" }
  | { kind: "known"; lot: ActiveLot }
  | { kind: "repeat"; lot?: ActiveLot; detail: string };

/** Where a lot is and what it is doing, for the picker rows. */
export type LotHere = {
  lot_id: string;
  label: string;
  tone: "queue" | "process" | "idle" | "done";
  since: string | null;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  lots: ActiveLot[];
  /** Lots with a record at this station, with their current state. */
  here: LotHere[];
  stepName: string;
  state: LotState;
  entryStep: boolean;
  /** Due dates and hot flags, so the list follows the same order as the floor. */
  prio?: PriorityMap;
};

export default function LotPicker({
  value,
  onChange,
  lots,
  here,
  stepName,
  state,
  entryStep,
  prio,
}: Props) {
  // Default to what is sitting at this station, because that is what the
  // operator is almost always looking for.
  const [scope, setScope] = useState<"here" | "all" | "type">(
    entryStep ? "type" : "here"
  );
  const [search, setSearch] = useState("");

  const hereMap = useMemo(
    () => new Map(here.map((h) => [h.lot_id, h])),
    [here]
  );

  type Row = { lot_id: string; here: LotHere | undefined; info: ActiveLot | undefined };
  const shown = useMemo((): Row[] => {
    const q = search.trim().toUpperCase();
    if (scope === "here") {
      return here
        .filter((h) => !q || h.lot_id.includes(q))
        .map((h) => ({
          lot_id: h.lot_id,
          here: h,
          info: lots.find((l) => l.lot_id === h.lot_id),
        }))
        .sort((a, b) => (b.here.since ?? "").localeCompare(a.here.since ?? ""));
    }
    return lots
      .filter((l) => !q || l.lot_id.includes(q))
      .map((l) => ({
        lot_id: l.lot_id,
        here: hereMap.get(l.lot_id),
        info: l,
      }));
  }, [scope, search, here, lots, hereMap]);

  // Same order the floor sees: hot, then due date, then arrival.
  const ordered = useMemo(
    () =>
      prio
        ? byPriority(shown, (x) => x.lot_id, (x) => x.here?.since ?? null, prio).slice(0, 60)
        : shown.slice(0, 60),
    [shown, prio]
  );
  const today = todayInPhoenix();

  const toneIcon = (tone?: string) =>
    tone === "process" ? (
      <Cog size={12} />
    ) : tone === "queue" ? (
      <Hourglass size={12} />
    ) : (
      <MapPin size={12} />
    );

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <span className="field-label" style={{ margin: 0 }}>
          <PackageSearch size={14} />
          Lot number
        </span>
        <div className="spacer" />
        <div className="seg">
          <button aria-pressed={scope === "here"} onClick={() => setScope("here")}>
            At this step
            <span className="badge" style={{ padding: "1px 7px" }}>
              {here.length}
            </span>
          </button>
          <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
            <Search size={15} />
            All on the line
            <span className="badge" style={{ padding: "1px 7px" }}>
              {lots.length}
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
          className={`input big mono ${
            state.kind === "invalid" ? "invalid" : ""
          }`}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Lot number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <>
          <input
            className="input mono"
            placeholder="Filter lots"
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
          />
          {shown.length === 0 ? (
            <div className="empty" style={{ padding: 22 }}>
              {scope === "here"
                ? `No lot is at ${stepName} right now. Switch to All on the line, or type one.`
                : lots.length === 0
                ? "No lots on the line yet. Use Type it to start one."
                : "No lot matches that filter."}
            </div>
          ) : (
            <div className="lot-list">
              {ordered.map((row) => (
                <button
                  key={row.lot_id}
                  className="lot-row"
                  aria-pressed={value === row.lot_id}
                  onClick={() => onChange(row.lot_id)}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="lid mono">{row.lot_id}</div>
                    <div className="where">
                      {row.here
                        ? row.here.since
                          ? `${row.here.label} since ${formatStamp(row.here.since)}`
                          : row.here.label
                        : row.info
                        ? `At ${shortStep(row.info.last_step)}`
                        : ""}
                    {prio && (
                        <PriorityMark
                          hot={prio.get(row.lot_id)?.hot}
                          due={dueLabel(prio.get(row.lot_id)?.due_date ?? null, today)}
                        />
                      )}
                    </div>
                  </div>
                  {row.here ? (
                    <span className={`state-pill ${row.here.tone}`}>
                      {toneIcon(row.here.tone)}
                      {row.here.label}
                    </span>
                  ) : (
                    <span className="badge">
                      {row.info?.last_step ?? "Elsewhere"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {state.kind === "invalid" && <div className="err">{LOT_HINT}</div>}

      {state.kind === "new" && LOT_PATTERN.test(value) && (
        <div className="lot-status new">
          <Info size={16} />
          <span>
            {entryStep
              ? "New lot. It will appear at every other step once logged here."
              : "This lot has not been logged anywhere yet. Check the number if it should already be on the line."}
          </span>
        </div>
      )}

      {state.kind === "known" && (
        <div className="lot-status known">
          <CircleCheck size={16} />
          <span>
            Existing lot, last seen at {state.lot.last_step}. Logging here adds
            to the same lot.
          </span>
        </div>
      )}

      {state.kind === "repeat" && (
        <div className="lot-status repeat">
          <TriangleAlert size={16} />
          <span>{state.detail}</span>
        </div>
      )}
    </div>
  );
}
