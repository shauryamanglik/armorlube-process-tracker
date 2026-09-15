"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Clock3,
  Download,
  Filter,
  Layers,
  ListOrdered,
  Lock,
  LogIn,
  RefreshCw,
  Settings as SettingsIcon,
  TriangleAlert,
} from "lucide-react";
import {
  bucketBy,
  enrich,
  summariseLots,
  toCsv,
  trendByDay,
  type Enriched,
} from "@/lib/analytics";
import { DEFAULT_RULES, formatDuration, formatStamp, toHours } from "@/lib/time";
import type { LogRow, Operator, Step, WorkRules } from "@/lib/types";
import { LoadBars, SplitBars, StepBars, Trend } from "@/components/Charts";

const KEY_STORE = "apt.key.v1";

type Payload = {
  logs: LogRow[];
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

  const [tab, setTab] = useState<"charts" | "raw" | "lots" | "settings">("charts");

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

  const rows: Enriched[] = useMemo(() => {
    if (!data) return [];
    return enrich(data.logs, data.steps, rules, includeOffShift);
  }, [data, rules, includeOffShift]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (area && r.step?.area !== area) return false;
      if (stepId && r.log.step_id !== stepId) return false;
      if (operator && r.log.operator_id !== operator) return false;
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
    };
  }, [filtered, byStep]);

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
                {Array.from(new Set((data?.steps ?? []).map((s) => s.area))).map(
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
                {(data?.steps ?? []).map((s) => (
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
            <div className="k">Needs review</div>
            <div className="v">{totals.flagged + totals.incomplete}</div>
            <div className="hint">
              {totals.flagged} cross a shift boundary, {totals.incomplete} missing a
              time
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
            <div className="panel">
              <h2 className="section-title">Queue and process time by step</h2>
              <SplitBars buckets={byStep} />
            </div>
            <div className="grid-2">
              <div className="panel">
                <h2 className="section-title">Average queue time by step</h2>
                <StepBars buckets={byStep} metric="queueAvg" />
              </div>
              <div className="panel">
                <h2 className="section-title">Average process time by step</h2>
                <StepBars buckets={byStep} metric="processAvg" />
              </div>
            </div>
            <div className="grid-2">
              <div className="panel">
                <h2 className="section-title">Average time by area</h2>
                <SplitBars buckets={byArea} />
              </div>
              <div className="panel">
                <h2 className="section-title">Total logged time by step</h2>
                <LoadBars buckets={byStep} />
                <p className="hint" style={{ marginTop: 8 }}>
                  Bars in violet contain at least one record that crosses a shift
                  boundary.
                </p>
              </div>
            </div>
            <div className="panel">
              <h2 className="section-title">Daily average, queue against process</h2>
              <Trend points={trend} />
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
                    <th>Step</th>
                    <th>Area</th>
                    <th>Operator</th>
                    <th>Date</th>
                    <th>Queue in</th>
                    <th>Queue out</th>
                    <th>Process in</th>
                    <th>Process out</th>
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
                      <td>{r.step?.step_name}</td>
                      <td>{r.step?.area}</td>
                      <td>{opNames.get(r.log.operator_id)}</td>
                      <td className="mono">{r.log.log_date}</td>
                      <td className="mono">{formatStamp(r.log.queue_in)}</td>
                      <td className="mono">{formatStamp(r.log.queue_out)}</td>
                      <td className="mono">{formatStamp(r.log.process_in)}</td>
                      <td className="mono">{formatStamp(r.log.process_out)}</td>
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
