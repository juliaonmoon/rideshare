# Business Plan (draft)

## Purpose
Cut the cost of the daily commute drive, with no extra burden on the driver, in a fair system.

## How payment works

Two ways for a rider to pay. Both are capped by the **trip's real operating cost** (this is what keeps us inside BC's carpool rules).

1. **Cash gas-share** – rider pays their share of the trip cost.
2. **Points** – rider spends points earned from earlier rides as a driver.

**Fair split (recommended):** trip cost ÷ (riders + 1 driver).
Example: $10 trip cost → 1 rider pays $5, 2 riders pay $3.33 each, 3 riders pay $2.50 each. Driver's own cost drops from $10 to the same share.

Trip cost = distance × cost-per-km (starts around the ~$0.58/km seen locally; make it a setting and update with fuel prices).

## Points economy (recommended rules)

| Rule | Why |
|---|---|
| Driver **earns** points per passenger-km driven | Rewards giving rides |
| Rider **spends** points = same value as the cash share | 1 point always equals a fixed amount of trip cost |
| Points are **ride-only**, no cash-out, not transferable | Keeps us a cost-sharing app, not a payments business |
| Driver chooses per ride: **cash or points** | Your requirement |
| Points expire after ~12 months | Stops unlimited build-up |
| Zero-sum: points a rider spends = points the driver earns | No inflation — we never "print" points |

Open problem: a driver who never rides has points they can't spend. Options: sponsor rewards (Hytch-style), employer perks, or just let them choose cash. See Open Questions.

## Matching (the core idea)

- Driver enters destination and departure time, sets **max detour (min)** and **max wait (min)**.
- App finds riders where: extra drive time ≤ detour limit **and** pickup time fits the driver's schedule **and** drop-off is near the destination.
- Driver sees a short list: "Alex — +4 min, pickup 8:12, 2 km, you'd get $5 or 5 points" → **Accept / Skip**.
- Recurring commutes: set once, runs every weekday.

## Revenue (options, pick later)

1. **Employer subscription** – companies pay to offer it to staff (Scoop's model); strongest.
2. **Sponsors** – parking, insurers, banks, EV brands pay for reach (Hytch model).
3. **Small platform fee on cash shares** – e.g. 10–15% (gobyRIDE charges 15%); needs legal check.
4. **Government/transit grants** – congestion and emissions programs.

Do **not** take a cut of points.

## Launch plan

1. **Pick one corridor** with a big employer or campus (e.g. Burnaby: BCIT, Metrotown, Discovery Park, SFU Burnaby – examples, not researched).
2. **Pilot with 30–50 commuters** at one employer; test with a spreadsheet/chat before building matching.
3. **Measure:** match rate, rides per week, detour minutes, repeat use, would they pay.
4. Build the MVP only if match rate is healthy; then expand to the next employer.

## Risks

| Risk | Mitigation |
|---|---|
| Not enough users on same route/time (killed Waze Carpool) | Employer-by-employer launch; flexible time windows |
| Insurance / legal | Cost-share cap, ride-only points, lawyer + ICBC check **before** launch |
| Safety / trust | Verified work email, ratings, share-trip link, women-only option |
| Local competitor (gobyRIDE) | Differentiate on driver-first detour control and points |
| Hybrid-work schedules | Flexible/occasional rides, not just fixed 5-day |
| Map API costs | Cache routes; consider Mapbox/OSRM if Google is costly |
