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

## Live mode (beta, added 2026-10-12)
- New **Live (beta)** tab: email sign-in link, post a real trip or ride request, drivers/riders matched with the same matching code, seat requests accepted/declined, points moved by the database (never by the page).
- Backend: Supabase project `iivhfapvkseeomxtsrxf` (public URL + publishable key in `prototype/config.js`). Setup SQL: `supabase/schema.sql` (already run). RLS is on for every table. Only area names are stored, never addresses.
- Known limits: rider's page sends the points amount (server only range-checks it); Supabase's built-in email is rate-limited, so use few test sign-ins or add custom SMTP; no ratings, no safety checks, no GPS.
- Two-person test needed: two accounts (two emails). Not yet tested end to end.

## Rules
- Do not commit API keys or any secrets.
- Keep trading-bot code out of this repo (separate project).
- Docs ship with code changes; update `docs/` when behavior changes.
