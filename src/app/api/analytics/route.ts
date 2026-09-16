import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { checkPassword, loadSettings, passwordFromRequest } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const key = passwordFromRequest(req);
  if (!(await checkPassword(key))) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const includeDeleted = url.searchParams.get("deleted") === "1";

  let query = supabaseAdmin
    .from("logs")
    .select("*")
    .order("log_date", { ascending: false })
    .limit(20000);

  if (from) query = query.gte("log_date", from);
  if (to) query = query.lte("log_date", to);
  if (!includeDeleted) query = query.is("deleted_at", null);

  let poQuery = supabaseAdmin
    .from("po_logs")
    .select("*")
    .order("log_date", { ascending: false })
    .limit(20000);
  if (from) poQuery = poQuery.gte("log_date", from);
  if (to) poQuery = poQuery.lte("log_date", to);
  if (!includeDeleted) poQuery = poQuery.is("deleted_at", null);

  const [logsRes, poRes, stepsRes, opsRes, settings] = await Promise.all([
    query,
    poQuery,
    supabaseAdmin.from("steps").select("*").order("sort_order"),
    supabaseAdmin.from("operators").select("*").order("name"),
    loadSettings(),
  ]);

  if (logsRes.error) {
    return NextResponse.json({ error: logsRes.error.message }, { status: 500 });
  }

  // Intervals for everything in range, fetched in one go rather than per row.
  const logIds = (logsRes.data ?? []).map((l) => l.id);
  const poIds = (poRes.data ?? []).map((l) => l.id);

  const [logSegs, poSegs] = await Promise.all([
    logIds.length
      ? supabaseAdmin.from("segments").select("*").in("log_id", logIds)
      : Promise.resolve({ data: [] }),
    poIds.length
      ? supabaseAdmin.from("segments").select("*").in("po_log_id", poIds)
      : Promise.resolve({ data: [] }),
  ]);

  return NextResponse.json({
    logs: logsRes.data ?? [],
    poLogs: poRes.data ?? [],
    segments: [...(logSegs.data ?? []), ...(poSegs.data ?? [])],
    steps: stepsRes.data ?? [],
    operators: opsRes.data ?? [],
    rules: settings
      ? {
          work_start: settings.work_start,
          work_end: settings.work_end,
          work_days: settings.work_days,
          timezone: settings.timezone,
        }
      : null,
  });
}
