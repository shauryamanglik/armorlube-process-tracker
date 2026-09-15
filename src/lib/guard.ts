import { supabaseAdmin } from "./supabaseAdmin";
import type { WorkRules } from "./types";

export type SettingsRow = WorkRules & { dashboard_password: string };

export async function loadSettings(): Promise<SettingsRow | null> {
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("dashboard_password, work_start, work_end, work_days, timezone")
    .eq("id", 1)
    .single();
  if (error || !data) return null;
  return data as SettingsRow;
}

/** Compare a submitted password against the stored one. */
export async function checkPassword(candidate: string | null): Promise<boolean> {
  if (!candidate) return false;
  const settings = await loadSettings();
  if (!settings) return false;
  return settings.dashboard_password === candidate;
}

/** Read the password a client sent with a request. */
export function passwordFromRequest(req: Request): string | null {
  return req.headers.get("x-apt-key");
}
