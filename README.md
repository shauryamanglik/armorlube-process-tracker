# Armorlube Process Tracker

Queue and process time logging across the nine steps of the finishing line, built
for iPads on the floor with a password-gated analytics hub.

## What goes where

```
sql/migration_02.sql        Run this in Supabase before the app will work
src/lib/supabase.ts         Browser client
src/lib/supabaseAdmin.ts    Server client, service role, never import in a component
src/lib/guard.ts            Password check shared by the API routes
src/lib/types.ts            Shared types and the lot number pattern
src/lib/time.ts             Working-hours duration maths, Tucson timezone
src/lib/analytics.ts        Turns raw logs into per-step and per-area numbers
src/lib/offline.ts          Parks writes in localStorage when wifi drops
src/app/page.tsx            Station picker, including split screen
src/app/log/page.tsx        The logging screen
src/app/dashboard/page.tsx  Analytics, raw data, settings
src/app/api/*               Server routes that hold the password
src/components/*            Logging panel, edit modal, charts
```

## Install

From the project root:

```bash
npm install lucide-react recharts
```

Then copy the `src` folder from this bundle over the one in your project, and
drop `sql/` alongside it.

## Environment

`.env.local` needs a third line added:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

The service role key is in Supabase under Project Settings, API, below the anon
key. It bypasses row level security, so it stays server-side only. Add the same
three to Vercel under Settings, Environment Variables.

## Database

Run `sql/migration_02.sql` in the Supabase SQL editor. It adds soft delete, a
notes field, the settings table, indexes, and an updated_at trigger.

One policy is missing from the first script and is not in the migration on
purpose, because it changes who can remove data. Deletes in this app are soft
deletes, handled by the existing update policy, so nothing extra is needed.

## How time is counted

Operators log wall-clock times and never think about shifts. The maths happens
in the dashboard.

By default a duration only counts minutes that fall between the shift start and
end on a working day, so a lot queued at 2pm Friday and pulled at 8am Monday
reads as 2h 30m rather than 66 hours. Any record whose span crosses a shift
boundary is flagged, and the dashboard toggle switches every number to raw
elapsed time so the excluded hours can be seen.

Shift hours and working days are editable in dashboard settings. Arizona does
not observe daylight saving, so the timezone maths uses a fixed UTC-7.

## Step behaviour

Outgoing Sand Blast records queue time only. Wash records process time only.
Blasting asks for Manual or Auto. The rest record both queue and process. These
are columns on the `steps` table, so a step can be changed without touching code.

## Security note, read this

The dashboard password is checked on the server and never sent to the browser.
Analytics and settings requests are rejected without it.

The logging screens use the public anon key, which is visible to anyone who
opens developer tools on an iPad. Row level security limits that key to reading
and writing log rows, which is what the screens need, but it does mean someone
technical on your network could query the raw log table directly without the
dashboard password. For an internal shop-floor tool that is a reasonable trade.
If it ever needs to be tighter, the fix is routing the logging reads and writes
through server routes as well.

## Deploy

```bash
git add .
git commit -m "Process tracker"
git push
```

Vercel builds on push. Open the deployment URL on each iPad, pick the station,
and add it to the home screen so it opens without browser chrome.
