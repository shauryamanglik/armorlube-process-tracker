"use client";

import { useState } from "react";
import { Boxes, FileText } from "lucide-react";
import type { ActiveLot, Operator, Step } from "@/lib/types";
import StepPanel from "./StepPanel";
import PoPanel from "./PoPanel";

type Props = {
  step: Step;
  allSteps: Step[];
  operators: Operator[];
  lots: ActiveLot[];
  onOperatorsChanged: () => void;
  onLotsChanged: () => void;
  compact?: boolean;
  onToast: (m: string) => void;
};

/**
 * Incoming and final inspection handle boxes and paperwork against a purchase
 * order as well as running lots down the line, so those two stations get a
 * second tab. Every other station goes straight to lot logging.
 */
export default function StationPanel(props: Props) {
  const [tab, setTab] = useState<"lots" | "pos">(
    props.step.release_only ? "pos" : "lots"
  );

  const lots = props.step.tracks_lots !== false;
  const pos = Boolean(props.step.tracks_po);

  // Oil and shipping handles purchase orders only, because by then the lot
  // has been split up and no longer exists as one thing.
  if (pos && !lots) {
    return (
      <PoPanel
        step={props.step}
        operators={props.operators}
        onOperatorsChanged={props.onOperatorsChanged}
        onToast={props.onToast}
      />
    );
  }

  if (!pos) {
    return <StepPanel {...props} />;
  }

  return (
    <div className="stack">
      <div className="station-tabs">
        <button aria-pressed={tab === "lots"} onClick={() => setTab("lots")}>
          <Boxes size={16} />
          Lots
        </button>
        <button aria-pressed={tab === "pos"} onClick={() => setTab("pos")}>
          <FileText size={16} />
          Purchase orders
        </button>
      </div>

      {tab === "lots" ? (
        <StepPanel {...props} />
      ) : (
        <PoPanel
          step={props.step}
          operators={props.operators}
          onOperatorsChanged={props.onOperatorsChanged}
          onToast={props.onToast}
        />
      )}
    </div>
  );
}
