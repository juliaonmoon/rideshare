I read the brief and opened all eight images.

**Your proposed split is right: Home = what needs my attention now or next. Trips = everything scheduled, plus history.** Trips should not become history only.

I would change one part of your idea: **put the map and full plan on one Trip details page, rather than on Home.** Home should give you a clear next action and a shortcut to that page.

The screenshots show why Home feels long: the trip introduction, repeating schedule, map, date selection, costs, requests and riders are all stacked together. On Riding, the booking form takes the first screen even when an existing ride may matter more.

**One place for the plan**

Every dated trip gets a Trip details page. Open that same page from Home, the calendar or the list.

It holds:

- That day’s departure or pickup time.
- The route map and pickup stops.
- Cost share.
- Confirmed riders.
- Seat requests and Accept / Decline controls, visible to the driver.
- Edit and cancellation controls appropriate to the person viewing it.

Home can repeat a **small summary**—time, route and status—without repeating the plan. Think of it as a doorway.

A repeating schedule produces individual trip days. “Sunday’s trip” has its own riders, requests and time, even when it belongs to the same repeating schedule.

**Two layout options**

These are narrow phone layouts, ordered from top to bottom. Driving and Riding examples show how the same structure changes with the person’s next trip.

**Option A — Next up + calendar. My recommendation.**

Home combines driving and riding. No role switch hides the other half of someone’s day.

```text
HOME — next activity is driving
┌────────────────────────────────┐
│ Home                           │
│                                │
│ Needs your answer              │
│ 2 seat requests · 2 trips     › │
│                                │
│ Next up · Driving              │
│ Today · Leave 7:40 am           │
│ Surrey → Richmond Centre       │
│ 2 riders confirmed             │
│                                │
│ [         Start trip         ] │
│ [        View details        ] │
│                                │
│ Coming up                      │
│ Tomorrow · 8 am · Riding     › │
│ Sun 15 · 7:40 am · Driving   › │
│ View all trips               › │
│                                │
│ [        Ask for a ride       ] │
│ [Post a trip] [Offer ride now] │
│                                │
│ Home     Trips    Points    Me │
└────────────────────────────────┘
```

```text
HOME — next activity is riding
┌────────────────────────────────┐
│ Home                           │
│                                │
│ Next up · Riding               │
│ Today · Pickup 8:10 am          │
│ Home → Waterfront              │
│ Driver: Alex · Confirmed       │
│                                │
│ [        View your ride       ] │
│                                │
│ Coming up                      │
│ Tomorrow · 7:40 · Driving     › │
│ View all trips               › │
│                                │
│ [        Ask for a ride       ] │
│ [Post a trip] [Offer ride now] │
│                                │
│ Home     Trips    Points    Me │
└────────────────────────────────┘
```

Show “Needs your answer” only when something is waiting. A cancelled rider booking that needs a replacement driver also appears here, with a clear recovery action.

Trips uses one calendar for both roles:

```text
TRIPS — shared driver/rider view
┌────────────────────────────────┐
│ Trips                    [ + ] │
│ [Upcoming]              [Past] │
│ All ▾          Calendar | List │
│                                │
│       ‹  November 2026  ›       │
│ Mon Tue Wed Thu Fri Sat Sun    │
│          [month grid]          │
│       D = Drive  R = Ride      │
│                                │
│ Sunday, November 15            │
│                                │
│ 7:40 am · Driving              │
│ Surrey → Richmond Centre     › │
│ 2 riders · 1 request           │
│                                │
│ 5:15 pm · Riding               │
│ Richmond Centre → Surrey     › │
│ Alex · Confirmed               │
│                                │
│ Home     Trips    Points    Me │
└────────────────────────────────┘
```

“All ▾” offers **All / Driving / Riding**. Default to All. Selecting a day shows only that day’s trips below the calendar; it does not load every upcoming trip underneath.

In List view:

```text
┌────────────────────────────────┐
│ Trips                    [ + ] │
│ [Upcoming]              [Past] │
│ All ▾          Calendar | List │
│                                │
│ Today                          │
│ 7:40 · Driving · Surrey → …   › │
│ 5:15 · Riding · Richmond → … › │
│                                │
│ Tomorrow                       │
│ 8:00 · Riding · Home → …      › │
│                                │
│ [       Show more days        ]│
└────────────────────────────────┘
```

Start with the next three **days containing trips**. “Show more days” expands the list. Calendar remains the easiest way to jump further ahead.

**Why I recommend A:** it shows the person’s whole day, gives requests a visible place, and keeps the full plan one tap away. Ten repeating dates no longer make Home longer.

**Option B — Separate Driving and Riding views**

This keeps your existing role switches and may feel more familiar.

```text
HOME
┌────────────────────────────────┐
│ Home                           │
│ [Driving]             [Riding] │
│                                │
│ 2 requests waiting           › │
│                                │
│ Next drive                     │
│ Today · 7:40 am                │
│ Surrey → Richmond Centre       │
│ [         Start trip         ] │
│ [        View details        ] │
│                                │
│ [Post a trip] [Offer ride now] │
│ All drives                   › │
│                                │
│ Home     Trips    Points    Me │
└────────────────────────────────┘
```

In Riding, replace the middle with:

```text
│ Next ride                      │
│ Today · Pickup 8:10 am          │
│ Alex · Confirmed               │
│ [        View your ride       ]│
│ [        Ask for a ride       ]│
│ All rides                    › │
```

```text
TRIPS
┌────────────────────────────────┐
│ Trips                          │
│ [Driving]             [Riding] │
│ [Upcoming]              [Past] │
│ Calendar | List                │
│                                │
│         [month grid]           │
│                                │
│ Selected day's drives/rides    │
│ Time · Route · Status        › │
│                                │
│ Home     Trips    Points    Me │
└────────────────────────────────┘
```

This works, but someone who drives in the morning and rides home must check both views. Requests in the hidden role are easier to miss. It also keeps more switches above the useful content. **I would choose A.**

**What Trip details looks like**

Both layout options lead here:

```text
TRIP DETAILS — driver
┌────────────────────────────────┐
│ ‹ Back             Trip details│
│ Sun Nov 15 · Driving           │
│ Leave 7:40 am                  │
│ Surrey → Richmond Centre       │
│                                │
│ [         Start trip         ] │
│                                │
│ Seat requests · 2              │
│ Sam · Pickup location          │
│ [Accept]             [Decline] │
│ [Second request…]              │
│                                │
│          [route map]           │
│                                │
│ Plan                           │
│ 7:40 · Leave Surrey            │
│ 7:50 · Pick up Sam             │
│ 8:20 · Richmond Centre         │
│                                │
│ Riders · 2                     │
│ Names and pickup details       │
│ Cost share                     │
│                                │
│ Repeats Sundays              › │
│ [Edit]         [Cancel this day]│
└────────────────────────────────┘
```

Requests come before the map while awaiting a decision. Hide that section when empty.

For a rider, use the same page structure with **pickup time, driver and booking status** at the top. Show their pickup and route, cost share and **Cancel this ride**. Do not show driver-only request controls.

For flexible trips, replace a precise departure time with:

> **Leave between 6 am–noon**  
> Waiting for the first rider to set the time.

Once set, show that day’s agreed time. Do not imply every repeating day now has that time.

**How it behaves in each situation**

| Situation | Home | Trips |
|---|---|---|
| No trips | “No upcoming trips.” Show Ask for a ride, Post a trip and Offer a ride now. | Empty calendar with a clear way to create or request a trip. |
| One trip | Show its summary and next action. Omit the empty Coming up section. | Show it on its date. Tap for details. |
| Ten or more dates | Show the next trip, any attention needed, and at most two further trip summaries. | Calendar marks every occurrence. List reveals more days on demand. |
| Trip in progress | Replace Next up with the active trip. Driver gets **Open navigation**; rider sees the current ride status. | Mark the occurrence **In progress** and open the same details page. |

Show **Start trip** for a drive happening today when starting is valid. For a future drive, the main action is **View details**. A rider never sees Start trip.

Requests for later dates must still appear in Home’s attention summary. Tapping “2 requests · 2 trips” opens a short list of affected trips; choosing one opens its requests on Trip details.

**Exactly what to remove, merge or move**

| Current screen | Change |
|---|---|
| Home’s “Your trip” card | Replace with a short Next up summary. Move repeating schedule text, Edit and Cancel into Trip details. |
| Home’s map, date chips and day plan | Move to Trip details. Use the Trips calendar to choose another day. |
| Home’s seat requests | Replace with an attention summary. Keep individual requests and decisions on Trip details. |
| Home’s confirmed riders | Keep only a count in the summary. Put names and pickup details on Trip details. |
| “See riders” button | Merge into **View details**. |
| “Cancel all upcoming” card | Remove from Home. Put **Cancel remaining dates** inside management of that repeating schedule. |
| Riding’s full request form | Open it after **Ask for a ride**. Keep Now / Schedule inside that form. |
| Trips’ Edit / Cancel buttons on each row | Move into Trip details. Make each row a clear way to open the trip. |
| “Upcoming trips” and “Your drives” | Merge into one dated schedule. Use the role filter when needed. |
| Past trips card | Replace with the Past view in Trips. |
| Repeated explanations | Replace with short status text. Put occasional help beside the relevant control. |
| Post-trip date preview | Keep it collapsed. “Preview 130 dates” is enough; the calendar opens on tap. |
| Home’s footer links | Move account, legal and app information into Me. |

For repeating trips, **Edit** should ask which dates are affected: **This day / This and following dates**. Cancellation should distinguish **Cancel this day** from **Cancel remaining dates**, then confirm the chosen scope. Avoid the ambiguous “Cancel this trip.”

**Navigation changes**

- Keep **Home | Trips | Points | Me**.
- Remove the Driving / Riding switch from Home.
- Replace Trips’ role switch with **All / Driving / Riding**, defaulting to All.
- Keep Calendar / List as a small view choice.
- Tap a calendar date to see that day’s short list.
- Tap any trip summary or row to open the same dated Trip details page.
- Trips’ **+** offers **Post a trip / Ask for a ride**.
- Back returns to the screen and date you came from.

Your starting idea has the right foundation. The key adjustment is to let **Home point to the next trip**, while **Trip details owns its full plan**.
