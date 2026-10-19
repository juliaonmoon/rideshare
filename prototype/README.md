# RideShare app (prototype folder)

Live at https://juliaonmoon.github.io/rideshare/prototype/ (static page + Supabase). Pre-launch: friends only.

## What it does
- **Sign in** with Google (one tap) or an emailed link. Others only see your first name and neighbourhood-level areas, never addresses.
- **I'm driving:** post your commute with a max detour and max wait. See riders along your route, accept seat requests, press **Start trip** to watch the car on the road route.
- **I need a ride:** post your request, see matching drivers with the fair price (points or cash gas-share), ask for a seat, then **Watch my ride** once accepted.
- **Dates:** pick a date and time (30 minutes to 30 days ahead, like Uber Reserve) and optionally repeat weekly on chosen days (like Liftango). Review, then Confirm. Date chips switch which day you are looking at. The **Upcoming** tab lists your trip, request, rides and passengers.
- **Ride steps:** drivers tap On my way, Arrived, Picked up, Dropped off; riders see each step live and can confirm I am in the car. Points are paid at drop-off. Open in Google Maps gives turn-by-turn directions to the next stop.
- **Leave now:** drivers tap Offer a ride now (no date or time); riders tap I need a ride now. Riders see their driver on the map with an ETA and warnings if the driver has not left or is very late.
- **Cancelling:** points are held until the ride. More than 2 hours before pickup: full refund. Within 2 hours: your first each month is free, then the driver keeps half. No cancelling after pickup (drivers can mark a no-show). If a driver cancels, the rider gets everything back.
- **Points:** private balance and history. 1 point = $0.10. Points move only when a driver accepts, through database functions, never by editing tables. No cash-out.
- **Show my location:** a blue dot from your device GPS on the maps. It stays on your device and is not sent to RideShare.

## Files
- `index.html` the page and map code (Google Maps with road routes via the Routes API, Leaflet fallback). Old demo code is still in the file, hidden and unused (clean up later).
- `live.js` the app logic (sign-in, trips, requests, matching, seat requests).
- `dates.js` date and repeat helpers (tested).
- `matching.js` detour/wait matching and fair-split pricing. Tests: `node test.js`.
- `data.js` area coordinates (and the original demo people).
- `config.js` public Supabase address and publishable key (safe to commit; never put a secret key here).
- `../supabase/schema.sql` database tables, privacy rules and points functions. `../supabase/seed.sql` 24 made-up sample people.

## Install on a phone
The page is an installable app (PWA): `manifest.webmanifest`, `sw.js`, `icon-*.png`, `install.js`. On Android/Chrome an **Install app** banner appears; on iPhone the page shows a short "Share > Add to Home Screen" tip (Apple allows no automatic prompt).

## Google Maps key (bring your own, per browser)
Never commit it. Paste it under **Points > Map** on each device. Restrict the key to the Maps JavaScript API and Routes API and to `https://juliaonmoon.github.io/*`, and keep a daily quota and budget alert.

## Known limits
- Rider's page sends the points amount; the server only range-checks it. Compute it server-side before real users.
- Sample drivers never accept requests; test a full match with two real accounts.
- Supabase's built-in email is rate-limited (Google sign-in avoids this).
- Database is in US West; move to Canada before real users. Not yet tried on a real phone by anyone but the owner.
