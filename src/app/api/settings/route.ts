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
  const settings = await loadSettings();
  if (!settings) {
    return NextResponse.json({ error: "Settings not found" }, { status: 500 });
  }
  const { dashboard_password, ...safe } = settings;
  void dashboard_password;
  return NextResponse.json(safe);
}

export async function POST(req: Request) {
  const key = passwordFromRequest(req);
  if (!(await checkPassword(key))) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  let body: {
    work_start?: string;
    work_end?: string;
    work_days?: number[];
    new_password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  const hhmm = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (body.work_start !== undefined) {
    if (!hhmm.test(body.work_start)) {
      return NextResponse.json(
        { error: "Shift start must look like 07:00." },
        { status: 400 }
      );
    }
    patch.work_start = body.work_start;
  }
  if (body.work_end !== undefined) {
    if (!hhmm.test(body.work_end)) {
      return NextResponse.json(
        { error: "Shift end must look like 15:30." },
        { status: 400 }
      );
    }
    patch.work_end = body.work_end;
  }
  if (body.work_days !== undefined) {
    if (!Array.isArray(body.work_days) || body.work_days.some((d) => d < 0 || d > 6)) {
      return NextResponse.json({ error: "Working days are invalid." }, { status: 400 });
    }
    patch.work_days = body.work_days;
  }
  if (body.new_password !== undefined && body.new_password !== "") {
    if (body.new_password.length < 6) {
      return NextResponse.json(
        { error: "Use at least 6 characters for the password." },
        { status: 400 }
      );
    }
    patch.dashboard_password = body.new_password;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, changed: false });
  }

  const { error } = await supabaseAdmin
    .from("app_settings")
    .update(patch)
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    changed: true,
    passwordChanged: patch.dashboard_password !== undefined,
  });
}
