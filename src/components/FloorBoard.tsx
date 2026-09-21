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

/** Bars shrink as the floor fills up, so nothing needs scrolling. */
function barHeight(count: number, big: boolean): number {
  const base = big ? 1.5 : 1;
  if (count <= 6) return 36 * base;
  if (count <= 10) return 28 * base;
  if (count <= 16) return 22 * base;
  if (count <= 26) return 17 * base;
  return 13 * base;
}

export function FloorColumnSet({
  title,
  kind,
  groups,
  scaleMs,
  onItemClick,
  big,
}: Props) {
  const maxCount = Math.max(1, ...groups.map((g) => g.items.length));
  const h = barHeight(maxCount, Boolean(big));
  // On a wall display the duration is the whole point, so it stays unless the
  // bar is genuinely too thin to read. In fullscreen the bars stretch to fill
  // the column, so there is almost always room.
  const showTime = big || h >= 18;
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
          <div className="floor-col" key={g.name}>
            <div className="floor-col-head">
              <span className="fc-name">{g.name}</span>
              <span className="fc-count">
                {g.runningCount > 0 && (
                  <span className="fc-live">{g.runningCount}</span>
                )}
                {g.doneCount > 0 && (
                  <span className="fc-done">{g.doneCount}</span>
                )}
              </span>
            </div>

            {g.items.length === 0 ? (
              <div className="floor-empty">Nothing today</div>
            ) : (
              <div className="floor-bars">
                {g.items.map((it, i) => {
                  const pct = scaleMs > 0 ? (it.ms / scaleMs) * 100 : 0;
                  return (
                    <button
                      key={`${it.ref}-${i}`}
                      className={`floor-bar ${it.running ? "live" : "done"}`}
                      style={{ height: h }}
                      title={`${it.ref} at ${it.step}, ${formatDuration(
                        it.ms
                      )}, started ${formatClock(it.startedAt)}`}
                      onClick={() => onItemClick?.(it.ref)}
                    >
                      <span
                        className="fb-fill"
                        style={{ width: `${Math.max(pct, 3)}%` }}
                      />
                      <span className="fb-label mono">{it.ref}</span>
                      {showTime && (
                        <span className="fb-time mono">
                          {formatDuration(it.ms)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
