"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Columns2,
  Gauge,
  Layers,
  Loader2,
  Monitor,
  Timer,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { liveSteps, type Step } from "@/lib/types";

const LAST_STATION = "apt.station.v1";

export default function Home() {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("steps")
        .select("*")
        .order("sort_order");
      if (error) setError("Could not reach the database. Check the connection.");
      else setSteps(liveSteps(data as Step[]));
      setLoading(false);
    })();
  }, []);

  function go(ids: string[]) {
    const qs = ids.map((id) => `step=${id}`).join("&");
    localStorage.setItem(LAST_STATION, qs);
    router.push(`/log?${qs}`);
  }

  function toggle(id: string) {
    if (!splitMode) {
      go([id]);
      return;
    }
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  const areas = Array.from(new Set(steps.map((s) => s.area)));
  const resume =
    typeof window !== "undefined" ? localStorage.getItem(LAST_STATION) : null;

  return (
    <>
      <header className="topbar">
        <Layers size={20} color="#4c8df6" />
        <div>
          <h1>Armorlube Process Tracker</h1>
          <div className="sub">Pick the station this iPad will run</div>
        </div>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => router.push("/dashboard")}>
          <Gauge size={17} />
          Dashboard
        </button>
      </header>

      <main className="shell stack">
        <div className="panel">
          <div className="row">
            <div className="seg">
              <button
                aria-pressed={!splitMode}
                onClick={() => {
                  setSplitMode(false);
                  setPicked([]);
                }}
              >
                <Monitor size={16} />
                One station
              </button>
              <button
                aria-pressed={splitMode}
                onClick={() => {
                  setSplitMode(true);
                  setPicked([]);
                }}
              >
                <Columns2 size={16} />
                Split screen
              </button>
            </div>
            <div className="spacer" />
            {resume && !splitMode && (
              <button
                className="btn"
                onClick={() => router.push(`/log?${resume}`)}
              >
                <Timer size={16} />
                Back to last station
              </button>
            )}
          </div>

          <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
            {splitMode
              ? "Choose two steps to run side by side on one screen. Each half logs on its own."
              : "The station stays put once chosen. Come back here any time to change it."}
          </p>
        </div>

        {loading && (
          <div className="panel empty">
            <Loader2 size={20} className="spin" />
            <div style={{ marginTop: 8 }}>Loading stations</div>
          </div>
        )}

        {error && <div className="panel err">{error}</div>}

        {!loading && !error && (
          <div className="stack">
            {areas.map((area) => (
              <div className="area-block" key={area}>
                <div className="area-head">
                  <Activity size={15} />
                  {area}
                </div>
                {steps
                  .filter((s) => s.area === area)
                  .map((s) => (
                    <button
                      key={s.id}
                      className="step-btn"
                      aria-pressed={picked.includes(s.id)}
                      onClick={() => toggle(s.id)}
                    >
                      {s.step_name}
                      <span className="step-caps">
                        {s.has_queue && <span className="badge">Queue</span>}
                        {s.has_process && <span className="badge">Process</span>}
                        {s.has_blast_type && (
                          <span className="badge info">Blast type</span>
                        )}
                      </span>
                      {!splitMode && <ArrowRight size={17} color="#6b7886" />}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}

        {splitMode && (
          <div className="panel row">
            <div>
              <div className="field-label" style={{ marginBottom: 2 }}>
                Selected
              </div>
              <strong>
                {picked.length === 0
                  ? "Nothing picked yet"
                  : picked
                      .map((id) => steps.find((s) => s.id === id)?.step_name)
                      .join("  +  ")}
              </strong>
            </div>
            <div className="spacer" />
            <button
              className="btn primary"
              disabled={picked.length !== 2}
              onClick={() => go(picked)}
            >
              Open split screen
              <ArrowRight size={17} />
            </button>
          </div>
        )}
      </main>
    </>
  );
}
