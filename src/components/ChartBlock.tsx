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

const AXIS = {
  stroke: "#7b8796",
  fontSize: 11.5,
  fontFamily: "var(--font-sans)",
};
const GRID = "#222b35";
const TOOLTIP = {
  background: "#1b222b",
  border: "1px solid #39434f",
  borderRadius: 10,
  fontSize: 13,
  color: "#e9eef4",
  padding: "10px 12px",
  boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
};
const TOOLTIP_LABEL = { color: "#9aa8b8", marginBottom: 6, fontWeight: 600 };
const LEGEND = {
  fontSize: 12,
  color: "#9aa8b8",
  paddingTop: 10,
};
/** Axis lines add noise without adding information, so they are dropped. */
const AXIS_LINE = { axisLine: false, tickLine: false, tickMargin: 9 };

/** Distinct enough to tell eight steps apart on one chart. */
export const SERIES_COLORS = [
  "#5b95f7",
  "#3ac585",
  "#f2b03f",
  "#a488f2",
  "#ec5a5f",
  "#3fc9d0",
  "#ef8ecb",
  "#b0c055",
];

/** Queue is amber, process is blue, everywhere. */
export const QUEUE_COLOR = "#f0a92e";
export const PROCESS_COLOR = "#4c8df6";

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
  height = 330,
}: {
  data: DayRow[];
  series: string[];
  unit?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 14, left: -10, bottom: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="2 5" />
        <XAxis dataKey="date" tick={AXIS} {...AXIS_LINE} />
        <YAxis tick={AXIS} unit={unit} {...AXIS_LINE} width={54} />
        <Tooltip
          contentStyle={TOOLTIP}
          labelStyle={TOOLTIP_LABEL}
          cursor={{ stroke: "#3a4552", strokeWidth: 1 }}
          formatter={(v: unknown, n: unknown) =>
            unit === "h" ? [hoursTip(v), String(n)] : [String(v), String(n)]
          }
        />
        <Legend wrapperStyle={LEGEND} iconType="circle" iconSize={8} />
        {series.map((s, i) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2.2}
            dot={{ r: 2.5, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#11151a" }}
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
  angled,
  height = 330,
}: {
  data: DayRow[];
  series: string[];
  stacked?: boolean;
  unit?: string;
  /** Turn long category labels so they stay readable. */
  angled?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 14, left: -10, bottom: 4 }}
        barGap={3}
        barCategoryGap="22%"
      >
        <CartesianGrid stroke={GRID} vertical={false} strokeDasharray="2 5" />
        <XAxis
          dataKey="date"
          tick={AXIS}
          {...AXIS_LINE}
          angle={angled ? -30 : 0}
          textAnchor={angled ? "end" : "middle"}
          height={angled ? 78 : 30}
          interval={0}
        />
        <YAxis tick={AXIS} unit={unit} {...AXIS_LINE} width={54} />
        <Tooltip
          contentStyle={TOOLTIP}
          labelStyle={TOOLTIP_LABEL}
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
          formatter={(v: unknown, n: unknown) =>
            unit === "h" ? [hoursTip(v), String(n)] : [String(v), String(n)]
          }
        />
        <Legend wrapperStyle={LEGEND} iconType="circle" iconSize={8} />
        {series.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            stackId={stacked ? "a" : undefined}
            fill={SERIES_COLORS[i % SERIES_COLORS.length]}
            maxBarSize={54}
            radius={
              !stacked || i === series.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]
            }
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}


/**
 * Queue against process, where the two always take the same colours no matter
 * which chart they appear in. Used for comparisons rather than time series.
 */
export function PairBars({
  data,
  stacked,
  angled,
  height = 320,
  unit = "h",
  series = ["Queue", "Process"],
}: {
  data: DayRow[];
  stacked?: boolean;
  angled?: boolean;
  height?: number;
  unit?: string;
  series?: string[];
}) {
  const colors =
    series[0] === "Queue"
      ? [QUEUE_COLOR, PROCESS_COLOR]
      : [SERIES_COLORS[2], SERIES_COLORS[0]];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 14, left: -10, bottom: 4 }}
        barGap={3}
        barCategoryGap="24%"
      >
        <CartesianGrid stroke="#222b35" vertical={false} strokeDasharray="2 5" />
        <XAxis
          dataKey="date"
          tick={{ stroke: "#7b8796", fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
          tickMargin={9}
          angle={angled ? -30 : 0}
          textAnchor={angled ? "end" : "middle"}
          height={angled ? 86 : 30}
          interval={0}
        />
        <YAxis
          tick={{ stroke: "#7b8796", fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
          tickMargin={9}
          width={54}
          unit={unit}
        />
        <Tooltip
          contentStyle={{
            background: "#1b222b",
            border: "1px solid #39434f",
            borderRadius: 10,
            fontSize: 13,
            color: "#e9eef4",
            padding: "10px 12px",
          }}
          labelStyle={{ color: "#9aa8b8", marginBottom: 6, fontWeight: 600 }}
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
          formatter={(v: unknown, n: unknown) =>
            unit === "h" ? [hoursTip(v), String(n)] : [`${v}${unit}`, String(n)]
          }
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#9aa8b8", paddingTop: 10 }}
          iconType="circle"
          iconSize={8}
        />
        {series.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            stackId={stacked ? "a" : undefined}
            fill={colors[i % colors.length]}
            maxBarSize={54}
            radius={
              !stacked || i === series.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]
            }
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
