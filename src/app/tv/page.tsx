"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  enrich,
  floorView,
  padGroups,
  boardColumn,
  type FloorGroup,
} from "@/lib/analytics";
import { DEFAULT_RULES, formatDuration, todayInPhoenix } from "@/lib/time";
import type {
  LogRow,
  Operator,
  PoLog,
  Segment,
  Step,
  WorkRules,
} from "@/lib/types";

/**
 * A board for a smart TV browser.
 *
 * The main dashboard uses flexbox gap and dvh units, which arrived in 2020 and
 * 2022. A 2022 LG set runs a browser engine from around 2019, so both are
 * ignored, every spaced layout collapses, and the page looks broken. This page
 * avoids them entirely: table cells for the columns, margins for spacing, vh
 * for height, fixed pixel sizes rather than clamp. It is plainer than the main
 * board on purpose, because plain is what renders everywhere.
 *
 * Open it directly, no navigation needed:
 *   /tv?k=YOUR_PASSWORD
 * The key is remembered afterwards, so the display comes back on its own
 * after a power cut without anyone typing on a remote.
 */

const KEY_STORE = "apt.tvkey.v1";

type Payload = {
  logs: LogRow[];
  poLogs: PoLog[];
  segments: Segment[];
  steps: Step[];
  operators: Operator[];
  rules: WorkRules | null;
};

const CSS = `
.tv-root{position:fixed;top:0;left:0;right:0;bottom:0;background:#0e0e0f;
  color:#ededee;overflow:hidden;font-family:var(--font-sans),Arial,sans-serif;}
.tv-pad{padding:14px 18px;height:100%;box-sizing:border-box;}
.tv-head{height:44px;overflow:hidden;}
.tv-title{font-size:24px;font-weight:700;float:left;line-height:30px;margin:0;}
.tv-sub{float:right;font-size:17px;color:#a0a0a6;line-height:30px;}
.tv-dot{display:inline-block;width:11px;height:11px;border-radius:50%;
  background:#2fbf71;margin-right:8px;}
.tv-clear{clear:both;height:0;overflow:hidden;}

/* Table cells instead of flex or grid, because every engine has had them
   for twenty years and they give equal columns for free. */
.tv-board{display:table;table-layout:fixed;width:100%;border-collapse:separate;
  border-spacing:7px 0;}
.tv-col{display:table-cell;vertical-align:top;background:#171718;
  border-radius:10px;padding:9px;}
.tv-colname{font-size:18px;font-weight:700;margin:0 0 4px 0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tv-counts{font-size:14px;color:#a0a0a6;margin:0 0 8px 0;height:18px;}
.tv-live{color:#8ab4ff;font-weight:700;}
.tv-done{color:#a0a0a6;}

/* Margin rather than gap. */
.tv-bar{position:relative;margin-bottom:5px;
  border-radius:6px;background:#2a2a2d;overflow:hidden;}
.tv-fill{position:absolute;left:0;top:0;bottom:0;border-radius:6px;}
.tv-q .tv-fill{background:rgba(240,169,46,0.5);}
.tv-p .tv-fill{background:rgba(76,141,246,0.5);}
.tv-bar.off .tv-fill{background:rgba(255,255,255,0.09);}
.tv-q.on{box-shadow:inset 3px 0 0 #f0a92e;}
.tv-p.on{box-shadow:inset 3px 0 0 #4c8df6;}
.tv-bar.off{box-shadow:inset 3px 0 0 rgba(255,255,255,0.18);}
.tv-ref{position:relative;font-family:var(--font-mono),monospace;font-weight:600;
  font-size:1em;margin-left:11px;text-shadow:0 1px 3px rgba(0,0,0,0.85);}
.tv-time{position:relative;float:right;font-size:0.88em;font-weight:600;
  margin-right:11px;opacity:0.85;text-shadow:0 1px 3px rgba(0,0,0,0.85);}
.tv-bar.off .tv-ref,.tv-bar.off .tv-time{color:#c6c6cd;}
.tv-empty{font-size:14px;color:#75757b;padding:10px 0;}
.tv-more{font-size:13px;color:#75757b;text-align:center;}
.tv-setlabel{font-size:16px;font-weight:700;color:#a0a0a6;margin:6px 0 5px 0;}
.tv-gate{padding:60px;text-align:center;}
.tv-gate input{font-size:22px;padding:12px;width:320px;background:#1f1f21;
  color:#ededee;border:1px solid #3a3a3e;border-radius:8px;}
.tv-gate button{font-size:22px;padding:12px 26px;margin-left:10px;
  background:#2f6fd0;color:#fff;border:0;border-radius:8px;}
.tv-err{color:#ff9a9d;font-size:18px;margin-top:14px;}
`;

function Column({
  group,
  kind,
  scaleMs,
  maxRows,
  barH,
}: {
  group: FloorGroup;
  kind: "queue" | "process";
  scaleMs: number;
  maxRows: number;
  barH: number;
}) {
  const items = [...group.items].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return b.ms - a.ms;
  });
  const shown = items.slice(0, maxRows);
  const hidden = items.length - shown.length;

  return (
    <div className="tv-col">
      <p className="tv-colname">{group.name}</p>
      <p className="tv-counts">
        {group.items.length > 0 ? (
          <span className="tv-live">{group.items.length} here</span>
        ) : (
          <span className="tv-done">none</span>
        )}
      </p>

      {shown.length === 0 ? (
        <p className="tv-empty">Nothing here</p>
      ) : (
        shown.map((it, i) => {
          const pct = scaleMs > 0 ? Math.max(3, (it.ms / scaleMs) * 100) : 3;
          return (
            <div
              key={it.ref + i}
              className={
                "tv-bar " +
                (kind === "queue" ? "tv-q " : "tv-p ") +
                (it.running ? "on" : "off")
              }
              style={{
                height: barH,
                lineHeight: barH + "px",
                fontSize: Math.max(12, Math.round(barH * 0.48)),
              }}
            >
              <span className="tv-fill" style={{ width: pct + "%" }} />
              <span className="tv-time">{formatDuration(it.ms)}</span>
              <span className="tv-ref">{it.ref}</span>
            </div>
          );
        })
      )}

      {hidden > 0 && <p className="tv-more">+{hidden} more</p>}
    </div>
  );
}

function TvBoard() {
  const params = useSearchParams();
  const [key, setKey] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [now, setNow] = useState("");

  // The key can come in the address, so the whole thing is one thing to type
  // on a remote, and it is remembered for next time.
  useEffect(() => {
    const fromUrl = params.get("k");
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(KEY_STORE) : null;
    if (fromUrl) {
      localStorage.setItem(KEY_STORE, fromUrl);
      setKey(fromUrl);
    } else if (saved) {
      setKey(saved);
    }
  }, [params]);

  const load = useCallback(async () => {
    if (!key) return;
    const day = todayInPhoenix();
    // A lot that queued last week and is still waiting has an older record
    // date, so fetching only today would miss it. The dashboard reaches back
    // the same way, which is why the two disagreed.
    const back = new Date(day + "T12:00:00Z");
    back.setUTCDate(back.getUTCDate() - 21);
    const from = back.toISOString().slice(0, 10);
    try {
      const res = await fetch(
        "/api/analytics?from=" + from + "&to=" + day + "&deleted=0",
        { headers: { "x-apt-key": key } }
      );
      if (res.status === 401) {
        setError("That password was not accepted.");
        localStorage.removeItem(KEY_STORE);
        setKey(null);
        return;
      }
      if (!res.ok) throw new Error("bad");
      setData(await res.json());
      setError(null);
      setNow(
        new Date().toLocaleTimeString("en-US", {
          timeZone: "America/Phoenix",
          hour: "numeric",
          minute: "2-digit",
        })
      );
    } catch {
      setError("Could not reach the server.");
    }
  }, [key]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  if (!key) {
    return (
      <div className="tv-root">
        <div className="tv-gate">
          <h1 className="tv-title" style={{ float: "none", fontSize: 30 }}>
            Armorlube floor board
          </h1>
          <p style={{ color: "#a0a0a6", fontSize: 18 }}>
            Enter the dashboard password. It is remembered after this.
          </p>
          <input
            type="password"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typed) {
                localStorage.setItem(KEY_STORE, typed);
                setKey(typed);
              }
            }}
          />
          <button
            onClick={() => {
              if (!typed) return;
              localStorage.setItem(KEY_STORE, typed);
              setKey(typed);
            }}
          >
            Show board
          </button>
          {error && <p className="tv-err">{error}</p>}
          <p style={{ color: "#75757b", fontSize: 15, marginTop: 26 }}>
            Tip: open /tv?k=PASSWORD to skip this next time.
          </p>
        </div>
      </div>
    );
  }

  const rules = data?.rules ?? DEFAULT_RULES;
  const day = todayInPhoenix();

  let queue: FloorGroup[] = [];
  let process: FloorGroup[] = [];

  if (data) {
    const rows = enrich(data.logs, data.steps, rules, false, data.segments);
    const names = Array.from(
      new Set(
        data.steps
          .filter((s) => s.tracks_lots !== false && s.active !== false)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s) => boardColumn(s))
      )
    );

    /** Only what is on the floor now. Work that moved on is history, and a
     *  wall display is about the present. */
    const liveOnly = (groups: FloorGroup[]): FloorGroup[] =>
      groups.map((g) => {
        const items = g.items.filter((i) => i.running);
        return {
          ...g,
          items,
          runningCount: items.length,
          doneCount: 0,
          staleCount: 0,
        };
      });

    queue = padGroups(
      liveOnly(floorView(rows, "queue", day, rules, false, "area")),
      names
    );
    process = padGroups(
      liveOnly(floorView(rows, "process", day, rules, false, "area")),
      names
    );
  }

  const scaleMs = Math.max(
    1,
    ...queue.flatMap((g) => g.items.map((i) => i.ms)),
    ...process.flatMap((g) => g.items.map((i) => i.ms))
  );
  const liveNow =
    queue.reduce((a, g) => a + g.runningCount, 0) +
    process.reduce((a, g) => a + g.runningCount, 0);

  /**
   * Both boards share one bar height, chosen from whichever column is
   * busiest, so every bar on screen is the same size and all live work fits.
   * Tiers rather than measurement, because this browser cannot be relied on
   * for box maths.
   */
  const busiest = Math.max(
    1,
    ...queue.map((g) => g.items.length),
    ...process.map((g) => g.items.length)
  );
  const barH =
    busiest <= 7 ? 38 : busiest <= 10 ? 30 : busiest <= 13 ? 24 : busiest <= 17 ? 19 : 15;
  const maxRows = 20;

  return (
    <div className="tv-root">
      <div className="tv-pad">
        <div className="tv-head">
          <h1 className="tv-title">Lots on the floor now</h1>
          <span className="tv-sub">
            <span className="tv-dot" />
            {liveNow} on the floor · {now}
          </span>
          <div className="tv-clear" />
        </div>

        {error && <p className="tv-err">{error}</p>}

        <p className="tv-setlabel">WAITING</p>
        <div className="tv-board">
          {queue.map((g) => (
            <Column
              key={"q" + g.name}
              group={g}
              kind="queue"
              scaleMs={scaleMs}
              maxRows={maxRows}
              barH={barH}
            />
          ))}
        </div>

        <p className="tv-setlabel">BEING WORKED</p>
        <div className="tv-board">
          {process.map((g) => (
            <Column
              key={"p" + g.name}
              group={g}
              kind="process"
              scaleMs={scaleMs}
              maxRows={maxRows}
              barH={barH}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TvPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Suspense fallback={<div className="tv-root" />}>
        <TvBoard />
      </Suspense>
    </>
  );
}
