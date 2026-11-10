# Status (keep this to one page)

Last updated: 2026-11-09 by claude

## Where we are
- App version #167 live. SQL run by Jules through 061. The Android app with the new "<Name> cancelled" route alert is built and tested on the emulator, but not yet installed on Jules' phone.
- Built this week: no double booking (incl. past midnight), Canada+USA address search, Trips filters, reliability record ("N rides done"), new cancellation policy (docs/CANCELLATION_POLICY.md), "Driver did not arrive" at 3 minutes late, late-driver heads-up, route-reset button and Android alert after a rider cancels.

## Waiting on Jules
- Rider's view requirements (in Jules' own words). Claude then writes docs/RIDER_VIEW.md and compares with the app.
- Plug in the phone and say "update my phone" to install the new Android app.

## Next ideas (not started, need Jules' OK)
- Riders double booking.
- Phone push alert for the "driver about N min late" heads-up (needs an Android build).
- Items from the ChatGPT review: see docs/BACKLOG.md.

## Decisions by Jules
- Exact addresses stay. No hiding addresses or public pickup points for now.
- Adults only (18+). Points: no buying/refunding/cash-out for now.
- Cancelling: always allowed; free until the driver's detour starts (pickup time minus detour minutes, at least 3); after that the driver keeps all the points; driver 3+ minutes late and not arrived = rider cancels free ("Driver did not arrive").
- Hands-free: Claude assumes the SQL ran and finds out by building/testing.
- Backlog lives in docs/BACKLOG.md.