# Cancellation policy (agreed with Jules, 2026-11-09)

Principle: RideShare is **driver-first**. The driver is already making the trip; the rider is a side benefit that shares the cost. Nobody is locked in. Cancelling is always possible; the only question is whether the points come back.

## Rider cancels
| When | Result |
|---|---|
| Request not accepted yet | Free. No points move. |
| Accepted, **before the driver's detour starts** | Free. All points back. The seat opens again straight away for other qualified riders. |
| Accepted, **after the detour has started** (or after the pickup time) | Allowed. The driver keeps **all** the points (their time is already spent; Jules' decision 2026-11-09). Shows as a "late cancel" on the rider's record. Cash rides: no points, still on the record. |
| Driver is **5+ minutes past the pickup time** and has not arrived | Free. All points back. Shows on the **driver's** record ("driver late"). |
| Rider already picked up | Cannot cancel. |

**Detour start** = pickup time minus the minutes this rider adds to the driver's trip, **never less than 3 minutes**. Example: pickup 10:03, detour 5 min: free until 9:58. The app shows "Cancel free until 9:58" on the ride. (The app cannot see exactly where the driver is; it uses the detour minutes agreed at booking.)

## Driver cancels
Rider gets all points back. Shows on the driver's record ("cancelled rides"). A cancel within 2 hours of pickup also counts as a late driver cancel.

## Rider does not show
When the driver has arrived and the pickup time has passed, the driver can close the ride as a **missed pickup** and keeps the points. Shows on the rider's record.

## After a rider cancels (driver side) - to build / verify
- The driver is told right away (in-app notice, plus phone alert in the Android app).
- The driver's route must reset to the original destination or next stop. The Android app already shows an "Update route" alert when the set of stops changes; tapping it opens Google Maps with the new stops. Needs a real-phone test for a cancelled rider.

## Heads-up when the driver will be late - built (#165, migration 060)
- Predicted 1+ minutes late: the rider sees "Your driver is about N min late" (an estimate).
- Predicted 3+ minutes late: the notice asks "Keep this ride, or cancel for free?". Doing nothing keeps the ride.
- While the estimate says 3+ minutes late, cancelling is free (all points back) and is not a mark against the driver.
- The estimate comes from the driver's live position (only while they share it, so only after "On my way"/Leave now) and is shown as "about".
- The in-app notice appears while the app is open (it refreshes every 15 seconds). A phone push alert for it, and the older Android "running late" alert (which still says 15 minutes), need an Android app update: see BACKLOG.
- Booking help says: "RideShare is not a taxi..."

## Record shown next to names
"N rides done" or "New member", plus warnings for the last 30 days: late cancels, missed pickups, driver cancels.
