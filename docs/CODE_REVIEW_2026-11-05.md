# Code review: flexible trip window (PRs #150-#155)

Scope: prototype/live.js, supabase/migrations/042_flexible_trip_window.sql, 043_test_requests_for_flexible_trip.sql.
Note: the shell tool failed in this session, so git history was not available. I reviewed the current files, not the per-commit diffs.
Nothing was edited or committed.

## Findings (most severe first)

1. MEDIUM - 042 / _freeze_booked (025_booking_integrity.sql:142) does not freeze flex_from, flex_to or flex_locked.
   Defect: the "booked trip cannot be reshaped" trigger was not extended to the new columns.
   Scenario: a driver with an accepted rider sends a direct trips update through the API setting flex_locked=false (or adding flex_from/flex_to to a normal trip). _quote_trip then uses flex_from as the leave time (042:40-41) instead of depart_min. The trip's real time shown to new requesters and the leave-by calculations no longer match what the accepted rider was promised.
   Fix: add flex_from, flex_to, flex_locked to the frozen tuple. Let only the SECURITY DEFINER paths (_respond_match lock, _flex_unlock) change them, e.g. via the existing app.cancel_ok-style setting or an extra setting.

2. MEDIUM - live.js:969 (and label at 969 / relabel at 1227). Editing a LOCKED flexible trip overwrites its leave time.
   Defect: the time box is pre-filled with flex_from whenever flex_to is not null, even when flex_locked is true (the window box is hidden then).
   Scenario: driver accepts a rider (trip locks at 8:40, window 7:00-10:00), opens Edit to change only the pickup limit, taps save. depart_min is sent as 7:00. The _freeze_booked trigger rejects it with "route, time and payment can no longer be changed". The driver cannot change anything on the trip, and the label wrongly says "Earliest I can leave".
   Fix: when flex_locked, pre-fill depart_min and label "Leave at" (or lock the time field); never send depart_min for a locked trip.

3. MEDIUM - 042:335-338 (_flex_unlock) race with a concurrent accept.
   Defect: the "no accepted rider left" check runs on a snapshot taken before waiting for the trip row lock.
   Scenario: rider A (only accepted rider) cancels at the same moment driver accepts rider B. B's _respond_match holds the trip row lock. A's trigger waits, then updates the trip using its old snapshot, which does not see B as accepted. Result: trip unlocked and depart_min reset to flex_from while B is accepted. (The freeze trigger may then raise and fail A's cancel, or B ends up on an unlocked trip.)
   Fix: lock the trip row first (select ... for update) in the trigger, then run the exists check in a separate statement.

4. LOW/MEDIUM - 042:47-50 (_quote_trip, first-rider leave time).
   Defect: pickup drive time (foff) is measured at the earliest possible time lo, but the car actually leaves at depart = ceil(ready_from - foff), which can be later (rush hour is slower or faster).
   Scenario: rider ready 8:30-9:00, foff at 7:00 is 20 min so depart=8:10; at 8:10 traffic makes the drive 30 min, arrival 8:40 is fine; but if the drive is shorter at 8:10 (e.g. 12 min) the driver arrives 8:22, 8 minutes early, beyond the 5-minute wait. The server may then reject with 'fit' and the driver sees a request that looked fine in the card. Also the ready_to check uses foff at lo, not at depart.
   Fix: recompute foff at depart and re-check (iterate once or twice), or check both ready_from and ready_to against the time-of-day drive at depart.

5. LOW/MEDIUM - 042:208-210 (_reachable for locked flex trips).
   Defect: for a locked flex trip, a pending request is judged only by the fixed plan time, not by "now". A request whose ready window has already ended, because the driver did not leave on time, still shows.
   Scenario: trip locked at 8:00, driver still home at 9:40; a new request ready 8:30-9:00 arrives. _quote_trip uses depart_min=8:00 so it says OK. Product rule says unreachable requests must not be shown (drivers may be late, riders must be on time). Existing scheduled trips had the same gap by design (037 says "scheduled trips are always reachable"), but flex trips now advertise this as a hard rule.
   Fix: for locked flex trips on today's date use depart = greatest(depart_min, vnow + 2) in the reachability quote only.

6. LOW - 042:316-319 and 042:262-266 performance. driver_alerts_token calls _detour_fits, _reachable (a full _quote_trip) and _leave_json (another _quote_trip) for every requested match, every phone poll. For flex trips each is a route search. With up to many pending requests this multiplies per poll.
   Fix: compute the quote once per row (lateral join), or cache in matches.

7. LOW - live.js:1084 (Trips tab), 258, 343, 367, 376: use whenText(...depart_min) directly. For an unlocked flex trip depart_min is flex_from, so the card says "8:00 am, one time" instead of "any time between". Stale label; tripWhen() exists and is not used there.

8. LOW - live.js:1255-1256. When the window is switched off on an edit, only flex_from/flex_to are nulled. This works because flex_locked is false there, but if the window is switched off while an accepted rider exists the form is hidden (locked) so this path is not reachable from the UI; via the API it is allowed (see finding 1).

9. LOW - live.js:46-49 flexDepart uses the device clock (new Date().getHours()) for "now", while the server uses America/Vancouver. A rider or driver with a phone in another time zone sees different fits than the server accepts. Pre-existing pattern (also lines 569, 637) but now affects flexible fits.

10. LOW - 043 (test data). The script picks the newest flex trip of ANY user, not only a test account's trip, and `on conflict ... do update set status = 'requested'` resets an already accepted test match. Run by hand in the SQL editor so exposure is low, but running it while a real driver's open flex trip is the newest would add made-up requests to that real driver.
    Fix: limit the trip to test accounts (join public.test_accounts) and do not reset accepted matches.

## Checked and found OK
- Repeat trips cannot get a window: check constraint trips_flex_window_ok blocks repeat_days and requires flex_from>=0, flex_to<=1439, flex_to>flex_from; client also blocks it (live.js:65).
- Accept race (two accepts at once): _respond_match locks the match then the trip row, and the second accept re-reads the locked trip. Fine.
- Lock update vs _freeze_booked: the lock is written before the match becomes accepted, so the freeze trigger does not block it. The unlock trigger's update also passes (no accepted rider left).
- Completed riders keep the trip locked (trigger counts accepted and completed).
- New functions are revoked from public/anon/authenticated; only driver_alerts_token (token-gated) is granted. No private data leaks beyond what the driver already sees.
- House numbers: the plan shows only stored labels and rounded coordinates (live.js:578-586); Open on map uses the stored point, no new address data is stored.
- Arrive-by math (live.js:62): uses the largest allowed total detour (worst case) and floors the minutes, so the driver arrives on time; the 5 min server wait (025 _fixed_wait) is not included in that allowance (small).

## Verdict
Changes required: fix 1 and 2 (real user-visible failure and a gap in booking protection) and consider 3. The rest can follow.
