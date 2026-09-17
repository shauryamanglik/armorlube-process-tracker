"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  CornerUpLeft,
  Hand,
  SkipForward,
  Wind,
} from "lucide-react";
import type { BlastType, Step } from "@/lib/types";
import { entryField, FIELD_LABEL, lotSteps } from "@/lib/types";

export type RouteChoice = {
  target: Step;
  blastType: BlastType | null;
  rework: boolean;
};

type Props = {
  lotId: string;
  from: Step;
  steps: Step[];
  stamp: string;
  onHold: () => void;
  onConfirm: (choice: RouteChoice) => void;
  busy?: boolean;
};

export default function RouteDialog({
  lotId,
  from,
  steps,
  stamp,
  onHold,
  onConfirm,
  busy,
}: Props) {
  const ordered = useMemo(() => lotSteps(steps), [steps]);

  const nextStep = useMemo(
    () => ordered.find((s) => s.sort_order > from.sort_order) ?? null,
    [ordered, from]
  );

  const [targetId, setTargetId] = useState(nextStep?.id ?? "");
  const [blast, setBlast] = useState<BlastType | "defer">("defer");

  const target = ordered.find((s) => s.id === targetId) ?? null;
  const rework = target ? target.sort_order <= from.sort_order : false;
  const skipped = target
    ? ordered.filter(
        (s) => s.sort_order > from.sort_order && s.sort_order < target.sort_order
      )
    : [];

  const entry = target ? entryField(target) : null;

  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3>Where does lot {lotId} go next?</h3>
          <p className="hint" style={{ marginTop: 4 }}>
            It left {from.step_name} at{" "}
            <span className="mono">{stamp}</span>. The next step starts counting
            from that same moment.
          </p>
        </div>

        <div className="route-list">
          {ordered.map((s) => {
            const isNext = nextStep?.id === s.id;
            const isBack = s.sort_order <= from.sort_order;
            const isSelf = s.id === from.id;
            return (
              <button
                key={s.id}
                className="route-row"
                aria-pressed={targetId === s.id}
                onClick={() => setTargetId(s.id)}
              >
                <span className="r-order mono">{s.sort_order}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="r-name">{s.step_name}</span>
                  <span className="r-area">{s.area}</span>
                </span>
                {isNext && (
                  <span className="badge info">
                    <ArrowRight size={12} />
                    Next
                  </span>
                )}
                {isBack && !isSelf && (
                  <span className="badge warn">
                    <CornerUpLeft size={12} />
                    Rework
                  </span>
                )}
                {isSelf && (
                  <span className="badge warn">
                    <CornerUpLeft size={12} />
                    Run again
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {skipped.length > 0 && (
          <div className="lot-status repeat">
            <SkipForward size={16} />
            <span>
              Skipping {skipped.map((s) => s.step_name).join(", ")}. No record is
              created for {skipped.length === 1 ? "it" : "them"}.
            </span>
          </div>
        )}

        {rework && (
          <div className="lot-status repeat">
            <CornerUpLeft size={16} />
            <span>
              This sends the lot backward, so it opens a new pass. The original
              run stays intact and the rework time is measured separately.
            </span>
          </div>
        )}

        {target?.has_blast_type && (
          <div>
            <span className="field-label">
              <Wind size={14} />
              Blast type for {target.step_name}
            </span>
            <div className="chips">
              {(["Manual Blasting", "Auto Blasting"] as BlastType[]).map((b) => (
                <button
                  key={b}
                  className="chip"
                  aria-pressed={blast === b}
                  onClick={() => setBlast(b)}
                >
                  {b}
                </button>
              ))}
              <button
                className="chip"
                aria-pressed={blast === "defer"}
                onClick={() => setBlast("defer")}
              >
                Decide at Blasting
              </button>
            </div>
            {blast === "defer" && (
              <p className="hint" style={{ marginTop: 8 }}>
                The blasting operator will be asked before they log process in.
              </p>
            )}
          </div>
        )}

        {target && entry && (
          <div className="lot-status known">
            <CircleCheck size={16} />
            <span>
              {FIELD_LABEL[entry]} will be recorded at {target.step_name} for this
              lot.
            </span>
          </div>
        )}

        <div className="row">
          <button
            className="btn primary"
            disabled={!target || busy}
            onClick={() =>
              target &&
              onConfirm({
                target,
                blastType:
                  target.has_blast_type && blast !== "defer" ? blast : null,
                rework,
              })
            }
          >
            <ArrowRight size={16} />
            {busy ? "Sending" : `Send to ${target?.step_name ?? ""}`}
          </button>
          <button className="btn ghost" disabled={busy} onClick={onHold}>
            <Hand size={16} />
            Hold here for now
          </button>
        </div>

        <p className="hint" style={{ margin: 0 }}>
          Holding leaves the lot on the line without starting the next step. Any
          station can pick it up later.
        </p>
      </div>
    </div>
  );
}
