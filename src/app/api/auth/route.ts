import { NextResponse } from "next/server";
import { checkPassword } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const ok = await checkPassword(body.password ?? null);
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "That password does not match. Try again." },
      { status: 401 }
    );
  }
  return NextResponse.json({ ok: true });
}
