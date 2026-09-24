"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Flame, X } from "lucide-react";
import {
  between,
  byPriority,
  rankOf,
  savePriority,
  type PriorityKind,
  type PriorityMap,
} from "@/lib/priority";

/**
 * Due date, hot and position, on one row. Only shown where work is created,
 * so the rest of the floor sees the order without being asked to set it.
 */
export function PriorityRow({
  kind,
  refId,
  map,
  others,
  onChanged,
}: {
  kind: PriorityKind;
  /** The lot or order being made. Controls stay dormant until it is valid. */
  refId: string;
  map: PriorityMap;
  /** Everything else currently open, to place this one among. */
  others: string[];
  onChanged: () => void;
}) {
  const current = map.get(refId);
  const [due, setDue] = useState(current?.due_date ?? "");
  const [hot, setHot] = useState(Boolean(current?.hot));
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    setDue(current?.due_date ?? "");
    setHot(Boolean(current?.hot));
  }, [refId, current?.due_date, current?.hot]);

  const active = Boolean(refId);

  async function setDueDate(v: string) {
    setDue(v);
    if (!active) return;
    await savePriority(kind, refId, {
      due_date: v || null,
      // A new date should win over an old manual placement, or the list
      // would silently ignore the date that was just typed.
      manual_rank: null,
    });
    onChanged();
  }

  async function toggleHot() {
    const next = !hot;
    setHot(next);
    if (!active) return;
    await savePriority(kind, refId, { hot: next });
    onChanged();
  }

  return (
    <>
      <div className="prio-row">
        <label className="prio-due">
          <span>Due</span>
          <input
            type="date"
            className="input"
            value={due}
            disabled={!active}
            onChange={(e) => void setDueDate(e.target.value)}
          />
        </label>

        <button
          className={`prio-hot ${hot ? "on" : ""}`}
          disabled={!active}
          aria-pressed={hot}
          onClick={() => void toggleHot()}
          title="Hot jobs go to the top at every station"
        >
          <Flame size={17} />
          Hot job
        </button>

        <button
          className="prio-order"
          disabled={!active}
          onClick={() => setOrdering(true)}
          title="Place it above or below another"
        >
          <ArrowUpDown size={16} />
          Set order
        </button>
      </div>

      {ordering && (
        <OrderDialog
          kind={kind}
          refId={refId}
          map={map}
          others={others}
          onClose={() => setOrdering(false)}
          onSaved={() => {
            setOrdering(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}

/**
 * The priority list with this item in it, moved with arrows. Only the item
 * being placed moves, and only its own rank is written, so nothing else on
 * the list is disturbed by someone reordering one lot.
 */
function OrderDialog({
  kind,
  refId,
  map,
  others,
  onClose,
  onSaved,
}: {
  kind: PriorityKind;
  refId: string;
  map: PriorityMap;
  others: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = useMemo(() => {
    const all = Array.from(new Set([...others, refId]));
    return byPriority(all, (r) => r, () => null, map);
  }, [others, refId, map]);

  const [order, setOrder] = useState<string[]>(start);
  const [saving, setSaving] = useState(false);
  const at = order.indexOf(refId);

  const mineHot = Boolean(map.get(refId)?.hot);

  /**
   * Hot jobs always sort above everything else, so letting an item cross
   * that boundary here would show an order the list then refuses to keep.
   * Moves stop at the edge of the item's own group instead.
   */
  function canMove(dir: -1 | 1): boolean {
    const to = at + dir;
    if (to < 0 || to >= order.length) return false;
    return Boolean(map.get(order[to])?.hot) === mineHot;
  }

  function move(dir: -1 | 1) {
    if (!canMove(dir)) return;
    const to = at + dir;
    const next = [...order];
    [next[at], next[to]] = [next[to], next[at]];
    setOrder(next);
  }

  async function save() {
    setSaving(true);
    try {
      const above = at > 0 ? order[at - 1] : null;
      const below = at < order.length - 1 ? order[at + 1] : null;
      const rank = between(
        above ? rankOf(map.get(above)) : null,
        below ? rankOf(map.get(below)) : null
      );
      // Only the position is written. Hot stays exactly as it was.
      await savePriority(kind, refId, { manual_rank: rank });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal order-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 style={{ margin: 0 }}>Where does it go?</h3>
          <div className="spacer" />
          <button className="btn sm icon ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Top is worked first, at every station.
          {mineHot
            ? " Hot jobs stay above everything else."
            : " Hot jobs always stay above this."}
        </p>

        <div className="order-list">
          {order.map((r, i) => {
            const p = map.get(r);
            const mine = r === refId;
            return (
              <div key={r} className={`order-item ${mine ? "mine" : ""}`}>
                <span className="order-pos">{i + 1}</span>
                <span className="mono order-ref">{r}</span>
                {p?.hot && <Flame size={14} className="flame" />}
                {p?.due_date && <span className="order-due">{p.due_date}</span>}
              </div>
            );
          })}
        </div>

        <div className="row">
          <button className="btn" disabled={!canMove(-1)} onClick={() => move(-1)}>
            <ArrowUp size={16} />
            Up
          </button>
          <button className="btn" disabled={!canMove(1)} onClick={() => move(1)}>
            <ArrowDown size={16} />
            Down
          </button>
          <div className="spacer" />
          <button className="btn primary" disabled={saving} onClick={() => void save()}>
            <Check size={16} />
            {saving ? "Saving" : "Save order"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The fire mark, and a due date, for a lot or order in any list. */
export function PriorityMark({
  hot,
  due,
}: {
  hot?: boolean;
  due?: { text: string; tone: "late" | "soon" | "ok" } | null;
}) {
  if (!hot && !due) return null;
  return (
    <span className="prio-mark">
      {hot && <Flame size={13} className="flame" />}
      {due && <span className={`due-tag ${due.tone}`}>{due.text}</span>}
    </span>
  );
}
