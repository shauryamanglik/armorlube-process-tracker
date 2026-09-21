"use client";

import { useEffect, useState } from "react";
import {
  Cog,
  Hourglass,
  Maximize2,
  Minimize2,
  RefreshCw,
  Rows3,
} from "lucide-react";
import { boardMax, type LiveArea } from "@/lib/liveboard";
import { formatClock, formatDuration } from "@/lib/time";

type Kind = "queue" | "process";

function Column({
  area,
  bars,
  liveCount,
  doneCount,
  max,
  kind,
  big,
}: LiveArea & { max: number; kind: Kind; big: boolean }) {
  return (
    <div className="lb-col">
      <div className="lb-col-head">
        <span className="lb-area">{area}</span>
        <span className="spacer" />
        {liveCount > 0 && (
          <span className="lb-count live">
            <span className="lb-pulse" />
            {liveCount}
          </span>
        )}
        {doneCount > 0 && <span className="lb-count done">{doneCount}</span>}
      </div>

      <div className="lb-bars">
        {bars.length === 0 ? (
          <div className="lb-empty">Nothing here</div>
        ) : (
          bars.map((b) => {
            const pct = Math.max(6, (b.ms / max) * 100);
            return (
              <div
                className={`lb-row ${b.live ? "live" : "done"} ${kind}`}
                key={b.ref}
                title={`${b.ref} at ${b.step}${
                  b.since ? `, since ${formatClock(b.since)}` : ""
                }`}
              >
                <div className="lb-fill" style={{ width: `${pct}%` }} />
                <span className={`lb-ref mono ${big ? "big" : ""}`}>
                  {b.ref}
                </span>
                <span className={`lb-dur mono ${big ? "big" : ""}`}>
                  {formatDuration(b.ms)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Board({
  areas,
  kind,
  big,
}: {
  areas: LiveArea[];
  kind: Kind;
  big: boolean;
}) {
  const max = boardMax(areas);
  return (
    <div className="lb-board">
      <div className="lb-title">
        {kind === "queue" ? <Hourglass size={big ? 20 : 16} /> : <Cog size={big ? 20 : 16} />}
        <strong>{kind === "queue" ? "Waiting" : "Being worked"}</strong>
        <span className="hint">
          {kind === "queue"
            ? "time sat in queue today"
            : "hands-on time today"}
        </span>
      </div>
      <div
        className="lb-cols"
        style={{ gridTemplateColumns: `repeat(${areas.length}, minmax(0, 1fr))` }}
      >
        {areas.map((a) => (
          <Column key={a.area} {...a} max={max} kind={kind} big={big} />
        ))}
      </div>
    </div>
  );
}

export default function LiveBoard({
  title,
  queueAreas,
  processAreas,
  day,
  onDayChange,
  onRefresh,
}: {
  title: string;
  queueAreas: LiveArea[];
  processAreas: LiveArea[];
  day: string;
  onDayChange: (d: string) => void;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<"both" | "queue" | "process">("both");
  const [full, setFull] = useState(false);
  const [auto, setAuto] = useState(true);
  const [beat, setBeat] = useState(0);

  // On a wall display nobody is going to tap refresh, so it refreshes itself.
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      onRefresh();
      setBeat((n) => n + 1);
    }, 60000);
    return () => clearInterval(t);
  }, [auto, onRefresh]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const totalLive =
    queueAreas.reduce((a, x) => a + x.liveCount, 0) +
    processAreas.reduce((a, x) => a + x.liveCount, 0);

  const body = (
    <>
      <div className="lb-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="lb-h">{title}</h2>
          <div className="hint">
            {totalLive} running right now
            {beat > 0 && auto ? " · refreshes every minute" : ""}
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
            <Hourglass size={15} />
            Waiting
          </button>
          <button
            aria-pressed={view === "process"}
            onClick={() => setView("process")}
          >
            <Cog size={15} />
            Working
          </button>
        </div>

        {!full && (
          <input
            type="date"
            className="input"
            style={{ width: 160 }}
            value={day}
            onChange={(e) => onDayChange(e.target.value)}
          />
        )}

        <button
          className="btn sm ghost"
          onClick={() => setAuto((v) => !v)}
          title={auto ? "Auto refresh on" : "Auto refresh off"}
        >
          <RefreshCw size={15} className={auto ? "spin-slow" : ""} />
        </button>

        <button className="btn sm" onClick={() => setFull((v) => !v)}>
          {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          {full ? "Exit" : "Full screen"}
        </button>
      </div>

      <div className="lb-legend">
        <span className="lb-key live-key" /> Running now
        <span className="lb-key done-key" /> Finished there today
        <span className="hint" style={{ marginLeft: "auto" }}>
          Bar length is time. Longest bar on the board sets the scale.
        </span>
      </div>

      <div className={`lb-stack ${view === "both" ? "two" : "one"}`}>
        {(view === "both" || view === "queue") && (
          <Board areas={queueAreas} kind="queue" big={full} />
        )}
        {(view === "both" || view === "process") && (
          <Board areas={processAreas} kind="process" big={full} />
        )}
      </div>
    </>
  );

  if (full) {
    return (
      <div className="lb-full">
        <div className="lb-full-inner">{body}</div>
      </div>
    );
  }

  return <section className="chart-block lb-wrap">{body}</section>;
}
