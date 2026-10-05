# Requirements

Priority: **P0** = MVP, **P1** = soon after, **P2** = later.

## Your requirements (from the brief)

| # | Requirement | Priority |
|---|---|---|
| 1 | Driver enters destination/time; sees route on a map | P0 |
| 2 | App recommends qualified riders near the route; one-tap accept | P0 |
| 3 | Driver sets max detour and max wait; app respects both | P0 |
| 4 | Rider chooses payment: cash gas-share **or** points | P0 |
| 5 | Driver chooses how to be compensated: cash or points | P0 |
| 6 | Price per person falls as more passengers join | P0 |
| 7 | Driver earns points for rides given; spends them when riding | P0 |
| 8 | Google Maps (or equivalent) integration | P0 |
| 9 | Zero added burden on driver (recurring trips, minimal taps) | P0 |

## Suggested additions

| Feature | Why | Priority |
|---|---|---|
| Verified accounts (work email / ID) | Trust and safety | P0 |
| Recurring commute schedule | Biggest convenience win | P0 |
| Cost-share cap (never above real trip cost) | Keeps us legal/insurable | P0 |
| Ride confirmation (QR/code at pickup) + GPS trace | Prevents fake rides and point fraud | P0 |
| Cancellation / no-show rules | Reliability; drivers hate waiting | P0 |
| Ratings and reporting | Safety | P0 |
| Share-my-trip link, emergency button | Safety | P1 |
| In-app chat with hidden phone numbers | Privacy | P1 |
| Women-only / same-company-only matching | Comfort, trust | P1 |
| Insurance guidance screen (what's covered) | Driver confidence | P1 |
| Employer admin dashboard (participation, CO₂, parking saved) | Revenue driver | P1 |
| HOV-lane / parking-perk tie-ins | More driver benefit | P2 |
| Rider-to-driver "I'm running late" auto-update | Convenience | P1 |
| Savings & CO₂ tracker | Engagement | P2 |
| Points anti-abuse (limits, fraud checks) | Protect the economy | P0 |

## Non-functional

- Mobile-first (iOS + Android; a cross-platform framework to start).
- Location privacy: share exact location only during an active ride.
- Works well on a daily-use basis: fast, few taps.
- All pricing, detour defaults, points value and expiry live in **config**, not code.

## Out of scope (for now)
- On-demand, any-time rides like Uber
- Cash-out or transfer of points
- Intercity trips (Poparide's space)
