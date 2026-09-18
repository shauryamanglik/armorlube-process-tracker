"use client";

import { useEffect, useState } from "react";
import {
  CircleCheck,
  Cog,
  CornerUpLeft,
  History,
  Hourglass,
  LogIn,
  LogOut,
  PlayCircle,
  PackageCheck,
} from "lucide-react";
import type { Operator, Segment } from "@/lib/types";
import { DEFAULT_RULES, formatDuration, formatStamp } from "@/lib/time";
import { interruptions, ofKind, openSegment, rollup } from "@/lib/segments";
import { planAction, type Action } from "@/lib/segmentActions";

type Props = {
  segments: Segment[];
  step: { has_queue: boolean; has_process: boolean; is_final?: boolean };
  operators: Operator[];
  onPress: (a: Action) => void;
  disabled?: boolean;
  arrivedFrom?: string | null;
};

/**
 * Queue out and process in were always the same moment, so they are one
 * button. The sequence an operator sees is simply: it arrived, work started,
 * work finished, with a way to send it back to the queue part way through.
 */
export default function PhaseControls({
  segments,
  step,
  operators,
  onPress,
  disabled,
  arrivedFrom,
}: Props) {
  const [tick, setTick] = useState(0);
  const [armed, setArmed] = useState<Action | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  void tick;

  useEffect(() => setArmed(null), [segments]);

  const openQueue = openSegment(segments, "queue");
  const openProcess = openSegment(segments, "process");
  const q = rollup(segments, "queue", DEFAULT_RULES);
  const p = rollup(segments, "process", DEFAULT_RULES);
  const breaks = interruptions(segments);

  const opName = (id: string) =>
    operators.find((o) => o.id === id)?.name ?? "Unknown";

  function fire(a: Action) {
    const plan = planAction(segments, a, true, step);
    if (plan.outOfOrder && armed !== a) {
      setArmed(a);
      return;
    }
    setArmed(null);
    onPress(a);
  }

  function state(a: Action): "ready" | "waiting" {
    return planAction(segments, a, true, step).outOfOrder ? "waiting" : "ready";
  }

  /** The buttons, in the order the work actually happens. */
  const actions: {
    id: Action;
    label: string;
    sub: string;
    tone: "in" | "out" | "mid";
    icon: React.ReactNode;
    show: boolean;
  }[] = [
    {
      id: "queue_in",
      label: "Queue in",
      sub: openQueue
        ? `Waiting since ${formatStamp(openQueue.started_at)}`
        : "It arrived and is waiting",
      tone: "in",
      icon: <LogIn size={19} />,
      show: step.has_queue,
    },
    {
      id: "process_in",
      label: "Start process",
      sub: openProcess
        ? `Running since ${formatStamp(openProcess.started_at)}`
        : step.has_queue
        ? "Ends the queue and starts the work"
        : "Work starts",
      tone: "mid",
      icon: <PlayCircle size={19} />,
      show: step.has_process,
    },
    {
      id: "queue_out",
      label: "Queue out",
      sub: "It leaves the queue",
      tone: "out",
      icon: <LogOut size={19} />,
      // Only a step with no process phase needs this on its own.
      show: step.has_queue && !step.has_process,
    },
    {
      id: "process_out",
      label: step.is_final ? "Process out and close lot" : "Process out",
      sub: step.is_final
        ? "Finishes the work and retires the lot from the line"
        : "Finishes the work and hands it on",
      tone: "out",
      icon: step.is_final ? <PackageCheck size={19} /> : <LogOut size={19} />,
      show: step.has_process,
    },
  ];

  return (
    <div className="stack">
      {/* running totals */}
      <div className="grid-2">
        {step.has_queue && (
          <div className="phase-stat queue">
            <span className="phase-mark">
              <Hourglass size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="ps-k">
                Queue
                {q.count > 1 && (
                  <span className="badge" style={{ marginLeft: 7 }}>
                    {q.count}
                  </span>
                )}
              </div>
              <div className="ps-v">{formatDuration(q.businessMs)}</div>
              {q.running && <div className="ps-live">running now</div>}
            </div>
          </div>
        )}
        {step.has_process && (
          <div className="phase-stat process">
            <span className="phase-mark">
              <Cog size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="ps-k">
                Process
                {p.count > 1 && (
                  <span className="badge" style={{ marginLeft: 7 }}>
                    {p.count}
                  </span>
                )}
              </div>
              <div className="ps-v">{formatDuration(p.businessMs)}</div>
              {p.running && <div className="ps-live">running now</div>}
            </div>
          </div>
        )}
      </div>

      {arrivedFrom && openQueue && (
        <div className="arrived-note">
          <CornerUpLeft size={14} />
          Arrived from {arrivedFrom} at{" "}
          <span className="mono">{formatStamp(openQueue.started_at)}</span>
        </div>
      )}

      {/* the actions, in order */}
      <div className="actions-col">
        {actions
          .filter((a) => a.show)
          .map((a) => {
            const mode = state(a.id);
            const isArmed = armed === a.id;
            return (
              <button
                key={a.id}
                className={[
                  "abtn",
                  a.tone,
                  isArmed ? "armed" : mode,
                  a.id === "process_out" && step.is_final ? "final" : "",
                ].join(" ")}
                disabled={disabled}
                onClick={() => fire(a.id)}
              >
                <span className="a-ico">{a.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="a-label">{a.label}</span>
                  <span className="a-sub">
                    {isArmed ? "Out of order. Tap again to confirm." : a.sub}
                  </span>
                </span>
              </button>
            );
          })}

        {openProcess && step.has_queue && (
          <button
            className="abtn back"
            disabled={disabled}
            onClick={() => fire("back_to_queue")}
          >
            <span className="a-ico">
              <CornerUpLeft size={19} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="a-label">Back to queue</span>
              <span className="a-sub">
                Stops the process timer, everything stays logged
              </span>
            </span>
          </button>
        )}
      </div>

      {breaks > 0 && (
        <div className="lot-status repeat">
          <CornerUpLeft size={16} />
          <span>
            Sent back to queue {breaks} {breaks === 1 ? "time" : "times"}. All
            stretches are added together.
          </span>
        </div>
      )}

      {segments.length > 0 && (
        <div className="panel tight">
          <button
            className="btn sm ghost"
            onClick={() => setShowLog((v) => !v)}
            style={{ width: "100%", justifyContent: "flex-start" }}
          >
            <History size={15} />
            {showLog ? "Hide" : "Show"} every stretch ({segments.length})
          </button>

          {showLog && (
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              {[...segments]
                .sort((a, b) => a.started_at.localeCompare(b.started_at))
                .map((s) => {
                  const crew = [
                    ...new Set([...(s.started_by ?? []), ...(s.ended_by ?? [])]),
                  ];
                  return (
                    <div className={`seg-row ${s.kind}`} key={s.id}>
                      <span className={`seg-dot ${s.kind}`} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="seg-when mono">
                          {formatStamp(s.started_at)}
                          {" to "}
                          {s.ended_at ? formatStamp(s.ended_at) : "now"}
                        </div>
                        {crew.length > 0 && (
                          <div className="seg-who">
                            {crew.map(opName).join(", ")}
                          </div>
                        )}
                      </div>
                      <span className="badge">
                        {s.kind === "queue" ? "Queue" : "Process"}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {ofKind(segments, "queue").length === 0 &&
        ofKind(segments, "process").length === 0 && (
          <div className="hint">Nothing recorded for this one yet.</div>
        )}
    </div>
  );
}

/** Current state of a record, for showing in lists. */
export function liveState(segments: Segment[]): {
  label: string;
  tone: "queue" | "process" | "idle" | "done";
  since: string | null;
} {
  const oq = openSegment(segments, "queue");
  const op = openSegment(segments, "process");
  if (op) return { label: "In process", tone: "process", since: op.started_at };
  if (oq) return { label: "In queue", tone: "queue", since: oq.started_at };
  if (segments.length === 0)
    return { label: "Not started", tone: "idle", since: null };
  const last = [...segments].sort((a, b) =>
    (b.ended_at ?? "").localeCompare(a.ended_at ?? "")
  )[0];
  return { label: "Finished here", tone: "done", since: last?.ended_at ?? null };
}

export { CircleCheck };
