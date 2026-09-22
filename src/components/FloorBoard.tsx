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
function FloorColumn({
  group,
  kind,
  scaleMs,
  big,
  zoom,
  onItemClick,
}: {
  group: FloorGroup;
  kind: "queue" | "process";
  scaleMs: number;
  big: boolean;
  /** Manual size multiplier, for tuning against real viewing distance. */
  zoom: number;
  onItemClick?: (ref: string) => void;
}) {
  const auto = useDisplayScale(big);
  const scale = auto * zoom;
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
  const minH = big ? 15 * scale : 11;
  /**
   * Width follows the display, not the zoom. Scaling it with zoom used to cost
   * a sub column, which forced more rows, which made the bars shorter and the
   * text smaller. Turning the size up made the board harder to read.
   */
  /**
   * Wide enough that a full lot number and its duration both fit. A nine
   * character number in the mono face plus a duration plus padding needs
   * roughly this much, and anything narrower clipped the lot number, which
   * is the one thing on the bar that has to be readable.
   */
  const minW = big ? 156 * auto : 126;

  const maxSub = Math.max(1, Math.floor((box.w + GAP) / (minW + GAP)));

  /**
   * In the dashboard the board is free to grow downwards, so every lot is
   * shown and the bars keep a comfortable fixed height. Only on a wall, where
   * the screen is a hard boundary, does anything have to give.
   */
  const ROW_H = 28;

  let shown = items;
  let hidden = 0;
  let subCols: number;
  let rows: number;
  let barH: number;

  if (!big) {
    subCols = Math.max(1, Math.min(maxSub, Math.ceil(items.length / 14)));
    rows = Math.max(1, Math.ceil(items.length / subCols));
    barH = ROW_H;
  } else {
    const maxRows = Math.max(1, Math.floor((box.h + GAP) / (minH + GAP)));
    const capacity = maxSub * maxRows;
    const overflow = box.h > 0 && items.length > capacity;
    shown = overflow ? items.slice(0, capacity) : items;
    hidden = items.length - shown.length;

    /**
     * Taller than it needs to be for a laptop, because the board's job is to
     * be read from across the shop floor. With Live as the default view there
     * are far fewer bars, so they reach this height rather than being
     * squeezed, and the text scales up with them.
     */
    const maxBarH = 54 * scale;
    const heightFor = (cols: number) => {
      const r = Math.max(1, Math.ceil(shown.length / cols));
      const natural = box.h > 0 ? (box.h - GAP * (r - 1)) / r : minH;
      return { r, h: Math.min(natural, maxBarH) };
    };

    /**
     * Wrapping early makes bars taller, and taller bars mean bigger text.
     * Filling one sub column to the brim before wrapping was leaving the text
     * far smaller than the space allowed, which is what made a wall display
     * hard to read. So the narrowest layout that reaches full bar height wins,
     * and failing that the one that gets closest.
     */
    let best = 1;
    let bestH = heightFor(1).h;
    for (let c = 1; c <= maxSub; c++) {
      const { h } = heightFor(c);
      if (h >= maxBarH) {
        best = c;
        bestH = h;
        break;
      }
      if (h > bestH) {
        best = c;
        bestH = h;
      }
    }

    subCols = best;
    rows = heightFor(best).r;
    barH = bestH;
  }

  const capped = !big || barH >= 54 * scale;

  const fontPx = Math.max(
    big ? 8 : 9,
    Math.min(big ? 24 * scale : 12, barH * (big ? 0.46 : 0.42))
  );

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

      {group.items.length === 0 ? (
        <div className="floor-empty">Nothing today</div>
      ) : (
        <div
          className={`floor-bars ${big ? "" : "grow"}`}
          ref={barsRef}
          style={{
            gridTemplateColumns: `repeat(${subCols}, minmax(0, 1fr))`,
            gridTemplateRows: capped
              ? `repeat(${rows}, ${barH}px)`
              : `repeat(${rows}, minmax(0, 1fr))`,
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
                style={{ fontSize: `${fontPx}px` }}
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
  zoom,
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
            zoom={zoom ?? 1}
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
  leftControls,
  queueGroups,
  processGroups,
  day,
  onDayChange,
  onRefresh,
  onItemClick,
  label,
}: {
  /** Rendered in the header, used for the lots against orders switch. */
  leftControls?: React.ReactNode;
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
            onItemClick={onItemClick}
            big={full}
            zoom={zoom}
          />
        )}
      </div>
    </div>
  );
}
