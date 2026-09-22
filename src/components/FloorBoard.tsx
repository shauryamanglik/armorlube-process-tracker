"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cog,
  Hourglass,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Rows3,
} from "lucide-react";
import type { FloorGroup } from "@/lib/analytics";
import { formatDuration, formatClock } from "@/lib/time";

/**
 * The floor board is meant to be readable from across a room, so it is built
 * from plain elements rather than a chart library. That keeps the labels on
 * the bars, lets the bars resize to fit however many lots are on the floor,
 * and makes fullscreen behave.
 */

type Props = {
  title: string;
  kind: "queue" | "process";
  groups: FloorGroup[];
  /** Longest bar in the pair, so queue and process share one scale. */
  scaleMs: number;
  onItemClick?: (ref: string) => void;
  big?: boolean;
};

/** Live box size of an element, so the layout can be worked out from the
 *  space that actually exists rather than guessed from a lot count. */
function useBox(ref: React.RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

const GAP = 4;

/**
 * One area, holding every lot that touched it today.
 *
 * Fitting them all is the whole point of the board, so rather than scrolling
 * or clipping, the bars wrap into side by side sub columns once they would
 * get too short to read. A column twice as wide holds twice as many. Only if
 * even that runs out does anything drop, and running work is sorted first so
 * it is always what survives.
 */
function FloorColumn({
  group,
  kind,
  scaleMs,
  big,
  onItemClick,
}: {
  group: FloorGroup;
  kind: "queue" | "process";
  scaleMs: number;
  big: boolean;
  onItemClick?: (ref: string) => void;
}) {
  const barsRef = useRef<HTMLDivElement>(null);
  const box = useBox(barsRef);

  // Running first, then longest, so a drop can only ever lose finished work.
  const items = [...group.items].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return b.ms - a.ms;
  });

  // How small a bar may get before wrapping into another sub column. Tuned
  // so a 1080p wall fits roughly sixty lots per area with both boards shown,
  // and about double that with a single board on screen.
  const minH = big ? 15 : 11;
  const minW = big ? 104 : 84;

  const maxSub = Math.max(1, Math.floor((box.w + GAP) / (minW + GAP)));
  const maxRows = Math.max(1, Math.floor((box.h + GAP) / (minH + GAP)));
  const capacity = maxSub * maxRows;

  const overflow = box.h > 0 && items.length > capacity;
  const shown = overflow ? items.slice(0, capacity) : items;
  const hidden = items.length - shown.length;

  const subCols = Math.max(
    1,
    Math.min(maxSub, Math.ceil(shown.length / Math.max(1, maxRows)))
  );
  const rows = Math.max(1, Math.ceil(shown.length / subCols));
  const barH = box.h > 0 ? (box.h - GAP * (rows - 1)) / rows : minH;

  // Text scales with whatever height the bar ended up at.
  const fontPx = Math.max(
    big ? 8 : 7.5,
    Math.min(big ? 26 : 12, barH * 0.46)
  );

  return (
    <div className="floor-col">
      <div className="floor-col-head">
        <span className="fc-name">{group.name}</span>
        <span className="fc-count">
          {group.runningCount > 0 && (
            <span className="fc-live">{group.runningCount}</span>
          )}
          {group.doneCount > 0 && (
            <span className="fc-done">{group.doneCount}</span>
          )}
        </span>
      </div>

      {group.items.length === 0 ? (
        <div className="floor-empty">Nothing today</div>
      ) : (
        <div
          className="floor-bars"
          ref={barsRef}
          style={{
            gridTemplateColumns: `repeat(${subCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            gap: GAP,
          }}
        >
          {shown.map((it, i) => {
            const pct = scaleMs > 0 ? (it.ms / scaleMs) * 100 : 0;
            return (
              <button
                key={`${it.ref}-${i}`}
                className={`floor-bar ${it.running ? "live" : "done"}`}
                style={{ fontSize: `${fontPx}px` }}
                title={`${it.ref} at ${it.step}, ${formatDuration(
                  it.ms
                )}, started ${formatClock(it.startedAt)}`}
                onClick={() => onItemClick?.(it.ref)}
              >
                <span
                  className="fb-fill"
                  style={{ width: `${Math.max(pct, 3)}%` }}
                />
                <span className="fb-label">{it.ref}</span>
                <span className="fb-time">{formatDuration(it.ms)}</span>
              </button>
            );
          })}
        </div>
      )}

      {hidden > 0 && (
        <div className="floor-more" title="Finished work, hidden because the column is full">
          +{hidden} finished not shown
        </div>
      )}
    </div>
  );
}

export function FloorColumnSet({
  title,
  kind,
  groups,
  scaleMs,
  onItemClick,
  big,
}: Props) {
  const running = groups.reduce((a, g) => a + g.runningCount, 0);

  return (
    <div className={`floor-set ${kind} ${big ? "big" : ""}`}>
      <div className="floor-set-head">
        <span className="phase-mark">
          {kind === "queue" ? <Hourglass size={16} /> : <Cog size={16} />}
        </span>
        <strong>{title}</strong>
        <span className="badge">{running} running</span>
        <div className="spacer" />
        <span className="floor-legend">
          <span className={`lg-dot ${kind} live`} /> On it now
          <span className={`lg-dot ${kind} done`} /> Moved on
          <span className="hint" style={{ marginLeft: 10 }}>
            tap a bar for its history
          </span>
        </span>
      </div>

      <div
        className="floor-cols"
        style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
      >
        {groups.map((g) => (
          <FloorColumn
            key={g.name}
            group={g}
            kind={kind}
            scaleMs={scaleMs}
            big={Boolean(big)}
            onItemClick={onItemClick}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Wraps one or both boards with the controls: which day, refresh, and
 * fullscreen for putting it on a wall display.
 */
export default function FloorBoard({
  queueGroups,
  processGroups,
  day,
  onDayChange,
  onRefresh,
  onItemClick,
  label,
}: {
  queueGroups: FloorGroup[];
  processGroups: FloorGroup[];
  day: string;
  onDayChange: (d: string) => void;
  onRefresh: () => void;
  onItemClick?: (ref: string) => void;
  label: string;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [view, setView] = useState<"both" | "queue" | "process">("both");
  const [auto, setAuto] = useState(true);
  const [ago, setAgo] = useState(0);

  // One scale across both boards, so a bar's length means the same thing
  // whether it is queue or process.
  const scaleMs = Math.max(
    1,
    ...queueGroups.flatMap((g) => g.items.map((i) => i.ms)),
    ...processGroups.flatMap((g) => g.items.map((i) => i.ms))
  );

  const refresh = useCallback(() => {
    onRefresh();
    setAgo(0);
  }, [onRefresh]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      setAgo((n) => {
        if (n >= 59) {
          onRefresh();
          return 0;
        }
        return n + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [auto, onRefresh]);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFull() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (shell.current) {
      await shell.current.requestFullscreen();
    }
  }

  return (
    <div className={`floor-shell ${full ? "full" : ""}`} ref={shell}>
      <div className="floor-top">
        <div style={{ minWidth: 0 }}>
          <h2 className="floor-title">{label}</h2>
          <div className="hint">
            Every bar is one {label.includes("order") ? "order" : "lot"} and how
            long it has been where it is. Bright bars are being worked now, dim
            ones moved on earlier today.
          </div>
        </div>
        <div className="spacer" />

        <div className="seg">
          <button aria-pressed={view === "both"} onClick={() => setView("both")}>
            <Rows3 size={15} />
            Both
          </button>
          <button
            aria-pressed={view === "queue"}
            onClick={() => setView("queue")}
          >
            Queue
          </button>
          <button
            aria-pressed={view === "process"}
            onClick={() => setView("process")}
          >
            Process
          </button>
        </div>

        <input
          type="date"
          className="input"
          style={{ width: 160 }}
          value={day}
          onChange={(e) => onDayChange(e.target.value)}
        />

        <button
          className="btn sm"
          onClick={() => setAuto((v) => !v)}
          title={auto ? "Pause auto refresh" : "Resume auto refresh"}
        >
          {auto ? <Pause size={15} /> : <Play size={15} />}
          {auto ? `${60 - ago}s` : "Paused"}
        </button>

        <button className="btn sm" onClick={refresh}>
          <RefreshCw size={15} />
        </button>

        <button className="btn sm primary" onClick={() => void toggleFull()}>
          {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          {full ? "Exit" : "Full screen"}
        </button>
      </div>

      <div className="floor-body">
        {(view === "both" || view === "queue") && (
          <FloorColumnSet
            title="Waiting"
            kind="queue"
            groups={queueGroups}
            scaleMs={scaleMs}
            onItemClick={onItemClick}
            big={full}
          />
        )}
        {(view === "both" || view === "process") && (
          <FloorColumnSet
            title="Being worked"
            kind="process"
            groups={processGroups}
            scaleMs={scaleMs}
            onItemClick={onItemClick}
            big={full}
          />
        )}
      </div>
    </div>
  );
}
