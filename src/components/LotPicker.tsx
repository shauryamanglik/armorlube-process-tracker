"use client";

import { useMemo, useState } from "react";
import {
  CircleCheck,
  CirclePlus,
  Info,
  PackageSearch,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { ActiveLot } from "@/lib/types";
import { LOT_PATTERN } from "@/lib/types";

export type LotState =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "new" }
  | { kind: "known"; lot: ActiveLot }
  | { kind: "repeat"; lot?: ActiveLot; detail: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  lots: ActiveLot[];
  state: LotState;
  /** True at the first step of the line, where new lots normally start. */
  entryStep: boolean;
};

export default function LotPicker({
  value,
  onChange,
  lots,
  state,
  entryStep,
}: Props) {
  const [mode, setMode] = useState<"pick" | "type">(
    entryStep ? "type" : "pick"
  );
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const q = search.trim();
    const list = q ? lots.filter((l) => l.lot_id.includes(q)) : lots;
    return list.slice(0, 60);
  }, [lots, search]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <span className="field-label" style={{ margin: 0 }}>
          <PackageSearch size={14} />
          Lot number
        </span>
        <div className="spacer" />
        <div className="seg">
          <button aria-pressed={mode === "pick"} onClick={() => setMode("pick")}>
            <Search size={15} />
            On the line
            {lots.length > 0 && (
              <span className="badge" style={{ padding: "1px 7px" }}>
                {lots.length}
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
          className={`input big mono ${
            state.kind === "invalid" ? "invalid" : ""
          }`}
          inputMode="numeric"
          placeholder="000000-00"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      ) : (
        <>
          <input
            className="input mono"
            placeholder="Filter lots"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {shown.length === 0 ? (
            <div className="empty" style={{ padding: 22 }}>
              {lots.length === 0
                ? "No lots on the line yet. Use Type it to start one."
                : "No lot matches that filter."}
            </div>
          ) : (
            <div className="lot-list">
              {shown.map((l) => (
                <button
                  key={l.lot_id}
                  className="lot-row"
                  aria-pressed={value === l.lot_id}
                  onClick={() => onChange(l.lot_id)}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="lid mono">{l.lot_id}</div>
                    <div className="where">
                      Last at {l.last_step}, {l.last_area}
                    </div>
                  </div>
                  <span className="badge">
                    {l.step_count} {l.step_count === 1 ? "step" : "steps"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {state.kind === "invalid" && (
        <div className="err">
          Lot numbers are six digits, a dash, then two digits.
        </div>
      )}

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
            Existing lot, last seen at {state.lot.last_step}. Logging here adds to
            the same lot.
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
