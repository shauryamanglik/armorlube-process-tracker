"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Bucket, TrendPoint } from "@/lib/analytics";
import { formatDuration, toHours } from "@/lib/time";

const AXIS = { stroke: "#6b7886", fontSize: 11 };
const GRID = "#252e39";

const TOOLTIP_STYLE = {
  background: "#212934",
  border: "1px solid #313c4a",
  borderRadius: 10,
  fontSize: 13,
  color: "#e9eef4",
};

/**
 * Recharts types the formatter value loosely, so this takes unknown and
 * coerces. Keeps the component compatible across recharts versions.
 */
function hoursTip(value: unknown): string {
  const n = Number(value);
  return formatDuration(isFinite(n) ? n * 3600000 : 0);
}

export function StepBars({
  buckets,
  metric,
}: {
  buckets: Bucket[];
  metric: "queueAvg" | "processAvg" | "totalAvg";
}) {
  const data = buckets.map((b) => ({
    name: b.label,
    value: toHours(b[metric]),
    count: b.count,
  }));

  const color =
    metric === "queueAvg" ? "#f0a92e" : metric === "processAvg" ? "#2fbf71" : "#4c8df6";

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 54 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS}
          angle={-32}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis tick={AXIS} unit="h" />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(v: unknown) => [hoursTip(v), "Average"]}
        />
        <Bar dataKey="value" radius={[5, 5, 0, 0]} fill={color} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SplitBars({ buckets }: { buckets: Bucket[] }) {
  const data = buckets.map((b) => ({
    name: b.label,
    Queue: toHours(b.queueAvg),
    Process: toHours(b.processAvg),
  }));

  return (
    <ResponsiveContainer width="100%" height={330}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 54 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS}
          angle={-32}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis tick={AXIS} unit="h" />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(v: unknown, n: unknown) => [hoursTip(v), String(n)]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#9aa8b8" }} />
        <Bar dataKey="Queue" stackId="a" fill="#f0a92e" />
        <Bar dataKey="Process" stackId="a" fill="#2fbf71" radius={[5, 5, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LoadBars({ buckets }: { buckets: Bucket[] }) {
  const data = buckets.map((b) => ({
    name: b.label,
    value: toHours(b.queueTotal + b.processTotal),
    flagged: b.flaggedCount,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 54 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS}
          angle={-32}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis tick={AXIS} unit="h" />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={(v: unknown) => [hoursTip(v), "Total logged"]}
        />
        <Bar dataKey="value" radius={[5, 5, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.flagged > 0 ? "#9b7bf0" : "#4c8df6"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Trend({ points }: { points: TrendPoint[] }) {
  const data = points.map((p) => ({
    date: p.date.slice(5),
    Queue: toHours(p.queue),
    Process: toHours(p.process),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 6, right: 12, left: -18, bottom: 6 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tick={AXIS} />
        <YAxis tick={AXIS} unit="h" />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v: unknown, n: unknown) => [hoursTip(v), String(n)]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#9aa8b8" }} />
        <Line
          type="monotone"
          dataKey="Queue"
          stroke="#f0a92e"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="Process"
          stroke="#2fbf71"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
