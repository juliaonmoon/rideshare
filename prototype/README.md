# RideShare prototype

A clickable demo. **No server, no accounts, no cost.** Open `index.html` in a browser (or serve the folder: `python3 -m http.server`).

What it shows:
- **I'm driving:** set your route, departure, *max detour* and *max wait*. Riders who fit are suggested; accept with one tap. Prices use a fair split (each stretch of road shared by everyone in the car, so more riders = cheaper each; riders never pay more than the route costs).
- **Recurring trips:** pick the days you drive, mark a rider "Make regular", and mark them "away" for a day to see backup riders suggested for the open seat.
- **I need a ride:** post a trip, see drivers going your way, request with points or cash gas-share.
- **Points:** earn by driving riders who pay in points, spend when you ride. 1 point = $0.10. No cash-out.

Limits (it is a prototype): demo riders/drivers only, rough straight-line-based travel times (not real road routing), cash is "settled outside the app", state is saved only in your browser.

Tests for the matching and pricing logic: `node test.js`

## Live car on the map
"Start trip" (driver) and "Request" (rider) animate a car along the route with a status line (next stop / minutes to pickup). Demo speed: 3 simulated minutes per second; the car moves in straight lines between stops. It uses free OpenStreetMap tiles via Leaflet, **not Google Maps** (that needs an API key and billing). The map layer is small and can be swapped for Google Maps or Mapbox later.

## Google Maps (optional, bring your own key)
The page can show Google Maps with the moving car. I did not put a key in the code and you should never commit one.
1. In Google Cloud Console, create a project and attach a billing account (Google gives a free monthly allowance; check the current pricing page).
2. Enable **Maps JavaScript API** and create an API key.
3. **Restrict the key** to the Maps JavaScript API and to the web address where you host this page, and set a budget alert.
4. Open the page, go to **Points > Map**, paste the key and press Save. The key is kept only in that browser.

Google Maps needs the page on a normal web address (a local file or a hosted copy). It can't load inside the Claude viewer, which shows the schematic map instead. Verified so far only against a stand-in for the Google library, not against real Google servers, because I have no key.
The car moves along straight legs between stops; real road routing (Google Directions/Routes) is a later step and is billed separately.

## Test data
12 made-up riders and 6 made-up drivers around Surrey and Burnaby (`data.js`). With the default driver (Surrey Central to BCIT at 07:30) six riders match; with the default rider (Whalley to Brentwood) three drivers match. Others are deliberately out of range, out of time, or on a different payment type so you can see them filtered out.

## Fallback map
If the street map can't load (offline, or a sandboxed viewer), the app draws a schematic route with the moving car instead, so everything still works. The phone-friendly copy shared in Claude uses this schematic map.

## Not verified yet
Automated checks cover matching/pricing logic and the page flow (accept, regular rider, start trip, request, points). The map tiles and the car icon could not be viewed in the build environment (map CDN blocked), so please check the map on your own browser.
