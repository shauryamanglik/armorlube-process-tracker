"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Plus,
  Cog,
  CornerUpLeft,
  Hourglass,
  Pencil,
  SkipForward,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { Enriched, EnrichedPo, LotStatus, PoStatus } from "@/lib/analytics";
import { warningsFor } from "@/lib/analytics";
import { formatDuration, formatStamp } from "@/lib/time";
import type { Operator, Segment } from "@/lib/types";

type Common = {
  operators: Operator[];
  onClose: () => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
};

function crewNames(s: Segment, ops: Operator[]): string {
  const ids = [...new Set([...(s.started_by ?? []), ...(s.ended_by ?? [])])];
  return ids
    .map((id) => ops.find((o) => o.id === id)?.name)
    .filter(Boolean)
    .join(", ");
}

function Stretches({
  segments,
  operators,
}: {
  segments: Segment[];
  operators: Operator[];
}) {
  if (segments.length === 0)
    return <div className="hint">No stretches recorded.</div>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {[...segments]
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .map((s) => {
          const ms = s.ended_at
            ? new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()
            : Date.now() - new Date(s.started_at).getTime();
          return (
            <div className={`seg-row ${s.kind}`} key={s.id}>
              <span className={`seg-dot ${s.kind}`} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="seg-when mono">
                  {formatStamp(s.started_at)} to{" "}
                  {s.ended_at ? formatStamp(s.ended_at) : "now"}
                </div>
                <div className="seg-who">
                  {crewNames(s, operators) || "No crew recorded"}
                </div>
              </div>
              <span className="badge">{formatDuration(ms)}</span>
              <span className={`state-pill ${s.kind}`}>
                {s.kind === "queue" ? <Hourglass size={12} /> : <Cog size={12} />}
                {s.kind === "queue" ? "Queue" : "Process"}
              </span>
            </div>
          );
        })}
    </div>
  );
}

function RecordCard({
  title,
  area,
  date,
  segments,
  queueMs,
  processMs,
  warnings,
  operators,
  deleted,
  onEdit,
  onDelete,
  onRestore,
  extra,
}: {
  title: string;
  area?: string;
  date: string;
  segments: Segment[];
  queueMs: number;
  processMs: number;
  warnings: string[];
  operators: Operator[];
  deleted?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className={`detail-card ${deleted ? "deleted" : ""}`}>
      <div className="row" style={{ marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <div className="hint">
            {area ? `${area} · ` : ""}
            {date}
          </div>
        </div>
        <div className="spacer" />
        <span className="badge warn">{formatDuration(queueMs)} queue</span>
        <span className="badge info">{formatDuration(processMs)} process</span>
        {onEdit && (
          <button className="btn sm icon ghost" onClick={onEdit} aria-label="Edit">
            <Pencil size={14} />
          </button>
        )}
        {deleted
          ? onRestore && (
              <button className="btn sm ghost" onClick={onRestore}>
                <Undo2 size={14} />
                Restore
              </button>
            )
          : onDelete && (
              <button
                className="btn sm icon danger"
                onClick={onDelete}
                aria-label="Delete"
              >
                <Trash2 size={14} />
              </button>
            )}
      </div>

      {extra}

      {warnings.length > 0 && (
        <div className="stack" style={{ gap: 5, margin: "8px 0 10px" }}>
          {warnings.map((w) => (
            <div className="warn-line" key={w}>
              <AlertTriangle size={13} />
              {w}
            </div>
          ))}
        </div>
      )}

      <Stretches segments={segments} operators={operators} />
    </div>
  );
}

/** Everything known about one lot. */
export function LotDetail({
  status,
  operators,
  steps,
  onClose,
  onEdit,
  onDelete,
  onRestore,
  onAddStep,
  priority,
}: Common & {
  status: LotStatus;
  /** Every step a lot can be recorded at. */
  steps?: { id: string; step_name: string }[];
  /** Fill in a step the lot passed over, or add one anywhere. */
  onAddStep?: (lot: string, stepName: string, pass: number) => void;
  /** Due date, hot and order, for a lot already on the line. */
  priority?: React.ReactNode;
}) {
  const [addStep, setAddStep] = useState("");

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="modal wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row detail-head">
          <div style={{ minWidth: 0 }}>
            <h3 className="mono">{status.lot}</h3>
            <div className="hint">
              {status.live
                ? `At ${status.step}${status.area ? `, ${status.area}` : ""}`
                : "Completed and off the line"}
            </div>
          </div>
          <div className="spacer" />
          <span className={`state-pill ${status.live ? "queue" : "done"}`}>
            {status.live ? status.state : "Completed"}
          </span>
          <button className="btn sm icon ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div className="grid-4">
          <div className="stat">
            <div className="k">Queue total</div>
            <div className="v">{formatDuration(status.queueMs)}</div>
          </div>
          <div className="stat">
            <div className="k">Process total</div>
            <div className="v">{formatDuration(status.processMs)}</div>
          </div>
          <div className="stat">
            <div className="k">Steps logged</div>
            <div className="v">{status.records.length}</div>
          </div>
          <div className="stat">
            <div className="k">Pass</div>
            <div className="v">{status.pass}</div>
            {status.pass > 1 && <div className="hint">Reworked</div>}
          </div>
        </div>

        {status.since && (
          <div className="hint">
            {status.state} since{" "}
            <span className="mono">{formatStamp(status.since)}</span>
          </div>
        )}

        {priority && <div className="drawer-prio">{priority}</div>}

        {status.skipped.length > 0 && (
          <>
            <div className="lot-status repeat">
              <SkipForward size={16} />
              <span>
                Passed over <strong>{status.skipped.join(", ")}</strong>. Worked
                out from gaps in the route, so it may also mean a missed log
                rather than a deliberate skip. Add one below if it was worked but
                never logged.
              </span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {status.skipped.map((name) => (
                <div className="skip-row" key={name}>
                  <SkipForward size={15} color="#f0a92e" />
                  <span className="s-name">{name}</span>
                  <div className="spacer" />
                  {onAddStep && (
                    <button
                      className="btn sm"
                      onClick={() => onAddStep(status.lot, name, status.pass)}
                    >
                      <Plus size={14} />
                      Add this step
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {status.interruptions > 0 && (
          <div className="lot-status repeat">
            <CornerUpLeft size={16} />
            <span>
              Sent back to queue {status.interruptions}{" "}
              {status.interruptions === 1 ? "time" : "times"} across all steps.
            </span>
          </div>
        )}

        <div className="divider" />
        <strong style={{ fontSize: 14 }}>Every step, in order</strong>

        {status.records.map((r) => (
          <RecordCard
            key={r.log.id}
            title={r.step?.step_name ?? "Unknown step"}
            area={r.step?.area}
            date={r.log.log_date}
            segments={r.segments}
            queueMs={r.queueMs}
            processMs={r.processMs}
            warnings={warningsFor(r)}
            operators={operators}
            deleted={Boolean(r.log.deleted_at)}
            onEdit={onEdit ? () => onEdit(r.log.id) : undefined}
            onDelete={onDelete ? () => onDelete(r.log.id) : undefined}
            onRestore={onRestore ? () => onRestore(r.log.id) : undefined}
            extra={
              r.log.blast_type ? (
                <span className="badge">{r.log.blast_type}</span>
              ) : null
            }
          />
        ))}

        {onAddStep && steps && steps.length > 0 && (
          <div className="add-anywhere">
            <span className="field-label" style={{ margin: 0 }}>
              <Plus size={14} />
              Add a record at any step
            </span>
            <p className="hint" style={{ margin: "4px 0 10px" }}>
              For work that happened but was never logged, or a second visit to
              a step. Put in the times as they actually happened.
            </p>
            <div className="row">
              <select
                className="select"
                style={{ flex: 1 }}
                value={addStep}
                onChange={(e) => setAddStep(e.target.value)}
              >
                <option value="">Choose a step</option>
                {steps.map((st) => (
                  <option key={st.id} value={st.step_name}>
                    {st.step_name}
                  </option>
                ))}
              </select>
              <button
                className="btn primary"
                disabled={!addStep}
                onClick={() => {
                  onAddStep(status.lot, addStep, status.pass);
                  setAddStep("");
                }}
              >
                <Plus size={16} />
                Add record
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Everything known about one purchase order. */
export function PoDetail({
  status,
  operators,
  stations,
  onClose,
  onEdit,
  onDelete,
  onRestore,
  onAddStation,
  priority,
}: Common & {
  status: PoStatus;
  /** Every station that handles purchase orders, in order. */
  stations?: { id: string; step_name: string }[];
  /** Add a station this order was never logged at. */
  onAddStation?: (po: string, stepName: string) => void;
  priority?: React.ReactNode;
}) {
  const [addStation, setAddStation] = useState("");
  const seen = new Set(status.records.map((r) => r.step?.step_name));
  const notLogged = (stations ?? []).filter((s) => !seen.has(s.step_name));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="row detail-head">
          <div style={{ minWidth: 0 }}>
            <h3 className="mono">{status.po}</h3>
            <div className="hint">
              {status.live ? `At ${status.station}` : "All stations finished"}
            </div>
          </div>
          <div className="spacer" />
          <span className={`state-pill ${status.live ? "queue" : "done"}`}>
            {status.live ? status.state : "Completed"}
          </span>
          <button className="btn sm icon ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div className="grid-4">
          <div className="stat">
            <div className="k">Queue total</div>
            <div className="v">{formatDuration(status.queueMs)}</div>
          </div>
          <div className="stat">
            <div className="k">Process total</div>
            <div className="v">{formatDuration(status.processMs)}</div>
          </div>
          <div className="stat">
            <div className="k">Labour</div>
            <div className="v">{formatDuration(status.labourMs)}</div>
          </div>
          <div className="stat">
            <div className="k">Stations</div>
            <div className="v">{status.records.length}</div>
          </div>
        </div>

        {status.since && (
          <div className="hint">
            {status.state} since{" "}
            <span className="mono">{formatStamp(status.since)}</span>
          </div>
        )}

        {priority && <div className="drawer-prio">{priority}</div>}

        {priority && <div className="drawer-prio">{priority}</div>}

        {status.skipped.length > 0 && (
          <div className="lot-status repeat">
            <SkipForward size={16} />
            <span>
              Reached a station without being logged at{" "}
              <strong>{status.skipped.join(", ")}</strong> first.
            </span>
          </div>
        )}

        <div className="divider" />
        <strong style={{ fontSize: 14 }}>Every station</strong>

        {status.records.map((r) => (
          <RecordCard
            key={r.po.id}
            title={r.step?.step_name ?? "Unknown station"}
            date={r.po.log_date}
            segments={r.segments}
            queueMs={r.queueMs}
            processMs={r.processMs}
            warnings={poWarnings(r)}
            operators={operators}
            deleted={Boolean(r.po.deleted_at)}
            onEdit={onEdit ? () => onEdit(r.po.id) : undefined}
            onDelete={onDelete ? () => onDelete(r.po.id) : undefined}
            onRestore={onRestore ? () => onRestore(r.po.id) : undefined}
          />
        ))}

        {onAddStation && stations && stations.length > 0 && (
          <div className="add-anywhere">
            <span className="field-label" style={{ margin: 0 }}>
              <Plus size={14} />
              Add a record at any station
            </span>
            <p className="hint" style={{ margin: "4px 0 10px" }}>
              For work that happened but was never logged, or a second visit.
            </p>
            <div className="row">
              <select
                className="select"
                style={{ flex: 1 }}
                value={addStation}
                onChange={(e) => setAddStation(e.target.value)}
              >
                <option value="">Choose a station</option>
                {stations.map((st) => (
                  <option key={st.id} value={st.step_name}>
                    {st.step_name}
                  </option>
                ))}
              </select>
              <button
                className="btn primary"
                disabled={!addStation}
                onClick={() => {
                  onAddStation(status.po, addStation);
                  setAddStation("");
                }}
              >
                <Plus size={16} />
                Add record
              </button>
            </div>
          </div>
        )}

        {notLogged.length > 0 && (
          <>
            <div className="hint">
              Not logged at{" "}
              {notLogged.length === 1 ? "this station" : "these stations"} yet.
              Add one only if the work happened but was never recorded.
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {notLogged.map((st) => (
                <div className="skip-row" key={st.id}>
                  <SkipForward size={15} color="#f0a92e" />
                  <span className="s-name">{st.step_name}</span>
                  <div className="spacer" />
                  {onAddStation && (
                    <button
                      className="btn sm"
                      onClick={() => onAddStation(status.po, st.step_name)}
                    >
                      <Plus size={14} />
                      Add this station
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function poWarnings(r: EnrichedPo): string[] {
  const out: string[] = [];
  if (r.running) out.push("A timer is still running on this record");
  if (r.interruptions > 0)
    out.push(
      `Sent back to queue ${r.interruptions} ${
        r.interruptions === 1 ? "time" : "times"
      }`
    );
  if (r.po.deleted_at) out.push("This record was deleted");
  if (r.segments.length === 0) out.push("Nothing was ever recorded here");
  return out;
}

export type { Enriched };
