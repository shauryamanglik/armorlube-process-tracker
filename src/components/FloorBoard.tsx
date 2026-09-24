"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cog,
  Hourglass,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rows3,
} from "lucide-react";
import type { FloorGroup } from "@/lib/analytics";
import { formatDuration, formatClock, formatStamp } from "@/lib/time";
import { byPriority, type PriorityMap } from "@/lib/priority";
import { Flame } from "lucide-react";

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
  zoom?: number;
  prio?: PriorityMap;
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
 * How much bigger everything should be than on a laptop. A 65 inch TV driven
 * at 100% scaling reports 3840 CSS pixels, which would render a 15px label at
 * about 4mm on the glass: fine on a desk, useless from across a shop floor.
 * The board scales with the viewport so the text stays physically large.
 */
function useDisplayScale(big: boolean) {
  const [vw, setVw] = useState(1440);
  useEffect(() => {
    const read = () => setVw(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  if (!big) return 1;
  return Math.min(2.6, Math.max(1, vw / 1500));
}

/**
 * One area, holding every lot that touched it today.
 *
 * Fitting them all is the whole point of the board, so rather than scrolling
 * or clipping, the bars wrap into side by side sub columns once they would
 * get too short to read. A column twice as wide holds twice as many. Only if
 * even that runs out does anything drop, and running work is sorted first so
 * it is always what survives.
 */
/**
 * The layout the whole board shares.
 *
 * Every column used to work out its own bar height from its own lot count,
 * so a quiet column got tall bars and a busy one got thin ones sitting side
 * by side. One height is chosen for the board instead: the tallest that
 * every column can hold without overflowing, which is set by the busiest.
 */
type Layout = {
  barH: number;
  fontPx: number;
  /** Per column, because a column with more lots needs more sub columns. */
  subColsFor: (count: number, longestRef: number) => number;
  rowsFor: (count: number, subCols: number) => number;
  capacityFor: (longestRef: number) => number;
};

function useSharedLayout(
  groups: FloorGroup[],
  box: { w: number; h: number },
  colCount: number,
  big: boolean,
  auto: number,
  zoom: number
): Layout {
  const scale = auto * zoom;
  const minH = big ? 14 * scale : 11;
  const minFont = big ? 12 * auto : 9;
  const maxBarH = Math.min(34 * scale, 44);

  const colW = colCount > 0 ? (box.w - GAP * (colCount - 1)) / colCount : 0;
  // Each column has padding, a header and a gap above its bars, none of
  // which is space the bars can use.
  const COL_CHROME = 62;
  const inner = Math.max(0, colW - 20);
  const innerH = Math.max(0, box.h - COL_CHROME);

  const emFor = (longestRef: number) => 1.4 + 1.1 + longestRef * 0.62 + 2.9;
  const minWFor = (longestRef: number) => emFor(longestRef) * minFont;
  const maxSubFor = (longestRef: number) =>
    inner > 0 ? Math.max(1, Math.floor((inner + GAP) / (minWFor(longestRef) + GAP))) : 1;

  /** Tallest bar this column could use without spilling past the bottom. */
  const heightForGroup = (count: number, longestRef: number): number => {
    if (!big || innerH <= 0 || count === 0) return big ? maxBarH : 28;
    const maxSub = maxSubFor(longestRef);
    let best = 0;
    for (let c = 1; c <= maxSub; c++) {
      const rows = Math.max(1, Math.ceil(count / c));
      const h = (innerH - GAP * (rows - 1)) / rows;
      if (h > best) best = h;
      if (h >= maxBarH) return maxBarH;
    }
    return Math.min(best, maxBarH);
  };

  // The board takes the smallest of those, so no column overflows and every
  // bar on screen is the same height.
  let barH = maxBarH;
  if (big && innerH > 0) {
    for (const g of groups) {
      const longest = g.items.reduce((n, i) => Math.max(n, i.ref.length), 8);
      const h = heightForGroup(g.items.length, longest);
      if (g.items.length > 0 && h < barH) barH = h;
    }
    barH = Math.max(minH, Math.min(barH, maxBarH));
  } else if (!big) {
    barH = 28;
  }

  const longestOverall = groups.reduce(
    (n, g) => Math.max(n, g.items.reduce((m, i) => Math.max(m, i.ref.length), 8)),
    8
  );
  const subColsSample = maxSubFor(longestOverall);
  const subColW =
    subColsSample > 0 && inner > 0
      ? (inner - GAP * (subColsSample - 1)) / subColsSample
      : inner;
  const fontByWidth = subColW > 0 ? subColW / emFor(longestOverall) : Infinity;

  const fontPx = Math.max(
    7,
    Math.min(big ? 22 * scale : 12, barH * (big ? 0.46 : 0.42), fontByWidth)
  );

  const rowsPerCol =
    big && innerH > 0
      ? Math.max(1, Math.floor((innerH + GAP) / (barH + GAP)))
      : Infinity;

  return {
    barH,
    fontPx,
    capacityFor: (longestRef) =>
      big ? maxSubFor(longestRef) * (rowsPerCol === Infinity ? 999 : rowsPerCol) : Infinity,
    subColsFor: (count, longestRef) =>
      Math.max(
        1,
        Math.min(
          maxSubFor(longestRef),
          big ? Math.ceil(count / rowsPerCol) : Math.ceil(count / 14)
        )
      ),
    rowsFor: (count, subCols) => Math.max(1, Math.ceil(count / subCols)),
  };
}

function FloorColumn({
  group,
  kind,
  scaleMs,
  layout,
  onItemClick,
  prio,
}: {
  group: FloorGroup;
  kind: "queue" | "process";
  scaleMs: number;
  layout: Layout;
  onItemClick?: (ref: string) => void;
  prio?: PriorityMap;
}) {
  // Running work first, so a drop can only ever lose finished work. Within
  // each, the priority order the stations use: hot, then due date.
  const running = group.items.filter((i) => i.running);
  const finished = group.items.filter((i) => !i.running);
  const order = (list: typeof group.items) =>
    prio
      ? byPriority(list, (i) => i.ref, (i) => i.startedAt, prio)
      : [...list].sort((a, b) => b.ms - a.ms);
  const items = [...order(running), ...order(finished)];

  const longestRef = items.reduce((n, i) => Math.max(n, i.ref.length), 8);
  const capacity = layout.capacityFor(longestRef);
  const shown = items.length > capacity ? items.slice(0, capacity) : items;
  const hidden = items.length - shown.length;

  const subCols = layout.subColsFor(shown.length, longestRef);
  const rows = layout.rowsFor(shown.length, subCols);

  return (
    <div className="floor-col">
      <div className="floor-col-head">
        <span className="fc-name">{group.name}</span>
        <span className="fc-count">
          {group.runningCount > 0 && (
            <span className="fc-live" title="Here right now">
              {group.runningCount}
            </span>
          )}
          {group.doneCount > 0 && (
            <span className="fc-done" title="Was here earlier today, has moved on">
              {group.doneCount}
            </span>
          )}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="floor-empty">Nothing today</div>
      ) : (
        <div
          className="floor-bars"
          style={{
            gridTemplateColumns: `repeat(${subCols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, ${layout.barH}px)`,
            alignContent: "start",
            gap: GAP,
          }}
        >
          {shown.map((it, i) => {
            const pct = scaleMs > 0 ? (it.ms / scaleMs) * 100 : 0;
            return (
              <button
                key={`${it.ref}-${i}`}
                className={`floor-bar ${it.running ? "live" : "done"}`}
                style={{ fontSize: `${layout.fontPx}px` }}
                title={`${it.ref} at ${it.step}. Queue ${formatDuration(
                  it.queueMs
                )}, process ${formatDuration(it.processMs)}. ${
                  it.running
                    ? `Running since ${formatStamp(it.startedAt)}`
                    : `Now: ${it.nowAt ?? "moved on"}`
                }`}
                onClick={() => onItemClick?.(it.ref)}
              >
                <span
                  className="fb-fill"
                  style={{ width: `${Math.max(pct, 3)}%` }}
                />
                <span className="fb-label">
                  {prio?.get(it.ref)?.hot && <Flame size={12} className="flame fb-flame" />}
                  {it.ref}
                </span>
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
  prio,
  onItemClick,
  big,
  zoom,
}: Props) {
  const running = groups.reduce((a, g) => a + g.runningCount, 0);
  const auto = useDisplayScale(Boolean(big));
  const colsRef = useRef<HTMLDivElement>(null);
  const box = useBox(colsRef);
  const layout = useSharedLayout(
    groups,
    box,
    groups.length,
    Boolean(big),
    auto,
    zoom ?? 1
  );

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
        ref={colsRef}
        style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
      >
        {groups.map((g) => (
          <FloorColumn
            key={g.name}
            group={g}
            kind={kind}
            scaleMs={scaleMs}
            layout={layout}
            onItemClick={onItemClick}
            prio={prio}
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
  leftControls,
  queueGroups,
  processGroups,
  day,
  onDayChange,
  onRefresh,
  onItemClick,
  label,
  prio,
}: {
  /** Rendered in the header, used for the lots against orders switch. */
  leftControls?: React.ReactNode;
  /** Due dates and hot flags, so the board follows the stations' order. */
  prio?: PriorityMap;
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
  /** Show everything that touched the floor today, only what is running, or
   *  only what has already moved on. */
  const [state, setState] = useState<"both" | "live" | "done">("live");
  /**
   * Viewing distance is the one thing the board cannot work out for itself,
   * so the size is adjustable and the choice sticks on that display.
   */
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const saved = Number(localStorage.getItem("apt.board.zoom"));
    if (saved >= 0.7 && saved <= 2) setZoom(saved);
  }, []);
  const setZoomSaved = (z: number) => {
    const clamped = Math.round(Math.min(2, Math.max(0.7, z)) * 20) / 20;
    setZoom(clamped);
    localStorage.setItem("apt.board.zoom", String(clamped));
  };
  const [view, setView] = useState<"both" | "queue" | "process">("both");
  const [auto, setAuto] = useState(true);
  const [ago, setAgo] = useState(0);

  // One scale across both boards, so a bar's length means the same thing
  // whether it is queue or process.
  /** Narrow the bars without recomputing anything, so the counts in the
   *  column headers still describe what is on screen. */
  const narrow = (groups: FloorGroup[]): FloorGroup[] =>
    state === "both"
      ? groups
      : groups.map((g) => {
          const items = g.items.filter((i) =>
            state === "live" ? i.running : !i.running
          );
          return {
            ...g,
            items,
            runningCount: items.filter((i) => i.running).length,
            doneCount: items.filter((i) => !i.running).length,
          };
        });

  const shownQueue = narrow(queueGroups);
  const shownProcess = narrow(processGroups);

  // Scale is taken from the unfiltered set, so a bar keeps the same length
  // whichever view is on and the eye can compare across them.
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
        {leftControls}
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

        <div className="seg">
          <button
            aria-pressed={state === "both"}
            onClick={() => setState("both")}
            title="Everything that touched the floor today"
          >
            Live &amp; Old
          </button>
          <button
            aria-pressed={state === "live"}
            onClick={() => setState("live")}
            title="Only what is running right now"
          >
            <span className="live-dot" />
            Live
          </button>
          <button
            aria-pressed={state === "done"}
            onClick={() => setState("done")}
            title="Only what has already moved on"
          >
            Old
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

        {full && (
          <span className="zoom-ctl" title="Size for viewing distance">
            <button
              onClick={() => setZoomSaved(zoom - 0.1)}
              disabled={zoom <= 0.7}
              aria-label="Smaller"
            >
              <Minus size={14} />
            </button>
            <span className="zoom-val">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoomSaved(zoom + 0.1)}
              disabled={zoom >= 2}
              aria-label="Larger"
            >
              <Plus size={14} />
            </button>
          </span>
        )}

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
            groups={shownQueue}
            scaleMs={scaleMs}
            prio={prio}
            onItemClick={onItemClick}
            big={full}
            zoom={zoom}
          />
        )}
        {(view === "both" || view === "process") && (
          <FloorColumnSet
            title="Being worked"
            kind="process"
            groups={shownProcess}
            scaleMs={scaleMs}
            prio={prio}
            onItemClick={onItemClick}
            big={full}
            zoom={zoom}
          />
        )}
      </div>
    </div>
  );
}
