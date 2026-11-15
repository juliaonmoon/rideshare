# RideShare: Home vs Trips (design by Claude)

TLDR: Home answers "what do I do next?". Trips answers "show me everything". The plan of a trip lives in ONE place: the Trip page. Home is a short "Next up" feed that mixes driving and riding, so the Driving | Riding switch goes away.

---

## 1. The rule

- **Home = now and next.** The next 1 to 3 things, and anything waiting for my answer. Short. Never a full list.
- **Trips = everything scheduled, plus history.** Upcoming, Calendar, Past. Yes, Trips also holds history.
- **Trip page = the plan.** Opens when you tap any trip or day, from Home or Trips.

Why it works on a normal day:

| Moment | Where they go | What they need |
|---|---|---|
| Planning ahead (days before) | Trips | See all, post, edit, skip a day |
| Before leaving (30 min) | Home | Accept requests, see leave time, tap Start trip |
| On the way | Home | One big next step (Picked up / Dropped off) |
| After | Trips > Past | Check what happened, rate |

Your idea ("Home = Next up, Trips = everything, tap opens a trip page") is right. Two changes: (a) no Driving | Riding switch on Home, one mixed feed; (b) Home never shows the map or the plan. It opens the Trip page in one tap, except while on the way (see 5).

## 2. Where each piece of information lives (zero duplication)

| Information | Lives in | Home / Trips show only |
|---|---|---|
| Route map | Trip page | nothing |
| Leave time | Trip page | Home hero and Trips rows show it as one short label (a pointer, not a second copy of the plan) |
| Pickup stops and times | Trip page | nothing |
| Confirmed riders | Trip page (one list, with the Picked up / Dropped off buttons) | count only ("2 riders") |
| Seat requests (Accept / Decline) | Trip page | Home shows a "waiting for you" strip with Accept / Decline right there (it is the action, and it leaves Home once answered) |
| Cost share, detour | Trip page, behind (i) | nothing |
| Start trip | Home hero (today only) and Trip page (same action, same code) | |
| Edit, Skip this day, Cancel | Trip page, under "More" | nothing |
| All upcoming days | Trips | Home shows next 3 |
| Repeat rule ("every Sun until Feb 28") | Trips series header and Trip page header | nothing else |
| Past trips and rides, ratings | Trips > Past | nothing |
| Cancel all upcoming | Me tab only | nothing |
| Points balance | Points tab | nothing |

Rule of thumb: Home may SHOW a status or a button, but never a second copy of the plan.

## 3. Home wireframes (390 px)

Home has no switch. Same screen for a driver, a rider, or both. Items are tagged DRIVE or RIDE with a small label.

Order, top to bottom: 1. Needs you (only if something is waiting). 2. Next up hero. 3. Coming up. 4. Two "now" buttons.

### Home, driver view (2 seat requests, trip today)

```
RideShare                         (no switch)

[ Needs you ]                      <- only when something waits
| Sam asks for a seat  Sun 8      |
| Pickup Whalley  +6 min          |
| [ Accept ]        [ Decline ]   |
| Lee asks for a seat  Sun 8      |
| [ Accept ]        [ Decline ]   |

[ Next up   DRIVE ]
| Today 7:40 am                   |
| Surrey to Richmond Centre       |
| 2 riders . leave 7:40           |
| [        Start trip         ]   |   (big, today only)
| Open plan >                     |

----- above the fold ends about here -----

Coming up
| Sun Nov 15  7:40  DRIVE  1 rider  >
| Mon Nov 16  8:10  RIDE   Ana      >
| Sun Nov 22  7:40  DRIVE           >
| All trips >

[ Offer a ride now ]  [ Ask for a ride ]
```

Above the fold: Needs you + Next up with Start trip. Everything else is a scroll away and short (about 1.5 screens total).

If nothing is waiting, Needs you is not drawn. If the next trip is not today, the hero shows "Sun Nov 8 7:40 am" and a button "Open plan" instead of Start trip.

### Home, rider view (ride booked tomorrow)

```
RideShare

[ Next up   RIDE ]
| Tomorrow 8:10 am pickup         |
| Whalley to Brentwood            |
| Driver: Ana . 40 pts            |
| [      Open ride      ]         |

Coming up
| Fri Nov 14  8:10  RIDE  Ana     >
| All trips >

[ Offer a ride now ]  [ Ask for a ride ]
```

During the ride the hero button becomes "I'm in the car", then nothing (see 5).

### Someone who is both

One feed, sorted by time. Needs-you items always first. A person who drives Sundays and rides Mondays sees both under Coming up, with DRIVE / RIDE tags. This is better than a switch because:
- the question "what's next?" does not depend on a role;
- with a switch, a rider-tab request or a "Needs a new driver" is invisible while you are on the Driving tab;
- one screen means one place to look.

The "now" buttons ("Offer a ride now", "Ask for a ride") open a full-screen form (back arrow). The forms are no longer stacked on Home. "Post a trip" and "Schedule a ride" are on Trips (plan-ahead things go with Trips, now things go with Home).

## 4. Trips tab and Trip page

### Trips tab (one list for driver and rider, no role switch)

```
Trips                        [ + New ]    <- sheet: Post a trip / Schedule a ride

[ Upcoming | Calendar | Past ]            <- one segmented row (replaces 2 switch rows)

Needs you (only if any)
| Sam asks . Sun Nov 8   >

Today
| 7:40  DRIVE  Surrey to Richmond  2 riders  >

This week / Later
| v Surrey to Richmond  DRIVE       <- series, collapsed
|   Every Sun until Feb 28 . 17 days
|   Sun Nov 8   7:40   2 riders  >
|   Sun Nov 15  7:40   1 rider   >
|   Sun Nov 22  7:40   none yet  >
|   All 17 days >                   <- opens that series on the Calendar
| > Whalley to Brentwood  RIDE  Mon-Fri  (collapsed)
| Fri Nov 21  Burnaby to Surrey  DRIVE  one time  >
```

- A series (repeating trip) is ONE collapsed row. Open = next 3 days. "All N days" opens the Calendar filtered to that series. 10+ days never appear as 10+ rows.
- Posted trips are capped at 5, so at most 5 series rows plus one-time rows. This list stays short.
- **Calendar**: unchanged (D and R chips, "ask" badge). Tapping a day opens the Trip page for that day, not an inline box. (The inline day box under the calendar is removed.)
- **Past**: finished trips and rides, newest first, collapsed to 8 with "Show more". Tap = same Trip page, read-only, with rating and Report.

### Trip page (one screen, driver and rider versions)

Header: back arrow "Trips" (or "Home" if opened from Home), title "Sun Nov 8 . 7:40 am", a day picker (">" or "Sun Nov 8 v") to jump to the series' other days, "More" menu.

Driver Trip page, top to bottom:
```
< Trips            Sun Nov 8 v      More
Surrey to Richmond Centre
Every Sun until Feb 28
[        Start trip         ]    (today only; otherwise greyed "Opens on the day")
Seat requests (2)   Accept / Decline per rider     (only if any)
[ Map ]
Stops   1 7:40 Start . 2 7:52 Pick up Sam . 3 8:20 Arrive
Riders  Sam  30 pts  [Message] [Meeting spot]   (Picked up / Dropped off button when on the way)
Your cost share $7.28  (i)  Detour +6 of 15 min (i)
```
More menu: Edit this trip . Skip this day . Cancel whole series (for a one-time trip: Cancel trip).

Rider Trip page:
```
< Trips            Fri Nov 14 v     More
Whalley to Brentwood
Driver Ana . pickup 8:10 . 40 pts
Status: Accepted / On the way / Arrived / In the car
[ Map ]
[ Message ] [ Meeting spot ]
No driver yet?  > Drivers going your way  [Request . 40 pts] ...
```
More menu: Cancel this ride . End regular booking . Report a problem . Share trip details.

Cancel rules (the late-cancel policy) stay behind an (i) button, not as text.

## 5. Behaviour in each situation

| Situation | Home | Trips | Trip page |
|---|---|---|---|
| **0 trips (first run)** | Two big buttons only: "Post a trip", "Ask for a ride", plus "Offer a ride now" small. No empty cards, no explanation text (one (i)). | Same empty state: "Nothing planned" + [ + New ] | n/a |
| **1 trip** | Hero is that trip. Coming up not drawn. | One row, no grouping | Normal |
| **10+ days (repeating)** | Hero + next 3 days only | One collapsed series row; next 3 days; "All N days" opens Calendar | Day picker on top lists the days (next 7 shown, "More dates" for the rest) |
| **Ride in progress (on the way)** | Home becomes live mode: the hero is replaced by the live screen: map, ONE big next-step button (Start trip > Picked up Sam > Dropped off Sam > I have arrived: end trip), the stop list in one line, "Open Google Maps again". Nothing else above it. Rider: driver, "On the way / Arrived", "I'm in the car", Message. Coming up and the "now" buttons stay below the fold. | Row shows "In progress" tag, tap = Trip page | Same live content (one shared piece of code). Never both on screen at once. |
| **Seat requests waiting** | "Needs you" strip at the very top with Accept / Decline inline, each with who, where, +minutes. Tab bar shows a dot on Home and on Trips. | "Needs you" group at top, and an "N ask" badge on the day or series row | Seat requests block directly under Start trip |
| **Rider's driver cancelled** | Red "Needs a new driver . Sun Nov 15" at the top of Needs you, button "Find a driver" | Row for that day tagged "No driver", at the top | Opens with the "Drivers going your way" list expanded and the Request buttons |

## 6. Remove, merge, move (current card names)

**REMOVE**
- Home > "Driving" card (title only; keep its two buttons moved as in 3). The heading is noise.
- Home > "Cancel all upcoming" card (both driver and rider Home). It stays in Me (it already exists there). A dangerous button should not sit on the main screen.
- Home > "Date" card (date chips and repeat sentence). The day picker moves to the Trip page. The repeat sentence appears once (series header).
- Home > permanent text: "No riders yet. They will show up here...", "When you set off, tap Start trip at the top...", "Start trip is available on the day of the trip", the "None yet. Riders ask you for a seat..." and "Manage this booking in Trips". Silence or (i).
- Home > "Preview route (watch the car)" / "Stop preview" buttons (developer-only, already behind DEV; keep them out of the user view).
- Trips > "As a driver | As a rider" switch.
- Trips > "Cancellation rules" card as visible text (to an (i) on the Trip page).
- Trips > the "Upcoming trip", "Upcoming riders", "Upcoming ride request", "Upcoming rides" cards as four separate cards (replaced by the one grouped list).
- Home > "Your drives" (drive log) is not on Home; it moves into Past.

**MERGE**
- Home "Your trip" card + "My trips (N)" card (tripsList) + Trips "Upcoming trip" card: three views of the same trip list become the Trips tab list.
- Home "Trip plan" card (planData: stops, passengers, detour, big next step) + "Sun Dec 6's trip" card (cost, km) + "Confirmed riders" card (driverLists) + the second map: one Trip page with one map, one stop list, one rider list. Today the riders appear in both Trip plan > Passengers and Confirmed riders, and there are two maps (map-plan and map-ld).
- Home "Seat requests" card (driverLists) + the Home top "req-wrap" card + Trips "Upcoming riders" Accept/Decline: one seat-request block, shown where it is needed (Home Needs you and Trip page). It is the same renderer.
- Home "Your trip" (driver) and "Seat confirmed / Seat requested / Looking for a ride" (rider, riderTopOne) become the single "Next up" hero.
- Past trips + Past rides + Your drives: one Past list.
- Home "Ask for a ride" form (riderNow) and Schedule form (riderForm) and Post a trip form (driverNow): kept as forms, opened full-screen.

**MOVE**
- Map, stops, riders, cost, detour: Home > Trip page.
- Edit trip, Cancel this trip, Skip this day, End regular booking, Cancel this ride: Home > Trip page More menu.
- Post a trip, Schedule a ride: Home > Trips (+ New). "Offer a ride now", "Ask for a ride": stay on Home as the only two buttons.
- Calendar day details: inline box under the calendar > Trip page.
- "Drivers going your way" list: rider Home > rider Trip page (and the lost-ride flow).
- Cancel all upcoming: out of Home, stays in Me.

## 7. Navigation

- **Bottom tabs: Home | Trips | Points | Me.** Same four. Badge dot on Home and Trips when something waits for an answer.
- **Remove the Driving | Riding switch** from Home. (Phase 2. In phase 1 it stays but the page under it is slimmer.)
- **Taps:**
  - Home hero, Coming up row, Needs you row: Trip page for that day.
  - Trips row, calendar day, Past row: Trip page for that day.
  - Series header: expand/collapse. "All N days": Calendar for that series.
  - Home "All trips": Trips tab, Upcoming.
  - Trips "+ New": sheet with "Post a trip" and "Schedule a ride".
  - Offer a ride now / Ask for a ride: full-screen form with a back arrow.
- **Back:** Trip page and forms have a back arrow that returns to wherever you came from (Home or Trips, at the same scroll). The phone back button does the same. Tapping the active bottom tab again returns to its top.
- The Trip page is not a tab. It sits on top of Home or Trips.
- Tab bar stays visible on the Trip page so the user is never trapped.

## 8. Phased build plan

All in `prototype/live.js` unless stated. Existing code is reused wherever possible.

**Phase 1: one Trip page, a slimmer Home (the biggest win, smallest change)**
This answers Jules's actual confusion: "where is the plan, and where are all my trips?"
1. Make a Trip page by reusing what Home Driving already renders when a trip and day are chosen. `driverLists` (map, riders, requests) and `planData` / `renderPlan` (stops, next-step button) are already built; mount them in one container opened with a back arrow. Merge them (single map, single rider list): drop the `summary` and `riding` duplicates inside `driverLists`, keep `planData` as the main block.
2. Set the chosen day from the tap: `viewD` and `curTrip` (the same thing the "Show" button in `tripsList` does through `data-seltrip`). `planData` currently picks "next day with an accepted rider" itself; change it to use `viewD`. This is the main risk.
3. Home driver: shrink `driverTopOne` into the hero (day, time, one-line route, rider count, Start trip, Open plan). Stop rendering `driverLists`, the plan and `cancelAllCard` on Home; keep `renderRequests` (req-wrap) at the top. Remove the `tripsList` call from `driverTop`.
4. Trips: make `upcomingMain` list use `tripsList`-style rows with a tap to the Trip page; remove the inline day box (`dayBox`) in the calendar so a day tap goes to the Trip page.
5. `prototype/index.html`: add a "trip" view state to the glue script (`apply()`, `oldTab`), a back arrow, move the containers `map-ld` / `plan-wrap` / `ld-lists` into the new view.
Touches: driverTop, driverTopOne, driverLists, planData, renderPlan, tripsList, upcomingMain (calendar day tap), cancelAllCard (Home call), index.html glue.
Risks: map containers hold Google maps that are created once and do not like being moved (re-draw after the move, drop the `mapSig` cache); `planData` day logic; `renderPlan` hides itself when no accepted rider (the Trip page must still show the empty plan).

**Phase 2: one Home feed for everyone, rider parity**
1. Remove the Driving | Riding switch: Home becomes Needs you + Next up + Coming up + two buttons, built from `driverTopOne` and `riderTopOne` (turn both into one `nextUpItems()` list sorted by date) plus `lostBanner` and `renderRequests` at the top.
2. Rider Trip page from `riderLists` ("Your ride" card and the "Drivers going your way" list).
3. Move "Ask for a ride" (`riderNow`, `riderForm`) and "Offer a ride now" (`driverNow`) behind buttons as full-screen forms.
4. Merge Trips "As a driver | As a rider" into one list (`upcomingMain`: combine `comingD` and `comingR`; keep D/R tags).
Touches: driverTopOne, riderTopOne, lostBanner, riderNow, riderForm, riderLists, driverNow, upcomingMain, index.html glue (remove `roleSwitch`, keep `rs_role` only as a fallback), `data-scroll` ("goTo") buttons no longer needed.
Risks: much of the code assumes one role at a time (`curTrip`, `curReq`, `viewD`, `viewR`), and the hidden old tab buttons (`t-driver`, `t-rider`) are what the glue presses. The feed must render both roles in the same pass. Do phase 1 first and watch how it behaves.

**Phase 3: scale and polish**
1. Series grouping in Trips (group `myTrips` by `series_parent` / `rootId`, collapsed, next 3 days, "All N days" to Calendar).
2. One Past list (`tripRows`, `rideRows`, `driveLogCard`) as the third segment.
3. Live mode on Home when a trip is on the way (use `shouldShare()` / `rs_trip_on` / `started` in `planData`).
4. Rename the cancel actions: Skip this day / Cancel whole series / Cancel trip. Tab badge dots.
Touches: upcomingMain, tripsList, planData, index.html glue (badges), `driveLogCard`.
Risks: series data (`occOf`, `inFam`, `tripOn`) is spread across many helpers; wrong grouping would hide days. Low risk to the data itself, since this is display only.

## 9. Alternatives rejected

- **Keep Home Driving | Riding switch and just clean up each page**: rejected. A both-roles user would miss a seat request or a "Needs a new driver" sitting on the other tab.
- **Home as a full dashboard of the next trip (map + plan inline, as in Jules's first idea)**: rejected. It brings back the long stacked Home, and the plan would then live in two places (Home and the Trip page).
- **Trips = history only, all upcoming on Home**: rejected. Home would have to list up to 5 series with many days, i.e. 10+ rows; and "see everything" would be split across two tabs.

## 10. Top 5 usability risks, and a 5-minute check

1. **"Where did the map go?"** (map is one tap away). Check: ask a driver, "You leave in 10 minutes, show me your route." Pass if they open it in under 5 seconds with no hint.
2. **Home with no switch confuses a driver-only person** (RIDE items look irrelevant, "Ask for a ride" button is unneeded). Check: show a driver-only account, ask "What is this button for?". If puzzled, hide "Ask for a ride" for accounts that never rode.
3. **Series row collapsed hides a seat request.** Check: put 1 request on a day 3 weeks out, ask "Is anyone waiting for you?". Pass if they find it via Needs you or the badge. The Needs you strip must show it, not only the series row.
4. **Two ways to tap Start trip** (Home hero and Trip page). Check: ask "Start your trip" twice. Pass if both work the same and nobody taps twice (or sees duplicate notifications to riders).
5. **Taps feel like too many** (Home > Trip page > back). Check: time "Accept the request, then find the pickup time of Sam." Pass if under 15 seconds, with Accept done from Home without opening anything. If slower, put the leave time into the hero and the Needs you card.

Assumptions: "Skip this day", "End regular booking" and "Cancel all upcoming" already exist, so naming them differently adds no features. I did not run the app; sizes and the above-the-fold line are estimated from the screenshots.
