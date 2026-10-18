# Handoff (2026-10-11)

Picking this up in Claude Code on the owner's own computer? Read this first.

## State
- **Planning docs:** done (README, `docs/`). Decisions so far: BC first, non-profit/cost-recovery, points + cash gas-share, staged plan with stop-or-go checks (`docs/STAGED_PLAN.md`).
- **Prototype:** `prototype/` (static HTML/JS, no server). Matching + pricing logic has 9 passing tests (`node prototype/test.js`). Live at https://juliaonmoon.github.io/rideshare/prototype/ (GitHub Pages, repo is public).
- **Google Maps:** supported via the owner's own key, pasted in the page under **Points > Map**. Stored only in that browser's localStorage. **Never commit a key.**
- **Google Cloud project:** `rideshare-mvp-487708`. Key should be restricted to **Maps JavaScript API** and to websites `https://juliaonmoon.github.io/*`. Owner reports the **Map loads per day** quota was set to **300**. Budget `rideshaermvp` ($1/month) emails alerts only.

## Not verified
- Google Maps rendering against the real Google servers has **not** been tested (the build environment had no key and no access). Only a stand-in was tested.
- The quota value and key restrictions were set by the owner in the Google console; not checked by anyone else.
- The page has not been seen on a real phone.

## Test checklist (do in a real browser)
1. Open the Pages URL. Go to **Points > Map**; status should read "Using Google Maps." (If not, note the exact text and any red Console errors.)
2. **I'm driving** tab: default trip should list 10 matching riders (Ellis and Frankie are hidden on purpose: too early, too far). Accept one, tick "Make regular", mark them away for a day and confirm backup riders are suggested.
3. Press **Start trip**: a Google map shows the route and a car moving; status line counts down.
4. **I need a ride** tab: default trip should list 3 drivers. Request one with points; points drop by the shown amount; car moves on the map; **Points** tab shows the entry.
5. Resize to phone width; no horizontal scroll.
6. Confirm the page works with no key (fallback map).

## Road routes (added 2026-10-12)
- With a Google key, the route and car follow real roads using the **Routes API** (one request per distinct route, cached, max 60 per day per browser). Key must allow **Maps JavaScript API** and **Routes API**.
- If Google refuses or the cap is hit, the page falls back to straight lines and Points > Map shows why.
- Not yet verified on a real phone. The car is a simulation, not the phone's GPS.

## One app, real accounts (2026-10-12)
- Pre-launch: there is **one version**. The three tabs (I'm driving, I need a ride, Points) use real Supabase accounts. Signed-out visitors see only the sign-in box.
- Backend: Supabase project `iivhfapvkseeomxtsrxf` (public URL + publishable key in `prototype/config.js`). `supabase/schema.sql` creates tables with RLS on; `supabase/seed.sql` adds 24 made-up people (emails `@example.invalid`, they cannot sign in). Sample drivers never accept seat requests, so use two real accounts to test a full match.
- Logic is in `prototype/live.js`. The old demo code in `index.html` is still there but hidden and unused; remove it in a cleanup pass.
- **Show my location** button (driver and rider maps) uses device GPS; position stays on the device.
- Google sign-in is set up (Google Cloud OAuth client + Supabase provider, done by the owner); email link is the backup.
- **Installable app (PWA, 2026-10-18):** `manifest.webmanifest`, `sw.js` (network-first, same-origin only), icons, and `install.js` (Install banner on Android/Chrome; "Share > Add to Home Screen" tip on iPhone). Chrome's real install prompt was confirmed locally. Not yet confirmed on a real phone. Google sign-in inside an installed app may bounce through the browser.
- Google key is per-browser: paste it again under Points > Map on each device (phone too).
- Known limits: rider's page sends the points amount (server only range-checks it); Supabase's built-in email is rate-limited; no ratings, safety checks or phone GPS; database is in US West, move to Canada before real users.

- Migration 002 (`supabase/migrations/002_points_price_check.sql`) was run on 2026-10-14: the server now rejects a points amount above the fair limit. Checked from outside: `areas` table exists and is hidden from signed-out users; `request_seat` still locked to signed-in users. Not yet exercised with a real signed-in request.

## Rules
- Do not commit API keys or any secrets.
- Keep trading-bot code out of this repo (separate project).
- Docs ship with code changes; update `docs/` when behavior changes.
