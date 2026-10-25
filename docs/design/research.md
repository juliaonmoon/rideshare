# UI Benchmark: Uber, Lyft, BlaBlaCar, Waze Carpool

Read on 2026-10-23. Search-level research only. I did not open or screenshot the apps. Anything about screen layout is UNVERIFIED unless a source is named.

## TLDR

- Waze Carpool is dead. Waze shut it down in 2022. Don't copy it. Learn from why it died.
- Uber and Lyft run rider and driver as separate worlds. Drivers use a different app (or a clearly separate mode). Riders never see driver tools.
- BlaBlaCar uses one account for both roles. Its commuter app, BlaBlaCar Daily, looks closest to RideShare.
- Trust tools are now standard: a PIN to start the ride, share trip with a contact, an emergency button, and a verified profile with photo and rating.
- Our 5 cramped top tabs should become 3 to 4 bottom tabs. Role (driver or rider) should be a clear switch, not more tabs.

## 1. Waze Carpool status

- SHUT DOWN. Announced Aug 2022. Wind-down began Sept 2022 in the US, Brazil and Israel. Waze said commuting patterns changed after the pandemic. [9to5Google](https://9to5google.com/2022/08/25/waze-carpool-shut-down/), [TechCrunch](https://techcrunch.com/2022/08/26/googles-waze-shutting-down-its-carpool-service/), [Engadget](https://www.engadget.com/waze-shuts-down-carpool-app-174825025.html)
- One headline hints the shutdown was "canceled" ([Gizmodo](https://gizmodo.com/waze-carpool-service-shutdown-canceled-google-1849458147)). UNVERIFIED: I did not open it. Likely a partial reversal. Check before citing.
- UNVERIFIED: whether Waze has any carpool feature in 2026. I did not search.
- Lesson (inference): a carpool app needs steady commuter demand. Our non-profit, region-only focus is a different bet.

## 2. Navigation structure

| App | Pattern | Status |
|---|---|---|
| Uber | Rider app: bottom tabs (Home, Services, Activity, Account). Driver app is separate. | UNVERIFIED (from memory, not read this session) |
| Lyft | Rider app: map-first, with a bottom sheet. Driver app is separate. | UNVERIFIED |
| BlaBlaCar | Bottom tabs: Search, Your rides, Inbox, Profile. | UNVERIFIED |
| BlaBlaCar Daily | Save your commute in advance or last minute. Accept requests in the app. [Montpellier](https://www.montpellier.fr/en/daily-life/living-here/get-around/get-around-by-car/carpooling-with-blablacar-daily) | Partly verified (flow only, not layout) |

Bottom tabs are the norm on phones (inference). None of these use 5 top tabs.

## 3. Role switching (driver vs rider)

- Uber and Lyft: no evidence of a single-app role toggle. Search found no "switch to rider mode" on Lyft. Treat as separate apps. [Lyft search result](https://www.lyft.com/safety)
- BlaBlaCar: one profile for both roles. Drivers can view passenger profiles before accepting. [PilotPlans review](https://www.pilotplans.com/blog/blablacar-review) (secondary source). Whether there is an explicit toggle: UNVERIFIED.
- Takeaway: for a both-roles user, the role should be a visible mode, not a hidden menu.

## 4. Trust and safety UI

- Uber: 4-digit PIN to start trip, share trip with contacts, in-app emergency button, RideCheck (detects long unexpected stops and checks in). Features vary by region. [Uber safety](https://www.uber.com/us/en/drive/safety/)
- Lyft: opt-in PIN (select markets), trusted contacts follow the ride, scheduled check-in, audio recording. Drivers see rider name, verification status, rating and photo before accepting. [Lyft safety](https://www.lyft.com/safety)
- Lyft SOS button: not confirmed in my results. UNVERIFIED.
- BlaBlaCar: phone verification for all, ID verification, public ratings and profiles. [WhistleOut](https://www.whistleout.com/CellPhones/Apps/blablacar-for-safe-europen-carpooling-while-solo-traveling), [Vonage case study](https://vonage.com/resources/customers/blablacar/). Verified-badge look: UNVERIFIED.
- Report and block: I found no source describing the report/block UI on any app. UNVERIFIED for all four.
- Car details (plate, model, colour) shown before pickup: common practice (inference). UNVERIFIED by source.

## 5. Ride-in-progress screen

- Not confirmed by source for any app. UNVERIFIED.
- Common pattern from memory (UNVERIFIED): full map, a bottom sheet with driver/car, ETA, a Safety shield icon that opens share trip, emergency and report.
- BlaBlaCar Daily: one source says the app should be open in the background for geolocation during the trip. [EPFL presentation](https://www.epfl.ch/campus/mobility/wp-content/uploads/2026/06/Prsentation-app-EN.pdf)
- Scheduled carpools (our case) differ from on-demand: the key info is "who, where, when", with fewer live steps.

## 6. Takeaways for the redesign

1. Replace the 5 top tabs with 3 to 4 bottom tabs, for example: Home (today's commute), Find/Offer, Trips, Profile. Move the rest into Profile.
2. Make role a clear switch at the top of Home ("Driving / Riding"). Same account, one tap, tab content adapts.
3. Make "Today's trip" the first thing users see. Commuters repeat the same trip, so save routes and one-tap repeat (BlaBlaCar Daily saves commutes in advance).
4. Show a verified badge, photo, rating and car details (plate, model, colour) on every match card, before the user commits.
5. Add a ride PIN or a simple "confirm pickup" step. Optional is fine, as on Lyft.
6. Put one Safety button on the active-trip screen. It opens share trip, emergency call (911), and report. Keep it in the same spot every time.
7. Active trip screen: map on top, bottom sheet with person, car, ETA and next step ("Pickup at X, 8:05"). Keep it to a few big buttons.
8. Add block and report on every profile and after every trip. Needed because we are a non-profit with no paid support staff (inference).

## Gaps to close if this matters

Open each app's real screens (App Store screenshots) to confirm tab names, report/block flows and the in-trip screen. I did not do this.
