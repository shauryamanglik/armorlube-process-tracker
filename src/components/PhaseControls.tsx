"use client";

import { useEffect, useState } from "react";
import {
  CircleCheck,
  Cog,
  CornerUpLeft,
  History,
  Hourglass,
  Link2,
  LogIn,
  LogOut,
  Unlink,
} from "lucide-react";
import type { Operator, Segment } from "@/lib/types";
import { formatDuration, formatStamp } from "@/lib/time";
import {
  interruptions,
  ofKind,
  openSegment,
  rollup,
} from "@/lib/segments";
import { planAction, type Action } from "@/lib/segmentActions";
import { DEFAULT_RULES } from "@/lib/time";

type Props = {
  segments: Segment[];
  step: { has_queue: boolean; has_process: boolean };
  operators: Operator[];
  linked: boolean;
  onLinkChange: (v: boolean) => void;
  onPress: (a: Action) => void;
  disabled?: boolean;
  /** Set when the entry timestamp came from an upstream handoff. */
  arrivedFrom?: string | null;
};

export default function PhaseControls({
  segments,
  step,
  operators,
  linked,
  onLinkChange,
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

  const linkable = step.has_queue && step.has_process;
  const openQueue = openSegment(segments, "queue");
  const openProcess = openSegment(segments, "process");
  const q = rollup(segments, "queue", DEFAULT_RULES);
  const p = rollup(segments, "process", DEFAULT_RULES);
  const breaks = interruptions(segments);

  const opName = (id: string) =>
    operators.find((o) => o.id === id)?.name ?? "Unknown";

  function fire(a: Action) {
    const plan = planAction(segments, a, linked, step);
    if (plan.outOfOrder && armed !== a) {
      setArmed(a);
      return;
    }
    setArmed(null);
    onPress(a);
  }

  /** ready when it is the natural next press, waiting when it is not. */
  function stateOf(a: Action): "ready" | "waiting" {
    const plan = planAction(segments, a, linked, step);
    return plan.outOfOrder ? "waiting" : "ready";
  }

  function whyWaiting(a: Action): string {
    if (a === "queue_out") return "Nothing is queued right now";
    if (a === "process_in")
      return openProcess ? "Already running" : "Nothing queued yet";
    if (a === "process_out") return "Nothing is running right now";
    if (a === "queue_in") return "Already in the queue";
    return "";
  }

  const cards = [
    step.has_queue && {
      id: "queue" as const,
      name: "Queue",
      sub: "Waiting, including any time sent back",
      icon: <Hourglass size={17} />,
      roll: q,
      inAction: "queue_in" as Action,
      outAction: "queue_out" as Action,
    },
    step.has_process && {
      id: "process" as const,
      name: "Process",
      sub: "Work being done on it",
      icon: <Cog size={17} />,
      roll: p,
      inAction: "process_in" as Action,
      outAction: "process_out" as Action,
    },
  ].filter(Boolean) as {
    id: "queue" | "process";
    name: string;
    sub: string;
    icon: React.ReactNode;
    roll: ReturnType<typeof rollup>;
    inAction: Action;
    outAction: Action;
  }[];

  return (
    <div className="stack">
      <div className="phases">
        {cards.map((c, idx) => (
          <div key={c.id} style={{ display: "contents" }}>
            <section className={`phase ${c.id}`}>
              <div className="phase-head">
                <span className="phase-mark">{c.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="phase-name">
                    {c.name}
                    {c.roll.count > 1 && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        {c.roll.count} stretches
                      </span>
                    )}
                  </div>
                  <div className="phase-sub">{c.sub}</div>
                </div>
                {c.roll.count > 0 && (
                  <div className="phase-live">
                    <div className="n">{formatDuration(c.roll.businessMs)}</div>
                    <div className="l">
                      {c.roll.running ? "running" : "total"}
                    </div>
                  </div>
                )}
              </div>

              <div className="phase-body">
                {[c.inAction, c.outAction].map((a) => {
                  const isIn = a.endsWith("_in");
                  const mode = stateOf(a);
                  const isArmed = armed === a;
                  const open = isIn
                    ? c.id === "queue"
                      ? openQueue
                      : openProcess
                    : null;

                  return (
                    <button
                      key={a}
                      className={[
                        "tbtn",
                        isIn ? "in" : "out",
                        isArmed ? "armed" : mode,
                      ].join(" ")}
                      disabled={disabled}
                      onClick={() => fire(a)}
                    >
                      <span className="t-top">
                        {isIn ? <LogIn size={18} /> : <LogOut size={18} />}
                        {c.name} {isIn ? "in" : "out"}
                        {open && (
                          <span className="tick">
                            <CircleCheck size={16} />
                          </span>
                        )}
                      </span>
                      {isArmed ? (
                        <span className="t-val">
                          Out of order. Tap again to record it.
                        </span>
                      ) : open ? (
                        <>
                          <span className="t-val mono">
                            {formatStamp(open.started_at)}
                          </span>
                          {arrivedFrom && c.id === "queue" && (
                            <span className="arrived">
                              <CornerUpLeft size={12} />
                              Arrived from {arrivedFrom}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="t-val">
                          {mode === "ready" ? "Tap to record" : whyWaiting(a)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {linkable && idx === 0 && cards.length === 2 && (
              <div className={`link-strip ${linked ? "on" : ""}`}>
                <span className="link-line" />
                <button
                  className="link-toggle"
                  onClick={() => onLinkChange(!linked)}
                  aria-pressed={linked}
                >
                  {linked ? <Link2 size={14} /> : <Unlink size={14} />}
                  {linked ? "Queue out starts the process" : "Logged separately"}
                </button>
                <span className="link-line" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* sending it back mid job */}
      {openProcess && step.has_queue && (
        <button
          className="btn back-to-queue"
          disabled={disabled}
          onClick={() => fire("back_to_queue")}
        >
          <CornerUpLeft size={17} />
          Back to queue
          <span className="hint" style={{ marginLeft: 6 }}>
            stops the process timer, keeps everything logged
          </span>
        </button>
      )}

      {breaks > 0 && (
        <div className="lot-status repeat">
          <CornerUpLeft size={16} />
          <span>
            Sent back to queue {breaks} {breaks === 1 ? "time" : "times"}. All
            stretches are added together.
          </span>
        </div>
      )}

      {/* interval history */}
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
