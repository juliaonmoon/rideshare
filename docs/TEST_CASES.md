# Test cases for the 2026-11-09 changes (#161 to #167, migrations 055 to 061)

Result key: **AUTO PASS** = a script ran it and it passed. **MANUAL** = a person has to tap it on the phone (steps given). Updated 2026-11-10 by Claude.

## What changed on 2026-11-09
| # | Change | SQL | Version |
|---|---|---|---|
| 1 | No double booking for drivers (same day, repeating dates, time windows) | 055 | #151 |
| 2 | Address search for all of Canada and the USA; any place accepted, exact address shown | none | #152 |
| 3 | Trips filters (passengers, status, type, when) and collapsed trip groups | none | #153-#160 |
| 4 | Review fixes: far places no longer blank the field; "Use my location" town name; passengers filter ignored on Riding; "No passengers" keeps repeating trips with a free date | none | #161 |
| 5 | Double booking also covers trips past midnight | 057 | |
| 6 | Reliability record: "N rides done" / "New member" next to names | 058 | #162 |
| 7 | New cancel rule: free until the driver's detour starts (min 3 min); after that the driver keeps all the points | 059 | #163, #164 |
| 8 | Late-driver heads-up: "about N min late" from 2 min; keep-or-cancel at 3; free cancel while predicted 3+ min late | 060 | #165 |
| 9 | "Driver did not arrive": rider cancels free when the driver is 3+ min past pickup and has not arrived | 061 | #166 |
| 10 | Route reset after a rider cancels: "Update route in Google Maps" button; Android alert "<Name> cancelled" | none | #167 + Android build |

## How to run the automatic tests
- Database tests (need the PGlite folder): `node tests/db/run55.mjs` (and 57, 58, 59, 60). Lines starting "FAIL load 043/052" are expected noise.
- App tests: `node prototype/test.js`.
- Phone/live checks (phone on a USB cable): `tests/phone/phone_checks.js` through the Chrome debug link.
- Android alert on the emulator: `tests/android/fake_server4.mjs` (fake database), see the steps in that file's comments and docs/CANCELLATION_POLICY.md.

## Cases
### 1 and 5. Double booking (tests/db/run55.mjs: 14 checks, run57.mjs: 7 checks) **AUTO PASS 21/21**
- DB-1 first trip 8:00 saves. DB-2 a second trip 8:30 same day is refused with the other trip's name. DB-3 same time another day is fine. DB-4 evening same day is fine. DB-5 a time window covering 8:00 is refused. DB-6 a repeating trip with one clashing date is refused. DB-7 the same repeating trip at 15:00 is fine. DB-8 editing into a clash is refused; editing to a free time is fine; changing a rule (not the time) is never blocked. DB-9 changing one repeat date into a clash is refused. DB-10 cancelling the first trip frees the time. DB-11 another driver can drive at the same time.
- DB-12 (past midnight) 23:30 then 00:10 next day is refused; 07:00 next day is fine; the reverse order is refused; 20:00 the day before is fine; another driver is fine.
- Not covered: riders booking two rides at the same time (not built).

### 6. Reliability record (run58.mjs: 3 checks) **AUTO PASS 3/3**
- RL-1 the view has rides_as_rider, rides_as_driver, driver_late_cancels. RL-2 a new member counts zero. RL-3 a finished ride counts once for the rider and once for the driver.
- Live database check on the phone: the view returns the new columns **AUTO PASS**.
- MANUAL: next to a driver's/rider's name a green "N rides done" or grey "New member" shows, then the orange 30-day warnings.

### 7 and 9. Cancel rules (run59.mjs: 10 checks) **AUTO PASS 10/10**
- CX-1 60 min before pickup, 5 min detour: free, all points back. CX-2 3 min before pickup, 5 min detour: the driver keeps all the points; shows as a late cancel. CX-3 1 min detour uses the 3 min minimum: 4 min before pickup is still free. CX-4 2 min before pickup, 1 min detour: driver keeps all. CX-5 driver 10 min late and not arrived: free, all points back, driver-late mark. CX-6 3 min past pickup, not arrived: "driver did not arrive", free. CX-7 2 min past pickup: rider should wait; driver keeps all. CX-8 driver tapped Arrived, rider cancels later: allowed, driver keeps all. CX-9 driver cancels: rider gets everything back. CX-10 the driver's wallet got exactly the kept points.
- MANUAL on the phone (use test mode): a booked ride shows "Cancel free until HH:MM"; cancelling before that says free; after it says the driver keeps the points; when 3+ min past pickup the button reads "Driver did not arrive"; after cancelling, the history shows "driver did not arrive" or "cancelled".

### 8. Late-driver heads-up (run60.mjs: 6 checks) **AUTO PASS 6/6**
- LH-1 driver next to pickup with 30 min to go: on time (zero or negative). LH-2 a stranger gets nothing. LH-3 driver far away and pickup in 1 min: predicted 3+ min late. LH-4 rider cancels while predicted late: free, all points back, no mark on the driver. LH-5 no live position: no estimate. LH-6 without an estimate the normal rule applies.
- Live database check on the phone: pickup_eta exists **AUTO PASS**.
- MANUAL: while the driver drives to the pickup, the rider sees "Your driver is about N min late (an estimate)" from 2 min and "Keep this ride, or cancel for free?" from 3 min; "Keep ride" hides the question; doing nothing keeps the ride.

### 10. Route reset
- Android alert on the emulator (fake database): **AUTO PASS 3/3**: a rider cancels with another rider left: "Sam cancelled. Tap to update Google Maps with the stops that are left"; the last rider cancels: "Lee cancelled. ... go straight to your destination"; a pickup or drop-off still says "Your stops changed" (not a cancel).
- Web button: the strings are in the live app **AUTO PASS**. MANUAL: as the driver, a rider cancels, the notice "A rider cancelled" shows an "Update route in Google Maps" button that opens Maps with the stops left.
- MANUAL on a real phone (not done yet by Claude): accept a test rider, start the trip, cancel as the rider, confirm the phone alert and what Google Maps shows. Known limit: Google Maps ignores a new route while it is navigating (exit navigation first); Android needs the driver's tap.

### 2 to 4. Search and Trips list (manual; the app tests pass 27/27)
- SR-1 Post a trip, type "Bellevue Square", pick it: "Exact spot: <street address> . Neighbourhood: ..." shows and the trip saves. SR-2 same for a BC address and a Seattle address in both "Post a trip" and "Schedule a ride" (the place box must not go blank). SR-3 "Use my location" names the real town.
- TL-1 Trips tab: Upcoming/Past/All, Filters: Passengers, Showing, Status, Type; no error popup; Clear filters resets. TL-2 Showing = Riding hides the Passengers box and ignores it. TL-3 "No passengers" keeps a repeating trip that has a free date. TL-4 a repeating trip is one row with a triangle that opens its dates (collapsed by default).

## Phone/live checks run 2026-11-10 **AUTO PASS**
App version #167; signed in; pickup_eta installed (060); reliability view has the new columns (058); cancel_ride exists; all seven new texts are in the live app. The exact 059/061 rule can only be proven by the database tests above (the live function text cannot be read from the phone).

## Still unproven
Real-phone cancel and route reset; phone push for the late heads-up (not built); rider double booking (not built).
