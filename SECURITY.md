# Security

RideShare is a pre-launch pilot. If you find a security problem, please **do not post it publicly**. Email the owner (contact address to be added before launch) or use GitHub's "Report a vulnerability" button on this repository's Security tab.

## How it is protected
- The database (Supabase) has Row Level Security on every table. People only see what the policies in `supabase/schema.sql` and the migrations allow. Signed-out visitors can read nothing.
- Points and money-like data change only through database functions, never by editing tables directly.
- Only neighbourhood-level areas are stored, never exact addresses. A driver's live position is shared only with the riders on that ride while it is in progress, and deleted afterwards.
- Abuse limits: at most 20 trips, 20 ride requests and 15 seat requests per hour, and 5 active trips/requests per person.
- Account deletion is built in (Points tab).
- No secrets are kept in this repository. `prototype/config.js` holds only public values: the Supabase address and publishable key, and the Google Maps browser key, which is restricted in Google Cloud to this website and to the Maps JavaScript and Routes APIs, with daily quotas.
- GitHub secret scanning and push protection are on.

## Owner checklist (in Google Cloud / Supabase, not code)
- Keep the Maps key restricted to `https://juliaonmoon.github.io/*` and to the Maps JavaScript API and Routes API only.
- Keep daily quotas on the Routes API and map loads, and the budget alert on.
- Delete or restrict any old unused API keys.
- Keep the Google sign-in screen "In production" and the redirect address set to the Supabase callback only.
