# Rider's view: requirements (DRAFT by Claude, 2026-11-09; Jules to edit)

## Why the rider side exists
- The app is **driver-first**. A driver is already making a trip. A rider shares the cost and gets a convenient ride on the way.
- Not a business: nobody profits. Points or cash are a **share of the driver's cost**.
- The rider's job is to **fit the driver's trip**, never to make the driver go out of the way.
- The rider's reward is **convenience**: few taps, clear expectations, honest times, and a fair way out.

## Requirements (status: BUILT / PARTLY / GAP; check = verify in the app)
### A. Ask for a ride
1. Ask in under 30 seconds: pickup, drop-off, "now" or a time window, how to pay (points or cash). **BUILT** (check: count the taps).
2. Search any address in Canada and the USA; the exact address is used. **BUILT**.
3. A regular commute (same ride every week) set up once. **BUILT** ("regular booking").
4. A rider cannot be booked on two rides at the same time. **GAP** (drivers are protected; riders are not).

### B. Choose a driver
5. See only drivers who really fit (route, time, detour limit). Drivers who don't fit are hidden. **BUILT**. Check: when nothing fits, tell the rider why and what to change.
6. Each driver shows what a rider needs to decide: pickup time, car, photo, "N rides done", warnings, price. **BUILT**.
7. The price is the rider's share of the driver's cost, in plain words, never above the fair limit. **BUILT** (server refuses an unfair price). Check: wording on screen.
8. Before booking, show "Cancel free until HH:MM". **BUILT** (on a booked ride; check it also shows before asking).

### C. Wait for an answer
9. A clear status (waiting, accepted, declined), and a phone alert when the driver answers. **PARTLY** (check the rider-side alerts).
10. If declined or no answer, offer the next best driver or keep the request open. **GAP** (check).
11. Automatic acceptance for drivers who choose it. **BUILT**.

### D. Meet the driver
12. Exact pickup spot, meet-spot note, car, plate, and live car on the map with an arrival time. **BUILT**.
13. "Your driver is about N min late" at 2 minutes, with "keep or cancel for free" at 3. **BUILT in the app**; phone push alert **GAP** (needs an Android build).
14. "Driver did not arrive" free cancel at 3 minutes late. **BUILT**.
15. Share trip details with someone you trust. **BUILT**. Emergency button **GAP** (backlog P1).

### E. Cancel
16. Always possible; free before the driver's detour starts; after that the driver keeps the points. **BUILT** (docs/CANCELLATION_POLICY.md).
17. The seat reopens at once for other riders. **BUILT**.

### F. After the ride
18. Confirm drop-off, see what it cost, and see it in the points history. **BUILT** (check the wording).
19. Say thanks or report a problem. **PARTLY** ("Report a problem" exists; no thumbs-up or rating).
20. Rider's record builds ("N rides done"). **BUILT**.

### G. When there is no match
21. "Tell me when a driver posts a trip that fits" (alert for a saved request). **GAP** (check what a waiting request does today).
22. A fallback such as transit directions. **GAP** (backlog idea).

### H. Needs and comfort (later)
23. Accessibility needs, luggage, service animals, quiet ride, women-only (needs legal review). **GAP** (backlog).

## Questions for Jules
1. One request to many drivers at once, or pick one driver at a time?
2. After a ride, do you want a simple thumbs up/down for the driver?
3. When no driver fits, should the app keep watching and alert the rider when one appears?
4. What bothers you most on the rider side today?

## Decisions from Jules (2026-11-10)
1. **Many drivers at once.** A request goes to every driver whose route fits. The first to accept gets the ride. The others see "no longer available".
2. **Thumbs up only, no public thumbs down.** A driver's thumbs-up total shows on their profile. A rider can send a private "something went wrong" note that only the team sees.
3. **Matching is continuous.** No separate "keep watching" feature. The rider just gets a phone alert when a match appears later.
4. **Biggest rider pain: driver late, no-show, last-minute cancel.**
5. **"On time" = within 3 minutes of the latest agreed pickup time** (not the original time).
6. **New pickup time flow.** Both people are told. The rider gets Accept / Decline (decline = free cancel if 3+ min later than agreed). No answer counts as OK for changes up to 15 minutes; bigger delays need a real answer or the ride cancels free after a while. Record "rider did not answer".
7. **Two kinds of lateness.** Controllable (driver started late versus planned time, or stopped/off route for several minutes) counts against the driver. Traffic while moving does not. First version: count late start and long stops only; driver may add a short note.
8. **Driver stats shown:** thumbs up, on-time %, late cancels, and how often the driver changed the pickup time (Jules wanted to think about this one).
9. **Accountability:** poor record ranks lower in matching; 3 marks in 30 days = warning; a person reviews any pause. No fines (points are not money).

## DECIDED (Jules, 2026-11-11): public vs private stats
- **Public:** thumbs-up total, on-time %, late-cancel count. Riders need these to choose.
- **Private (team only):** "changed pickup time" count, stopped/off-route events, private rider notes, warnings. These are noisy and easy to misread, so use them for ranking and review, not for display.