"use client";

import { useEffect, useState } from "react";
import { Boxes, FileText, HardHat, SlidersHorizontal } from "lucide-react";
import type { ActiveLot, Operator, Step } from "@/lib/types";
import StepPanel from "./StepPanel";
import PoPanel from "./PoPanel";
import OperatorPanel from "./OperatorPanel";
import OperatorPoPanel from "./OperatorPoPanel";

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

const VIEW_KEY = "apt.view.v1";

/**
 * Two ways to see a station.
 *
 * Operator is the default and the one the floor uses: a name, a lot, and
 * three buttons on one row, sized so nothing needs scrolling on an iPad held
 * landscape. Admin keeps everything, for corrections and detail.
 */
export default function StationPanel(props: Props) {
  const [view, setView] = useState<"operator" | "admin">("operator");
  const [tab, setTab] = useState<"lots" | "pos">(
    props.step.release_only ? "pos" : "lots"
  );

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === "admin" || saved === "operator") setView(saved);
  }, []);

  function choose(v: "operator" | "admin") {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  }

  const toggle = (
    <div className="view-toggle">
      <button
        aria-pressed={view === "operator"}
        onClick={() => choose("operator")}
      >
        <HardHat size={15} />
        Operator
      </button>
      <button aria-pressed={view === "admin"} onClick={() => choose("admin")}>
        <SlidersHorizontal size={15} />
        Admin
      </button>
    </div>
  );

  const showsPo = props.step.tracks_po;
  const showsLots = props.step.tracks_lots !== false;

  const tabs = showsPo && showsLots && (
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
  );

  const which = !showsLots ? "pos" : !showsPo ? "lots" : tab;

  if (view === "operator") {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="row">
          {tabs}
          <div className="spacer" />
          {toggle}
        </div>
        {which === "lots" ? (
          <OperatorPanel
            step={props.step}
            allSteps={props.allSteps}
            operators={props.operators}
            lots={props.lots}
            onLotsChanged={props.onLotsChanged}
            onToast={props.onToast}
          />
        ) : (
          <OperatorPoPanel
            step={props.step}
            operators={props.operators}
            onToast={props.onToast}
          />
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        {tabs}
        <div className="spacer" />
        {toggle}
      </div>
      {which === "lots" ? (
        <StepPanel {...props} />
      ) : (
        <PoPanel
          step={props.step}
          allSteps={props.allSteps}
          operators={props.operators}
          onOperatorsChanged={props.onOperatorsChanged}
          onToast={props.onToast}
        />
      )}
    </div>
  );
}
