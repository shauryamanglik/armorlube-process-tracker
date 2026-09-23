"use client";

import { CheckCircle2, CornerUpLeft } from "lucide-react";

/**
 * Stopping at the last step almost always means the work is done, so ending
 * is the obvious button. Sending it back for rework is still there, because
 * failing final inspection is a real thing that has to be recordable, but it
 * is deliberately the quieter of the two.
 */
export default function EndConfirm({
  reference,
  kind,
  stepName,
  busy,
  onEnd,
  onRework,
  onCancel,
}: {
  reference: string;
  kind: "lot" | "order";
  stepName: string;
  busy?: boolean;
  onEnd: () => void;
  /** Omitted when there is nowhere to send it back to. */
  onRework?: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal end-modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          Finished with <span className="mono">{reference}</span>?
        </h3>
        <p className="hint">
          Work at {stepName} has stopped. Ending closes the {kind} for good and
          takes it off the board.
        </p>

        <button className="end-btn primary" disabled={busy} onClick={onEnd}>
          <CheckCircle2 size={24} />
          <span>
            <span className="end-main">End the {kind}</span>
            <span className="end-sub">Complete, nothing more to do</span>
          </span>
        </button>

        {onRework && (
          <button className="end-btn quiet" disabled={busy} onClick={onRework}>
            <CornerUpLeft size={22} />
            <span>
              <span className="end-main">Send back for rework</span>
              <span className="end-sub">Choose a step to return it to</span>
            </span>
          </button>
        )}

        <button className="btn ghost" onClick={onCancel} style={{ marginTop: 4 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
