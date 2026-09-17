"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  ListOrdered,
  Lock,
  LogIn,
  RefreshCw,
  Settings as SettingsIcon,
  Timer,
  TriangleAlert,
  Users,
} from "lucide-react";
import {
  bucketBy,
  dailySeries,
  dailySeriesPo,
  dailySplit,
  enrich,
  enrichPos,
  blastComparison,
  byWeekday,
  interruptionsByStep,
  METRIC_LABEL,
  operatorHours,
  poByStation,
  poThroughputByDay,
  poWaitShare,
  slowestLots,
  slowestPos,
  waitShare,
  summarisePos,
  throughputByDay,
  toPoCsv,
  type Aggregate,
  type Metric,
  reworkCount,
  skippedSteps,
  summariseLots,
  toCsv,
  trendByDay,
  type Enriched,
} from "@/lib/analytics";
import { DEFAULT_RULES, formatDuration, toHours } from "@/lib/time";
import { crewOf } from "@/lib/segments";
import { liveSteps } from "@/lib/types";
import type {
  LogRow,
  Operator,
  PoLog,
  Segment,
  Step,
  WorkRules,
} from "@/lib/types";
import { LoadBars, SplitBars, StepBars, Trend } from "@/components/Charts";
import { ChartBlock, DayBars, DayLines, PairBars } from "@/components/ChartBlock";
import { buildWorkbook, downloadWorkbook } from "@/lib/excel";

const KEY_STORE = "apt.key.v1";

type Payload = {
  logs: LogRow[];
  poLogs: PoLog[];
  segments: Segment[];
  steps: Step[];
  operators: Operator[];
  rules: WorkRules | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // filters
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [area, setArea] = useState("");
  const [stepId, setStepId] = useState("");
  const [operator, setOperator] = useState("");
  const [lotSearch, setLotSearch] = useState("");
  const [blast, setBlast] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [hideIncomplete, setHideIncomplete] = useState(false);
  const [includeOffShift, setIncludeOffShift] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  const [tab, setTab] = useState<
    "charts" | "raw" | "lots" | "pos" | "settings"
  >("charts");
  /** Elapsed time is the headline. Labour hours are opt in. */
  const [labourView, setLabourView] = useState(false);
  /** Which measure the day by day charts plot, and how a day is summarised. */
  const [metric, setMetric] = useState<Metric>("total");
  const [agg, setAgg] = useState<Aggregate>("avg");

  useEffect(() => {
    const saved = sessionStorage.getItem(KEY_STORE);
    if (saved) setKey(saved);
  }, []);

  const load = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/analytics?from=${from}&to=${to}&deleted=${showDeleted ? 1 : 0}`,
        { headers: { "x-apt-key": key } }
      );
      if (res.status === 401) {
        sessionStorage.removeItem(KEY_STORE);
        setKey(null);
        return;
      }
      if (!res.ok) throw new Error("Request failed");
      setData((await res.json()) as Payload);
    } catch {
      setLoadError("Could not load the data. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [key, from, to, showDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  async function signIn() {
    setChecking(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const body = await res.json();
      if (!res.ok) {
        setAuthError(body.error ?? "That password does not match.");
        return;
      }
      sessionStorage.setItem(KEY_STORE, pw);
      setKey(pw);
      setPw("");
    } catch {
      setAuthError("Could not reach the server.");
    } finally {
      setChecking(false);
    }
  }

  const rules = data?.rules ?? DEFAULT_RULES;
  const opNames = useMemo(
    () => new Map((data?.operators ?? []).map((o) => [o.id, o.name])),
    [data]
  );

  /** Choices offered in filters exclude retired steps. */
  const choiceSteps = useMemo(() => liveSteps(data?.steps ?? []), [data]);

  const rows: Enriched[] = useMemo(() => {
    if (!data) return [];
    return enrich(
      data.logs,
      data.steps,
      rules,
      includeOffShift,
      data.segments ?? []
    );
  }, [data, rules, includeOffShift]);

  const poRows = useMemo(() => {
    if (!data) return [];
    return enrichPos(
      data.poLogs ?? [],
      data.steps,
      rules,
      includeOffShift,
      data.segments ?? []
    );
  }, [data, rules, includeOffShift]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (area && r.step?.area !== area) return false;
      if (stepId && r.log.step_id !== stepId) return false;
      if (operator) {
        const touched =
          r.log.operator_id === operator ||
          r.log.queue_in_by === operator ||
          r.log.queue_out_by === operator ||
          r.log.process_in_by === operator ||
          r.log.process_out_by === operator;
        if (!touched) return false;
      }
      if (blast && r.log.blast_type !== blast) return false;
      if (lotSearch && !r.log.lot_id.includes(lotSearch.trim())) return false;
      if (onlyFlagged && !r.flagged) return false;
      if (hideIncomplete && r.incomplete) return false;
      return true;
    });
  }, [rows, area, stepId, operator, blast, lotSearch, onlyFlagged, hideIncomplete]);

  const byStep = useMemo(() => bucketBy(filtered, "step"), [filtered]);
  const byArea = useMemo(() => bucketBy(filtered, "area"), [filtered]);
  const trend = useMemo(() => trendByDay(filtered), [filtered]);
  const lots = useMemo(() => summariseLots(filtered), [filtered]);

  const stepDaily = useMemo(
    () => dailySeries(filtered, (r) => r.step?.step_name, metric, agg),
    [filtered, metric, agg]
  );
  const areaDaily = useMemo(
    () => dailySeries(filtered, (r) => r.step?.area, metric, agg),
    [filtered, metric, agg]
  );
  const splitDaily = useMemo(() => dailySplit(filtered, agg), [filtered, agg]);
  const throughput = useMemo(() => throughputByDay(filtered), [filtered]);
  const interruptionRows = useMemo(
    () => interruptionsByStep(filtered),
    [filtered]
  );
  const poSummaries = useMemo(() => summarisePos(poRows), [poRows]);
  const poDaily = useMemo(
    () => dailySeriesPo(poRows, metric, agg),
    [poRows, metric, agg]
  );

  const opHours = useMemo(
    () => operatorHours(filtered, poRows, opNames, rules, includeOffShift),
    [filtered, poRows, opNames, rules, includeOffShift]
  );
  const shares = useMemo(() => waitShare(byStep), [byStep]);
  const blastRows = useMemo(() => blastComparison(filtered), [filtered]);
  const slowLots = useMemo(() => slowestLots(filtered), [filtered]);
  const weekday = useMemo(() => byWeekday(filtered), [filtered]);
  const poStationRows = useMemo(() => poByStation(poRows), [poRows]);
  const poShares = useMemo(() => poWaitShare(poRows), [poRows]);
  const poThroughput = useMemo(() => poThroughputByDay(poRows), [poRows]);
  const slowPos = useMemo(() => slowestPos(poRows), [poRows]);

  const controlProps = { metric, setMetric, agg, setAgg };

  /** The whole range as a spreadsheet, laid out one row per lot. */
  function exportExcel() {
    if (!data) return;
    const wb = buildWorkbook({
      rows: filtered,
      poRows,
      steps: data.steps,
      operators: data.operators,
      from,
      to,
      includeOffShift,
    });
    downloadWorkbook(wb, `armorlube-process-times-${from}-to-${to}.xlsx`);
  }
  const skips = useMemo(
    () => skippedSteps(filtered, choiceSteps),
    [filtered, choiceSteps]
  );
  const rework = useMemo(() => reworkCount(filtered), [filtered]);

  const totals = useMemo(() => {
    const q = filtered.map((r) => r.queueMs).filter((n) => n > 0);
    const p = filtered.map((r) => r.processMs).filter((n) => n > 0);
    const mean = (a: number[]) =>
      a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const slowest = [...byStep].sort((a, b) => b.totalAvg - a.totalAvg)[0];
    return {
      records: filtered.length,
      lots: new Set(filtered.map((r) => r.log.lot_id)).size,
      queueAvg: mean(q),
      processAvg: mean(p),
      flagged: filtered.filter((r) => r.flagged).length,
      incomplete: filtered.filter((r) => r.incomplete).length,
      slowest: slowest?.label ?? "",
      slowestMs: slowest?.totalAvg ?? 0,
      interruptions: filtered.reduce((a, r) => a + r.interruptions, 0),
      labourMs: filtered.reduce((a, r) => a + r.labourMs, 0),
      elapsedMs: filtered.reduce((a, r) => a + r.totalMs, 0),
    };
  }, [filtered, byStep]);

  /** Average of the values that actually happened, ignoring empty ones. */
  function avgOf(values: number[]): number {
    const real = values.filter((v) => v > 0);
    if (real.length === 0) return 0;
    return real.reduce((a, b) => a + b, 0) / real.length;
  }

  function exportPoCsv() {
    const csv = toPoCsv(poRows, opNames);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `armorlube-purchase-orders-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const csv = toCsv(filtered, opNames);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `armorlube-process-times-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- gate ----------
  if (!key) {
    return (
      <main
        className="shell"
        style={{ maxWidth: 420, paddingTop: "16vh" }}
      >
        <div className="panel stack">
          <div className="row">
            <Lock size={19} color="#4c8df6" />
            <strong style={{ fontSize: 17 }}>Dashboard access</strong>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Analytics and raw records sit behind a password. Ask a supervisor if
            you need it.
          </p>
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void signIn()}
          />
          {authError && <div className="err">{authError}</div>}
          <button
            className="btn primary"
            disabled={checking || !pw}
            onClick={() => void signIn()}
          >
            <LogIn size={16} />
            {checking ? "Checking" : "Open dashboard"}
          </button>
          <button className="btn ghost" onClick={() => router.push("/")}>
            Back to stations
          </button>
        </div>
      </main>
    );
  }

  // ---------- dashboard ----------
  return (
    <>
      <header className="topbar">
        <BarChart3 size={20} color="#4c8df6" />
        <div>
          <h1>Process time analytics</h1>
          <div className="sub">
            {totals.records} records across {totals.lots} lots
          </div>
        </div>
        <div className="spacer" />
        <button className="btn sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} />
          {loading ? "Loading" : "Refresh"}
        </button>
        <button className="btn sm primary" onClick={exportExcel}>
          <FileSpreadsheet size={15} />
          Excel
        </button>
        <button className="btn sm" onClick={exportCsv}>
          <Download size={15} />
          CSV
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            sessionStorage.removeItem(KEY_STORE);
            setKey(null);
          }}
        >
          Lock
        </button>
        <button className="btn sm ghost" onClick={() => router.push("/")}>
          <Layers size={15} />
        </button>
      </header>

      <main className="shell stack">
        {/* filters */}
        <section className="panel stack">
          <div className="row">
            <Filter size={16} color="#9aa8b8" />
            <strong style={{ fontSize: 14 }}>Filters</strong>
            <div className="spacer" />
            <div className="seg">
              <button
                aria-pressed={!includeOffShift}
                onClick={() => setIncludeOffShift(false)}
              >
                Working hours only
              </button>
              <button
                aria-pressed={includeOffShift}
                onClick={() => setIncludeOffShift(true)}
              >
                Include nights and weekends
              </button>
            </div>
            <div className="seg">
              <button
                aria-pressed={!labourView}
                onClick={() => setLabourView(false)}
              >
                <Timer size={15} />
                Elapsed time
              </button>
              <button
                aria-pressed={labourView}
                onClick={() => setLabourView(true)}
              >
                <Users size={15} />
                Labour hours
              </button>
            </div>
          </div>

          <p className="hint" style={{ margin: 0 }}>
            {includeOffShift
              ? `Every elapsed minute is counted, including time outside ${rules.work_start} to ${rules.work_end}.`
              : `Time outside ${rules.work_start} to ${rules.work_end} on working days is excluded. Records that span a shift boundary are flagged below.`}
          </p>

          <div className="grid-4">
            <div>
              <label className="field-label">From</label>
              <input
                type="date"
                className="input"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">To</label>
              <input
                type="date"
                className="input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Area</label>
              <select
                className="select"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="">All areas</option>
                {Array.from(new Set(choiceSteps.map((s) => s.area))).map(
                  (a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  )
                )}
              </select>
            </div>
            <div>
              <label className="field-label">Step</label>
              <select
                className="select"
                value={stepId}
                onChange={(e) => setStepId(e.target.value)}
              >
                <option value="">All steps</option>
                {choiceSteps.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.step_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Operator</label>
              <select
                className="select"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
              >
                <option value="">Everyone</option>
                {(data?.operators ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Blast type</label>
              <select
                className="select"
                value={blast}
                onChange={(e) => setBlast(e.target.value)}
              >
                <option value="">Any</option>
                <option value="Manual Blasting">Manual Blasting</option>
                <option value="Auto Blasting">Auto Blasting</option>
              </select>
            </div>
            <div>
              <label className="field-label">Lot contains</label>
              <input
                className="input mono"
                placeholder="000000"
                value={lotSearch}
                onChange={(e) => setLotSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Record state</label>
              <div className="stack" style={{ gap: 6 }}>
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={onlyFlagged}
                    onChange={(e) => setOnlyFlagged(e.target.checked)}
                  />{" "}
                  Only shift-crossing records
                </label>
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={hideIncomplete}
                    onChange={(e) => setHideIncomplete(e.target.checked)}
                  />{" "}
                  Hide records missing a time
                </label>
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={showDeleted}
                    onChange={(e) => setShowDeleted(e.target.checked)}
                  />{" "}
                  Include deleted records
                </label>
              </div>
            </div>
          </div>
        </section>

        {loadError && <div className="panel err">{loadError}</div>}

        {/* stats */}
        <section className="grid-4">
          <div className="stat">
            <div className="k">Average queue time</div>
            <div className="v">{formatDuration(totals.queueAvg)}</div>
          </div>
          <div className="stat">
            <div className="k">Average process time</div>
            <div className="v">{formatDuration(totals.processAvg)}</div>
          </div>
          <div className="stat">
            <div className="k">Slowest step</div>
            <div className="v" style={{ fontSize: 19 }}>
              {totals.slowest || "None yet"}
            </div>
            <div className="hint">{formatDuration(totals.slowestMs)} average</div>
          </div>
          <div className="stat">
            <div className="k">{labourView ? "Labour hours" : "Elapsed total"}</div>
            <div className="v">
              {formatDuration(labourView ? totals.labourMs : totals.elapsedMs)}
            </div>
            <div className="hint">
              {labourView
                ? "Elapsed multiplied by crew size"
                : "Wall time regardless of how many worked it"}
            </div>
          </div>
          <div className="stat">
            <div className="k">Sent back to queue</div>
            <div className="v">{totals.interruptions}</div>
            <div className="hint">Across every record in range</div>
          </div>
          <div className="stat">
            <div className="k">Needs review</div>
            <div className="v">{totals.flagged + totals.incomplete}</div>
            <div className="hint">
              {totals.flagged} cross a shift boundary, {totals.incomplete} missing a
              time{rework > 0 ? `, ${rework} reworked` : ""}
            </div>
          </div>
        </section>

        {/* tabs */}
        <div className="row">
          <div className="seg">
            <button aria-pressed={tab === "charts"} onClick={() => setTab("charts")}>
              <BarChart3 size={15} />
              Charts
            </button>
            <button aria-pressed={tab === "lots"} onClick={() => setTab("lots")}>
              <ListOrdered size={15} />
              By lot
            </button>
            <button aria-pressed={tab === "pos"} onClick={() => setTab("pos")}>
              <FileText size={15} />
              Purchase orders
            </button>
            <button aria-pressed={tab === "raw"} onClick={() => setTab("raw")}>
              <Clock3 size={15} />
              Raw records
            </button>
            <button
              aria-pressed={tab === "settings"}
              onClick={() => setTab("settings")}
            >
              <SettingsIcon size={15} />
              Settings
            </button>
          </div>
        </div>

        {tab === "charts" && (
          <div className="stack">
            <ChartBlock
              title="Each step, day by day"
              description={
                <>
                  One line per step, one point per day. The number is the{" "}
                  <strong>
                    {agg === "avg"
                      ? "average across the lots worked at that step that day"
                      : "total across every lot worked at that step that day"}
                  </strong>
                  , showing {METRIC_LABEL[metric].toLowerCase()}. Days are kept
                  separate rather than rolled into one figure, so a run of slow
                  days shows up instead of being averaged away. A gap means no
                  lot was worked at that step on that day.
                </>
              }
              rows={stepDaily.data}
              columns={stepDaily.series}
              controls={<MetricControls {...controlProps} />}
            >
              <DayLines data={stepDaily.data} series={stepDaily.series} />
            </ChartBlock>

            <ChartBlock
              title="Queue against process, day by day"
              description={
                <>
                  The same days split into waiting and working.{" "}
                  <strong>Queue</strong> is time a lot sat before work started,
                  including any stretch it was sent back. <strong>Process</strong>{" "}
                  is hands-on time. Bars are stacked, so the full height is the
                  whole time a lot spent at a step that day. A tall amber portion
                  means lots are waiting, not that work is slow.
                </>
              }
              rows={splitDaily}
              columns={["Queue", "Process"]}
              controls={<MetricControls {...controlProps} hideMetric />}
            >
              <DayBars data={splitDaily} series={["Queue", "Process"]} stacked />
            </ChartBlock>

            <ChartBlock
              title="Each area, day by day"
              description={
                <>
                  The same measure grouped by area instead of by step, which is
                  the quicker read when you want to know which part of the floor
                  is holding things up rather than which individual station.
                </>
              }
              rows={areaDaily.data}
              columns={areaDaily.series}
              controls={<MetricControls {...controlProps} />}
            >
              <DayLines data={areaDaily.data} series={areaDaily.series} />
            </ChartBlock>

            <div className="grid-2">
              <ChartBlock
                title="Step comparison across the whole range"
                description={
                  <>
                    Every day in the range collapsed into one bar per step, split
                    into queue and process. Use this to rank steps against each
                    other. Use the day by day charts above to see whether a step
                    is consistently slow or was slow on particular days.
                  </>
                }
                rows={byStep.map((b) => ({
                  date: b.label,
                  Queue: toHours(b.queueAvg),
                  Process: toHours(b.processAvg),
                  Records: b.count,
                }))}
                columns={["Queue", "Process", "Records"]}
              >
                <SplitBars buckets={byStep} />
              </ChartBlock>

              <ChartBlock
                title="Lots finished per day"
                description={
                  <>
                    Distinct lots whose process interval closed at{" "}
                    <strong>Defixturing/Final Inspection</strong>, which is where
                    a lot now ends. This is throughput, not time, so it answers
                    how much got out the door rather than how long anything took.
                  </>
                }
                rows={throughput}
                columns={["Lots"]}
                unit="count"
              >
                <DayBars data={throughput} series={["Lots"]} unit="" />
              </ChartBlock>
            </div>

            <div className="grid-2">
              <ChartBlock
                title="How much of each step is waiting"
                description={
                  <>
                    The same time split as a percentage rather than hours, so
                    steps of very different lengths can be compared fairly. A
                    step at <strong>80% waiting</strong> is not slow at the
                    bench, it is starved or blocked, and speeding up the work
                    there would change almost nothing.
                  </>
                }
                rows={shares}
                columns={["Waiting %", "Working %"]}
                unit="count"
              >
                <PairBars
                  data={shares}
                  series={["Waiting %", "Working %"]}
                  stacked
                  angled
                  unit="%"
                />
              </ChartBlock>

              <ChartBlock
                title="Hours per person"
                description={
                  <>
                    Time credited to each operator across lots and purchase
                    orders. Where several people worked one stretch the time is{" "}
                    <strong>split evenly between them</strong>, so the totals add
                    up to real elapsed time rather than counting the same hour
                    once per person.
                  </>
                }
                rows={opHours}
                columns={["Queue", "Process"]}
              >
                <PairBars data={opHours} stacked angled />
              </ChartBlock>
            </div>

            <div className="grid-2">
              <ChartBlock
                title="Slowest lots in range"
                description={
                  <>
                    The twenty lots with the most total time across every step,
                    split into waiting and working. Useful for chasing outliers:
                    a lot that is mostly amber sat somewhere, a lot that is
                    mostly blue genuinely took the work.
                  </>
                }
                rows={slowLots}
                columns={["Queue", "Process"]}
              >
                <PairBars data={slowLots} stacked angled height={360} />
              </ChartBlock>

              <ChartBlock
                title="By day of the week"
                description={
                  <>
                    Average queue and process time grouped by weekday across the
                    whole range. Worth a look if Mondays or Fridays behave
                    differently from the middle of the week.
                  </>
                }
                rows={weekday}
                columns={["Queue", "Process"]}
              >
                <PairBars data={weekday} />
              </ChartBlock>
            </div>

            {blastRows.length > 0 && (
              <ChartBlock
                title="Manual against automatic blasting"
                description={
                  <>
                    Average queue and process time for lots recorded as each
                    blast type. <strong>Lots</strong> in the table view is how
                    many of each were run, which matters before reading much
                    into a difference built on a handful of records.
                  </>
                }
                rows={blastRows}
                columns={["Queue", "Process", "Lots"]}
              >
                <PairBars data={blastRows} height={280} />
              </ChartBlock>
            )}

            <div className="grid-2">
              <ChartBlock
                title="Work sent back to queue"
                description={
                  <>
                    How often a lot was pushed back into the queue part way
                    through a step, by step. <strong>Times sent back</strong> is
                    the raw count, <strong>per record</strong> is that divided by
                    the number of records, which is the fairer comparison when
                    one step handles far more lots than another.
                  </>
                }
                rows={interruptionRows}
                columns={["Times sent back", "Per record"]}
                unit="count"
              >
                <DayBars
                  data={interruptionRows}
                  series={["Times sent back", "Per record"]}
                  unit=""
                />
              </ChartBlock>

              <ChartBlock
                title="Steps passed over"
                description={
                  <>
                    Worked out from gaps in each lot's route rather than stored
                    anywhere. A lot logged at Degrease and then Fixturing skipped
                    everything between, so those steps count here. It cannot tell
                    a deliberate skip from a missed log.
                  </>
                }
                rows={skips.map((sk) => ({
                  date: sk.step,
                  "Lots that skipped it": sk.skipped,
                }))}
                columns={["Lots that skipped it"]}
                unit="count"
              >
                <DayBars
                  data={skips.map((sk) => ({
                    date: sk.step,
                    "Lots that skipped it": sk.skipped,
                  }))}
                  series={["Lots that skipped it"]}
                  unit=""
                />
              </ChartBlock>
            </div>
          </div>
        )}

        {tab === "lots" && (
          <div className="panel">
            <h2 className="section-title">Time per lot across every step</h2>
            <div className="table-wrap scroll-y" style={{ maxHeight: 620 }}>
              <table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Steps logged</th>
                    <th>Queue</th>
                    <th>Process</th>
                    <th>Total</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={l.lot}>
                      <td className="mono">{l.lot}</td>
                      <td>{l.steps}</td>
                      <td>{formatDuration(l.queueMs)}</td>
                      <td>{formatDuration(l.processMs)}</td>
                      <td>
                        <strong>{formatDuration(l.totalMs)}</strong>
                      </td>
                      <td>
                        {l.flagged ? (
                          <span className="badge warn">
                            <TriangleAlert size={12} />
                            Crosses shift
                          </span>
                        ) : (
                          <span className="badge ok">Clean</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {lots.length === 0 && <div className="empty">No lots in this range.</div>}
          </div>
        )}

        {tab === "raw" && (
          <div className="panel">
            <h2 className="section-title">Raw records</h2>
            <div className="table-wrap scroll-y" style={{ maxHeight: 640 }}>
              <table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Pass</th>
                    <th>Step</th>
                    <th>Area</th>
                    <th>Date</th>
                    <th>Crew</th>
                    <th>Stretches</th>
                    <th>Sent back</th>
                    <th>Queue</th>
                    <th>Process</th>
                    <th>Off shift</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 1000).map((r) => (
                    <tr key={r.log.id}>
                      <td className="mono">{r.log.lot_id}</td>
                      <td>
                        {r.log.pass_no > 1 ? (
                          <span className="badge warn">{r.log.pass_no}</span>
                        ) : (
                          1
                        )}
                      </td>
                      <td>{r.step?.step_name}</td>
                      <td>{r.step?.area}</td>
                      <td className="mono">{r.log.log_date}</td>
                      <td>
                        {crewOf(r.segments)
                          .map((id) => opNames.get(id))
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                      <td>{r.segments.length || ""}</td>
                      <td>{r.interruptions || ""}</td>
                      <td>{r.queueMs ? formatDuration(r.queueMs) : ""}</td>
                      <td>{r.processMs ? formatDuration(r.processMs) : ""}</td>
                      <td>
                        {r.flagged
                          ? formatDuration(
                              (r.queue?.offShiftMs ?? 0) + (r.process?.offShiftMs ?? 0)
                            )
                          : ""}
                      </td>
                      <td>
                        {r.log.deleted_at ? (
                          <span className="badge bad">Deleted</span>
                        ) : r.incomplete ? (
                          <span className="badge warn">Missing a time</span>
                        ) : r.flagged ? (
                          <span className="badge info">Crosses shift</span>
                        ) : (
                          <span className="badge ok">Clean</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 1000 && (
              <p className="hint" style={{ marginTop: 10 }}>
                Showing the first 1000 rows. Export to CSV for the full set.
              </p>
            )}
            {filtered.length === 0 && (
              <div className="empty">Nothing matches these filters.</div>
            )}
          </div>
        )}

        {tab === "pos" && (
          <div className="stack">
            <div className="row">
              <p className="hint" style={{ margin: 0, maxWidth: "70ch" }}>
                Purchase orders are tracked at Incoming Inspection, where boxes
                are unpacked and logged, and at Oil/Shipping, where orders are
                packed out. They are timed the same way lots are and are kept
                entirely separate from them, because one order can span several
                lots and one lot can hold several orders.
              </p>
              <div className="spacer" />
              <button className="btn sm" onClick={exportPoCsv}>
                <Download size={15} />
                PO CSV
              </button>
            </div>

            <div className="grid-4">
              <div className="stat">
                <div className="k">Orders</div>
                <div className="v">{poSummaries.length}</div>
                <div className="hint">{poRows.length} station records</div>
              </div>
              <div className="stat">
                <div className="k">Average queue</div>
                <div className="v">
                  {formatDuration(
                    avgOf(poRows.map((r) => r.queueMs))
                  )}
                </div>
                <div className="hint">Waiting before work starts</div>
              </div>
              <div className="stat">
                <div className="k">Average process</div>
                <div className="v">
                  {formatDuration(avgOf(poRows.map((r) => r.processMs)))}
                </div>
                <div className="hint">Hands-on time per station</div>
              </div>
              <div className="stat">
                <div className="k">Still open</div>
                <div className="v">
                  {poRows.filter((r) => r.running).length}
                </div>
                <div className="hint">Orders with a timer running</div>
              </div>
            </div>

            <ChartBlock
              title="Purchase orders by station, day by day"
              description={
                <>
                  One line per station, one point per day, showing{" "}
                  <strong>{METRIC_LABEL[metric].toLowerCase()}</strong> as{" "}
                  {agg === "avg"
                    ? "the average across the orders handled that day"
                    : "the total across every order handled that day"}
                  . Incoming Inspection covers unpacking and paperwork,
                  Oil/Shipping covers packing out.
                </>
              }
              rows={poDaily.data}
              columns={poDaily.series}
              controls={<MetricControls {...controlProps} />}
            >
              <DayLines data={poDaily.data} series={poDaily.series} />
            </ChartBlock>

            <ChartBlock
              title="Time per purchase order"
              description={
                <>
                  Every station an order touched, added together. Sorted slowest
                  first, so the orders that ate the most time are at the top.{" "}
                  <strong>Labour</strong> multiplies each stretch by how many
                  people were on it, so it exceeds total whenever more than one
                  person worked an order.
                </>
              }
              rows={poSummaries.slice(0, 40).map((r) => ({
                date: r.po,
                Queue: toHours(r.queueMs),
                Process: toHours(r.processMs),
                Total: toHours(r.totalMs),
                Labour: toHours(r.labourMs),
              }))}
              columns={["Queue", "Process", "Total", "Labour"]}
            >
              <DayBars
                data={poSummaries.slice(0, 20).map((r) => ({
                  date: r.po,
                  Queue: toHours(r.queueMs),
                  Process: toHours(r.processMs),
                }))}
                series={["Queue", "Process"]}
                stacked
              />
            </ChartBlock>

            <div className="grid-2">
              <ChartBlock
                title="Each station, averaged"
                description={
                  <>
                    Average queue and process time per order at each station.{" "}
                    <strong>Incoming Inspection</strong> covers unboxing,
                    counting and the back and forth with customers.{" "}
                    <strong>Oil/Shipping</strong> covers oiling, packing and
                    getting orders out.
                  </>
                }
                rows={poStationRows}
                columns={["Queue", "Process", "Orders"]}
              >
                <PairBars data={poStationRows} height={290} />
              </ChartBlock>

              <ChartBlock
                title="How much of each station is waiting"
                description={
                  <>
                    Waiting against working as a share of total time. A high
                    waiting share at incoming usually means orders sat before
                    anyone got to them, not that unboxing is slow.
                  </>
                }
                rows={poShares}
                columns={["Waiting %", "Working %"]}
                unit="count"
              >
                <PairBars
                  data={poShares}
                  series={["Waiting %", "Working %"]}
                  stacked
                  unit="%"
                  height={290}
                />
              </ChartBlock>
            </div>

            <div className="grid-2">
              <ChartBlock
                title="Slowest purchase orders"
                description={
                  <>
                    The twenty orders with the most total time across both
                    stations, split into waiting and working. Sorted slowest
                    first.
                  </>
                }
                rows={slowPos}
                columns={["Queue", "Process"]}
              >
                <PairBars data={slowPos} stacked angled height={360} />
              </ChartBlock>

              <ChartBlock
                title="Orders closed per day"
                description={
                  <>
                    Orders whose intervals all finished on that day, with none
                    left running. This is purchase order throughput, the
                    equivalent of lots finished per day on the lots tab.
                  </>
                }
                rows={poThroughput}
                columns={["Orders closed"]}
                unit="count"
              >
                <DayBars
                  data={poThroughput}
                  series={["Orders closed"]}
                  unit=""
                  height={360}
                />
              </ChartBlock>
            </div>

            <div className="panel">
              <h2 className="section-title">Every purchase order record</h2>
              <p className="chart-desc">
                One row per order per station. An order appears twice if it was
                handled at both ends of the line.
              </p>
              {poRows.length === 0 ? (
                <div className="empty">
                  No purchase order records in this range.
                </div>
              ) : (
                <div className="table-wrap scroll-y" style={{ maxHeight: 560 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>PO</th>
                        <th>Station</th>
                        <th>Date</th>
                        <th>Queue</th>
                        <th>Process</th>
                        <th>Total</th>
                        <th>Labour</th>
                        <th>Crew</th>
                        <th>Sent back</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {poRows.map((r) => (
                        <tr key={r.po.id}>
                          <td className="mono">{r.po.po_number}</td>
                          <td>{r.step?.step_name}</td>
                          <td className="mono">{r.po.log_date}</td>
                          <td>{formatDuration(r.queueMs)}</td>
                          <td>{formatDuration(r.processMs)}</td>
                          <td>
                            <strong>{formatDuration(r.totalMs)}</strong>
                          </td>
                          <td>{formatDuration(r.labourMs)}</td>
                          <td>
                            {crewOf(r.segments)
                              .map((id) => opNames.get(id))
                              .filter(Boolean)
                              .join(", ")}
                          </td>
                          <td>{r.interruptions || ""}</td>
                          <td>
                            {r.po.deleted_at ? (
                              <span className="badge bad">Deleted</span>
                            ) : r.running ? (
                              <span className="badge warn">Running</span>
                            ) : (
                              <span className="badge ok">Done</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "settings" && <SettingsPanel apiKey={key} onSaved={load} />}

        <p className="hint" style={{ paddingBottom: 30 }}>
          Times are shown in Tucson local time. Working hours are{" "}
          {rules.work_start} to {rules.work_end}, Monday through Friday, and can be
          changed in settings.
        </p>
      </main>
    </>
  );
}

function SettingsPanel({
  apiKey,
  onSaved,
}: {
  apiKey: string;
  onSaved: () => void;
}) {
  const [workStart, setWorkStart] = useState("07:00");
  const [workEnd, setWorkEnd] = useState("15:30");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings", { headers: { "x-apt-key": apiKey } });
      if (!res.ok) return;
      const s = await res.json();
      setWorkStart(s.work_start);
      setWorkEnd(s.work_end);
      setDays(s.work_days ?? [1, 2, 3, 4, 5]);
    })();
  }, [apiKey]);

  async function save() {
    setErr(null);
    setMsg(null);

    if (newPw && newPw !== confirmPw) {
      setErr("The two passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-apt-key": apiKey },
        body: JSON.stringify({
          work_start: workStart,
          work_end: workEnd,
          work_days: days,
          new_password: newPw || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body.error ?? "Could not save.");
        return;
      }
      if (body.passwordChanged) {
        sessionStorage.setItem("apt.key.v1", newPw);
      }
      setNewPw("");
      setConfirmPw("");
      setMsg("Settings saved.");
      onSaved();
    } catch {
      setErr("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid-2">
      <div className="panel stack">
        <h2 className="section-title">Working hours</h2>
        <p className="hint" style={{ margin: 0 }}>
          Time outside these hours is excluded from duration maths unless the
          dashboard toggle says otherwise.
        </p>
        <div className="grid-2">
          <div>
            <label className="field-label">Shift start</label>
            <input
              type="time"
              className="input"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Shift end</label>
            <input
              type="time"
              className="input"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="field-label">Working days</label>
          <div className="chips">
            {names.map((n, i) => (
              <button
                key={n}
                className="chip"
                aria-pressed={days.includes(i)}
                onClick={() =>
                  setDays((d) =>
                    d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()
                  )
                }
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel stack">
        <h2 className="section-title">Dashboard password</h2>
        <p className="hint" style={{ margin: 0 }}>
          Changing this signs out every other iPad the next time it opens the
          dashboard.
        </p>
        <div>
          <label className="field-label">New password</label>
          <input
            type="password"
            className="input"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="Leave blank to keep the current one"
          />
        </div>
        <div>
          <label className="field-label">Confirm new password</label>
          <input
            type="password"
            className="input"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
        </div>

        {err && <div className="err">{err}</div>}
        {msg && <div className="badge ok">{msg}</div>}

        <button className="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

/** Shared measure and aggregation switches for the day by day charts. */
function MetricControls({
  metric,
  setMetric,
  agg,
  setAgg,
  hideMetric,
}: {
  metric: Metric;
  setMetric: (m: Metric) => void;
  agg: Aggregate;
  setAgg: (a: Aggregate) => void;
  hideMetric?: boolean;
}) {
  const metrics: Metric[] = ["queue", "process", "total", "labour"];
  return (
    <>
      {!hideMetric && (
        <div className="seg">
          {metrics.map((m) => (
            <button
              key={m}
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      )}
      <div className="seg">
        <button aria-pressed={agg === "avg"} onClick={() => setAgg("avg")}>
          Average per lot
        </button>
        <button aria-pressed={agg === "sum"} onClick={() => setAgg("sum")}>
          Total that day
        </button>
      </div>
    </>
  );
}
