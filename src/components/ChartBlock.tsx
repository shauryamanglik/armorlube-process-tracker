"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayRow } from "@/lib/analytics";
import { formatDuration } from "@/lib/time";

const AXIS = { stroke: "#6b7886", fontSize: 11 };
const GRID = "#252e39";
const TOOLTIP = {
  background: "#212934",
  border: "1px solid #313c4a",
  borderRadius: 10,
  fontSize: 13,
  color: "#e9eef4",
};

/** Distinct enough to tell eight steps apart on one chart. */
export const SERIES_COLORS = [
  "#4c8df6",
  "#2fbf71",
  "#f0a92e",
  "#9b7bf0",
  "#e5484d",
  "#37c2c9",
  "#e87fc4",
  "#a6b64a",
];

function hoursTip(v: unknown): string {
  const n = Number(v);
  return formatDuration(isFinite(n) ? n * 3600000 : 0);
}

/**
 * Every chart on the dashboard sits in one of these, so each has a plain
 * explanation of what it shows and can be flipped to a table of the same
 * numbers rather than being read off a graph.
 */
export function ChartBlock({
  title,
  description,
  children,
  rows,
  columns,
  controls,
  unit = "hours",
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  rows: DayRow[];
  columns: string[];
  controls?: React.ReactNode;
  unit?: "hours" | "count";
}) {
  const [view, setView] = useState<"graph" | "table">("graph");

  return (
    <section className="chart-block">
      <div className="chart-head">
        <h2>{title}</h2>
        <div className="view-switch">
          <button
            aria-pressed={view === "graph"}
            onClick={() => setView("graph")}
          >
            <BarChart3 size={14} />
            Graph
          </button>
          <button
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <Table2 size={14} />
            Table
          </button>
        </div>
      </div>

      <p className="chart-desc">{description}</p>

      {controls && <div className="metric-row">{controls}</div>}

      {rows.length === 0 ? (
        <div className="empty">Nothing in this range yet.</div>
      ) : view === "graph" ? (
        children
      ) : (
        <div className="table-wrap scroll-y" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>{columns.length && rows[0]?.date ? "Day" : "Item"}</th>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.date}</td>
                  {columns.map((c) => {
                    const v = Number(r[c] ?? 0);
                    return (
                      <td key={c} className="mono">
                        {v === 0
                          ? ""
                          : unit === "hours"
                          ? `${v.toFixed(2)} h`
                          : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One line per series across days. */
export function DayLines({
  data,
  series,
  unit = "h",
}: {
  data: DayRow[];
  series: string[];
  unit?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={330}>
      <LineChart data={data} margin={{ top: 6, right: 14, left: -16, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} />
        <YAxis tick={AXIS} unit={unit} />
        <Tooltip
          contentStyle={TOOLTIP}
          formatter={(v: unknown, n: unknown) =>
            unit === "h" ? [hoursTip(v), String(n)] : [String(v), String(n)]
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#9aa8b8" }} />
        {series.map((s, i) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Grouped or stacked bars across days. */
export function DayBars({
  data,
  series,
  stacked,
  unit = "h",
}: {
  data: DayRow[];
  series: string[];
  stacked?: boolean;
  unit?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={330}>
      <BarChart data={data} margin={{ top: 6, right: 14, left: -16, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} />
        <YAxis tick={AXIS} unit={unit} />
        <Tooltip
          contentStyle={TOOLTIP}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(v: unknown, n: unknown) =>
            unit === "h" ? [hoursTip(v), String(n)] : [String(v), String(n)]
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#9aa8b8" }} />
        {series.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            stackId={stacked ? "a" : undefined}
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            radius={stacked && i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
