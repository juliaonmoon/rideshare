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

## Fallback map
If the street map can't load (offline, or a sandboxed viewer), the app draws a schematic route with the moving car instead, so everything still works. The phone-friendly copy shared in Claude uses this schematic map.

## Not verified yet
Automated checks cover matching/pricing logic and the page flow (accept, regular rider, start trip, request, points). The map tiles and the car icon could not be viewed in the build environment (map CDN blocked), so please check the map on your own browser.
