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
- **Dates and weekly repeat (2026-10-18, migration 003):** trips and ride requests have a date and optional repeat days (Mon to Sun). Forms follow Uber Reserve / Liftango: date + time, Review then Confirm screen, booking window 30 minutes to 30 days ahead. Date chips pick which day you are viewing; seat requests are per date; new **Upcoming** tab lists my trip, my request, upcoming rides and passengers. Seed people repeat every day. Run order: schema.sql, 002, 003, seed.sql. Cancelling an accepted ride (with a points refund) is not built yet.
- **Cancellations and refunds (2026-10-18, migration 004):** modelled on Uber Reserve (60 min), BlaBlaCar (tiers) and Scoop (one free late cancel a month). Points are HELD when a driver accepts and paid to the driver 3 hours after pickup (settle_due runs when the app loads). Rider cancels >2h before pickup: all points back. Within 2h: first per calendar month forgiven, then the driver keeps half (rounded down). No rider cancel after pickup; driver can mark a no-show after their wait time and keeps all points. Driver cancel: rider fully refunded. Cash rides move no points. Small warning badges (counts only, 30 days) show next to names via the reliability view. Run order: schema, 002, 003, 004, seed. Not built: disputes (driver never shows), push notifications, fees in cash.
- **GPS test page (2026-10-18):** prototype/gps.html (linked from Points > Track yourself). Real device GPS with live speed, distance, time, heading, accuracy, trail and follow-me, plus a Simulate a walk button for desktop. Uses Google Maps if the key is saved on the device, else OpenStreetMap. Location never leaves the device. Needs a real phone walk to confirm accuracy.
- **Ride steps (2026-10-18, migration 005):** the driver taps On my way, Arrived at pickup, Picked up, Dropped off (steps open 2 hours before pickup; skipping forward is fine, going back is not). Points are paid to the driver at Dropped off (3 hours after pickup is the automatic fallback). The rider sees each step live and can tap I am in the car (a confirmation only). After pickup the ride can no longer be cancelled or marked a no-show. The driver gets an Open in Google Maps button (next stop: pickup, then drop-off); stops are neighbourhood centres, not exact addresses. Run each migration ONCE, in order: schema, 002, 003, 004, 005, seed (re-running an older migration after a newer one restores old function versions). Not built: exact pickup spot sharing, push notifications, disputes.
- **Leave now + live tracking (2026-10-19, migration 006):** one-tap Leave now for drivers (server clock, leaves in 5 min, live 30 min) and I need a ride now for riders (ready now, live 20 min); Use my location picks the nearest area. Live trips/requests expire by themselves and are hidden from others when expired. While a driver has a ride in progress their phone shares its position (driver_positions, one latest row, only the riders on that ride can read it, deleted at the end); the rider sees the car, an ETA (straight line x1.35, at least 25 km/h), a not-left-yet warning (position unchanged for 3 min), a lost-signal warning (2 min), and a free full-refund cancel if the driver is wait+10 min late and has not arrived. Web limit: sharing only works while the driver screen is on and RideShare is visible (split screen with Google Maps works). Run order: schema, 002, 003, 004, 005, 006, seed. Run each once.
- **Google Maps key (owner step):** config.js has an empty googleMapsKey. Paste the restricted key there on GitHub so every phone gets the Google map; users never need a key. Keep daily quotas on the Maps JavaScript and Routes APIs.
- **Security and privacy hardening (2026-10-19, migration 007):** abuse limits (20 trips / 20 requests / 15 seat requests per hour, 5 active trips and requests), name cleaning, delete_my_account() (Points tab, type DELETE; refused while an accepted ride is unfinished), helper functions restricted to signed-in users. privacy.html and terms.html are DRAFTS (add a contact email, get a BC lawyer to review before launch). SECURITY.md lists the owner checklist. Audit 2026-10-18: Maps key referrer and API restrictions verified working from outside; Supabase tables locked to signed-out users; no secrets in code history. Owner items done 2026-10-19: Routes API daily quota set to 500, privacy contact email added, Google sign-in screen kept in Testing with the owner added as a test user (other testers use the email-link sign-in with plus-addresses like name+rider1@gmail.com). Owner items still open: delete or restrict the two older API keys that allow 32 APIs; before public launch get a BC lawyer to review privacy.html and terms.html, set the privacy and home links on the Google Branding page, then Publish the sign-in screen; run a two-account ride test. Run order: schema, 002, 003, 004, 005, 006, 007, seed.
- **Android app (2026-10-19, android-app/, migration 008):** Capacitor wrapper that loads the live site and adds a native foreground-service location helper, so the driver can use Google Maps full-screen while RideShare keeps sending the position to the rider. Start my trip now: tells riders On my way, gets a 12-hour tracking token (start_tracking), starts the helper, then opens Google Maps with navigation already started (dir_action=navigate). Verified on a virtual Android 15 phone (background sending, notification, auto-stop). Needs migration 008 (run once). Build needs Java 21 at C:Usersjulesjdk21 (portable Temurin; Java 25 on the machine is too new). Release signing keystore not created yet. Not yet tested on the real Pixel.
- **Installable app (PWA, 2026-10-18):** `manifest.webmanifest`, `sw.js` (network-first, same-origin only), icons, and `install.js` (Install banner on Android/Chrome; "Share > Add to Home Screen" tip on iPhone). Chrome's real install prompt was confirmed locally. Not yet confirmed on a real phone. Google sign-in inside an installed app may bounce through the browser.
- Google key is per-browser: paste it again under Points > Map on each device (phone too).
- Known limits: rider's page sends the points amount (server only range-checks it); Supabase's built-in email is rate-limited; no ratings, safety checks or phone GPS; database is in US West, move to Canada before real users.

- Migration 002 (`supabase/migrations/002_points_price_check.sql`) was run on 2026-10-14: the server now rejects a points amount above the fair limit. Checked from outside: `areas` table exists and is hidden from signed-out users; `request_seat` still locked to signed-in users. Not yet exercised with a real signed-in request.

## Rules
- Do not commit API keys or any secrets.
- Keep trading-bot code out of this repo (separate project).
- Docs ship with code changes; update `docs/` when behavior changes.
- **Settings (2026-10-19, migration 009):** new Settings tab with separate Driver and Rider sections (defaults for new trips/requests, seats, auto-accept with seat cap, ride style tags). DB: `user_settings`, `ride_styles()`, and an after-insert trigger on `matches` for auto-accept. Run `supabase/migrations/009_settings.sql` once. Benchmark notes: docs/BENCHMARK.md.
