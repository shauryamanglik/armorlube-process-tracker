import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client. The service role key bypasses row level security, so
 * this must never be imported into a component that runs in the browser.
 * It is used by the API routes to read the settings table, which the public
 * key deliberately cannot touch.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
