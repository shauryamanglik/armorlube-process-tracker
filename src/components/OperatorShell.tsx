"use client";

import { Cog, Hourglass, Pause, Play, Square } from "lucide-react";
import type { Operator, Segment } from "@/lib/types";
import { DEFAULT_RULES, formatClock, formatDuration } from "@/lib/time";
import { openSegment, rollup } from "@/lib/segments";

/**
 * The floor view.
 *
 * Operators told us the screen was too busy and made them scroll to reach the
 * buttons. So this shows only what is needed to act: who you are, which lot,
 * where it stands, and three buttons on one row. Everything else lives in the
 * admin view.
 *
 * The queue is never pressed. A lot enters the queue when the step before it
 * stops, and leaves it when Start is pressed here, so there is no button for
 * something the system already knows.
 */

export type OpAction = "start" | "pause" | "stop";

export function StatusStrip({
  segments,
  label,
}: {
  segments: Segment[];
  label: string;
}) {
  const q = rollup(segments, "queue", DEFAULT_RULES);
  const p = rollup(segments, "process", DEFAULT_RULES);
  const openQ = openSegment(segments, "queue");
  const openP = openSegment(segments, "process");

  const state = openP
    ? { text: "Running", cls: "run", since: openP.started_at }
    : openQ
    ? { text: "Waiting", cls: "wait", since: openQ.started_at }
    : segments.length > 0
    ? { text: "Finished here", cls: "done", since: null }
    : { text: "Not started", cls: "idle", since: null };

  return (
    <div className="op-strip">
      <div className={`op-state ${state.cls}`}>
        <span className="op-state-dot" />
        <div style={{ minWidth: 0 }}>
          <div className="op-state-text">{state.text}</div>
          <div className="op-state-sub">
            {state.since ? `since ${formatClock(state.since)}` : label}
          </div>
        </div>
      </div>

      <div className="op-times">
        <div className="op-time queue">
          <Hourglass size={14} />
          <span className="op-time-k">Waited</span>
          <span className="op-time-v">{formatDuration(q.businessMs)}</span>
        </div>
        <div className="op-time process">
          <Cog size={14} />
          <span className="op-time-k">Worked</span>
          <span className="op-time-v">{formatDuration(p.businessMs)}</span>
        </div>
      </div>
    </div>
  );
}

export function ActionRow({
  segments,
  ready,
  busy,
  onPress,
  finalStep,
}: {
  segments: Segment[];
  /** A name and a lot are chosen. */
  ready: boolean;
  busy: boolean;
  onPress: (a: OpAction) => void;
  finalStep?: boolean;
}) {
  const running = Boolean(openSegment(segments, "process"));

  return (
    <div className="op-actions">
      <button
        className="op-btn start"
        disabled={!ready || busy || running}
        onClick={() => onPress("start")}
      >
        <Play size={26} />
        <span>
          <span className="op-btn-main">Start</span>
          <span className="op-btn-sub">
            {running ? "already running" : "begin work"}
          </span>
        </span>
      </button>

      {/* Pause only means something while work is running. */}
      <button
        className="op-btn pause"
        disabled={!ready || busy || !running}
        onClick={() => onPress("pause")}
      >
        <Pause size={26} />
        <span>
          <span className="op-btn-main">Pause</span>
          <span className="op-btn-sub">
            {running ? "back to waiting" : "nothing running"}
          </span>
        </span>
      </button>

      <button
        className="op-btn stop"
        disabled={!ready || busy || !running}
        onClick={() => onPress("stop")}
      >
        <Square size={24} />
        <span>
          <span className="op-btn-main">Stop</span>
          <span className="op-btn-sub">
            {finalStep ? "finish the lot" : "send onward"}
          </span>
        </span>
      </button>
    </div>
  );
}

export function CrewRow({
  operators,
  value,
  onChange,
}: {
  operators: Operator[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="op-crew">
      {operators.map((o) => (
        <button
          key={o.id}
          className="op-name"
          aria-pressed={value.includes(o.id)}
          onClick={() =>
            onChange(
              value.includes(o.id)
                ? value.filter((v) => v !== o.id)
                : [...value, o.id]
            )
          }
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}
