"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Boxes,
  CheckCircle2,
  CloudOff,
  Gauge,
  Loader2,
  Repeat,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { drain, pendingCount, watchConnection } from "@/lib/offline";
import type { ActiveLot, Operator, Step } from "@/lib/types";
import StepPanel from "@/components/StepPanel";

function LogScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const ids = params.getAll("step");

  const [steps, setSteps] = useState<Step[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [lots, setLots] = useState<ActiveLot[]>([]);

  const loadLots = useCallback(async () => {
    const { data } = await supabase
      .from("active_lots")
      .select("*")
      .order("last_activity", { ascending: false });
    if (data) setLots(data as ActiveLot[]);
  }, []);

  const loadOperators = useCallback(async () => {
    const { data } = await supabase.from("operators").select("*").order("name");
    if (data) setOperators(data as Operator[]);
  }, []);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("steps").select("*").order("sort_order");
      if (data) setSteps(data as Step[]);
      await Promise.all([loadOperators(), loadLots()]);
      setLoading(false);
    })();
  }, [loadOperators, loadLots]);

  // Another iPad may finish a lot at a different step, so refresh the list.
  useEffect(() => {
    const t = setInterval(() => void loadLots(), 45000);
    return () => clearInterval(t);
  }, [loadLots]);

  useEffect(() => {
    const stop = watchConnection();
    const onPending = (e: Event) =>
      setPending((e as CustomEvent<number>).detail ?? pendingCount());
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("apt:pending", onPending);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    setPending(pendingCount());
    setOnline(navigator.onLine);

    return () => {
      stop();
      window.removeEventListener("apt:pending", onPending);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const active = ids
    .map((id) => steps.find((s) => s.id === id))
    .filter(Boolean) as Step[];

  const split = active.length === 2;

  if (loading) {
    return (
      <main className="shell">
        <div className="panel empty">
          <Loader2 size={20} />
          <div style={{ marginTop: 8 }}>Loading station</div>
        </div>
      </main>
    );
  }

  if (active.length === 0) {
    return (
      <main className="shell">
        <div className="panel empty">
          <div>That station could not be found.</div>
          <button
            className="btn primary"
            style={{ marginTop: 14 }}
            onClick={() => router.push("/")}
          >
            Choose a station
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <div style={{ minWidth: 0 }}>
          <h1>{active.map((s) => s.step_name).join("  |  ")}</h1>
          <div className="sub">{active.map((s) => s.area).join("  |  ")}</div>
        </div>
        <div className="spacer" />

        <span className="badge" title="Lots currently on the line">
          <Boxes size={13} />
          {lots.length} on the line
        </span>

        <span className="badge" title={online ? "Connected" : "No connection"}>
          <span
            className={`sync-dot ${
              !online ? "off" : pending > 0 ? "pending" : ""
            }`}
          />
          {!online
            ? "Offline"
            : pending > 0
            ? `${pending} waiting to sync`
            : "Synced"}
        </span>

        {pending > 0 && online && (
          <button className="btn sm" onClick={() => void drain()}>
            <Repeat size={14} />
            Sync now
          </button>
        )}

        <button className="btn ghost" onClick={() => router.push("/")}>
          Change station
        </button>
        <button className="btn ghost" onClick={() => router.push("/dashboard")}>
          <Gauge size={17} />
        </button>
      </header>

      <main className="shell">
        <div className={split ? "split" : ""}>
          {active.map((s) => (
            <section className="panel" key={s.id}>
              {split && (
                <div className="row" style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: 16 }}>{s.step_name}</strong>
                  <span className="badge">{s.area}</span>
                </div>
              )}
              <StepPanel
                step={s}
                operators={operators}
                allSteps={steps}
                lots={lots}
                onOperatorsChanged={() => void loadOperators()}
                onLotsChanged={() => void loadLots()}
                compact={split}
                onToast={setToast}
              />
            </section>
          ))}
        </div>
      </main>

      {toast && (
        <div className="toast">
          {toast.includes("wifi") ? (
            <CloudOff size={17} color="#f0a92e" />
          ) : (
            <CheckCircle2 size={17} color="#2fbf71" />
          )}
          {toast}
        </div>
      )}
    </>
  );
}

export default function LogPage() {
  return (
    <Suspense
      fallback={
        <main className="shell">
          <div className="panel empty">Loading</div>
        </main>
      }
    >
      <LogScreen />
    </Suspense>
  );
}
