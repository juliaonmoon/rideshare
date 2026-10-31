# Things only Jules can do (running list)

Kept up to date by Claude. Newest status is at the top of each section. Nothing in this file is a secret: never paste passwords, tokens or keys into it.

## 1. Run these SQL files (Supabase SQL editor)

Open https://supabase.com/dashboard/project/iivhfapvkseeomxtsrxf/sql/new, paste the file, click Run. Each file is safe to run twice. Run them in number order.

| File | What it turns on | Status |
|---|---|---|
| `supabase/migrations/020_detour_limits.sql` | Detour limits in minutes and km | Done |
| `supabase/migrations/021_profile_cards_reports.sql` | Photos, car details, Report a problem | Done |
| `supabase/migrations/022_no_show_needs_arrival.sql` | No-show only after arrival and waiting | Done |
| `supabase/migrations/023_meet_spot_auto_end_rider_alerts.sql` | Meeting spot, trip ends on arrival, rider phone alerts | Please confirm you ran it. Claude cannot see the database from here. If the Set meeting spot button is missing on an accepted ride, it was not run. |
| `supabase/migrations/024_messages_ratings_admin.sql` | Messages, ratings, admin reports screen, blocking | Done (Jules ran it on 2026-10-30) |
| `supabase/migrations/025_booking_integrity.sql` | Safer payouts, safe accepting, whole-trip cancel with refunds, locked bookings, fixed 5-minute wait, report function | **To run** |
| `supabase/migrations/026_driver_route_token.sql` | Lets the phone rebuild the Google Maps route after you accept a rider while driving | **To run** |
| `supabase/migrations/027_server_quotes.sql` | The server works out each rider's extra minutes and price (live traffic when switched on, saved drive times otherwise); riders together never pay more than the trip costs | Done (ran 2026-10-31) |
| `supabase/migrations/028_fix_live_route.sql` | Fixes two mistakes in the live-traffic lookup | Done (ran 2026-10-31; live traffic tested and working) |
| `supabase/migrations/029_blocking_and_profile_rules.sql` | Blocking an account cancels its future bookings and hides its offers; "never match me with this person"; the database requires a photo and car plate | **To run** |

How to copy a file to the clipboard: ask Claude, or open the file on GitHub, click "Copy raw file", then paste it into the SQL editor.

## 2. Test with two real phones (the most important thing)

The app has only been tested with sample riders, a practice database and an emulator. Do this once with a friend (two accounts, two phones, both with the Android app):

1. Driver (phone A): Me tab, add photo and car plate. Home, Driving, **Offer a ride now**, pick From and To.
2. Rider (phone B): Me tab, add photo. Home, Riding, **Request a ride now**, pick Pickup and Drop-off. Pick the driver and tap **Request**.
3. Driver: phone alert arrives (Accept / Decline buttons). Tap **Accept**.
4. Rider: phone alert "Seat confirmed". Tap **Set meeting spot**, move the pin, add a note.
5. Driver: **Start trip**, Google Maps opens. Rider gets "on the way", then "has arrived" when near the pickup.
6. Driver: tap **Picked up** in the notification, later **Dropped off**. The trip ends by itself near the destination.
7. Both: try **Message**, **Rate** (Good / Not good), **Report a problem**, **Share my trip**.
8. Write down anything that felt wrong or confusing and send it to Claude.

## 3. Legal and insurance (not something Claude can decide)

- Ask ICBC (or your insurance broker) how carpooling with cost-sharing affects the driver's own insurance.
- Check BC rules for carrying passengers for money (Passenger Transportation Board). Cost-sharing with no profit is normally fine, but get it confirmed.
- Have a lawyer read the Terms and Privacy pages (`prototype/terms.html`, `prototype/privacy.html`). Claude wrote them as drafts, not legal advice.
- Decide the minimum age (for example 18+) and whether drivers need to confirm they hold a valid licence and insurance.

## 4. Decisions Claude needs from you

1. **Support contact.** What email or phone number should the app show for problems ("Contact support")? Reports currently go to the admin screen in the Me tab only.
2. **Identity checks.** A photo is not an identity check. Options: do nothing for now; a paid identity service (for example Stripe Identity or Persona, roughly US$1.50 to $3 per check); or ask for a licence number only. Tell Claude which.
3. **iPhone.** The phone alerts exist only in the Android app. Options below in section 6.
4. **Remove the "Test version" banner and sample riders** before real launch. Tell Claude "go live mode" and it will do it.

## 5. Supabase settings to check before real users

- **Backups.** The free plan has no daily backups. Before real users, consider the Pro plan (about US$25/month) for daily backups.
- **Sign-in emails.** The built-in email sender is limited to a few emails per hour. For real users set up your own email sender (SMTP) in Supabase: Authentication, Emails, SMTP Settings. Claude can write the steps if you pick a provider.
- **Admin access.** Your account is the admin (it is in the `test_accounts` table). To add another admin, ask Claude for the SQL.

## 6. iPhone options (pick one, or none for now)

| Option | What you need | Result |
|---|---|---|
| A. Web push for the home-screen web app | A one-time key pair (Claude generates it, you store the private part as a Supabase secret) and about a day of Claude work | iPhone users who add RideShare to the home screen (iOS 16.4 or newer) get alerts. Less reliable than Android. |
| B. Native iPhone app | Apple Developer account (US$99 a year), a Mac, and about a week of Claude work | The proper solution, in the App Store. |
| C. Nothing for now | Nothing | iPhone users can use the website but get no phone alerts. |

## 7. Getting the Android app into the Play Store

1. Create a Google Play Console account (US$25 once). Personal accounts created after Nov 2023 must run a closed test with at least 12 testers for 14 days before going public.
2. Claude can build a signed release version, but **you** must create and keep the signing key (a file called a keystore). Ask Claude for the step-by-step; never put the key or its password in the repository.
3. Store listing: name, short and long description, icon (exists), screenshots (Claude can prepare them), privacy policy link (exists at `prototype/privacy.html` on the live site).
4. Fill in the Data safety form in Play Console (Claude will give you the answers).

## 8. Google Cloud (Claude never changes these)

- Set a **billing budget alert** (for example CA$20) in Google Cloud. An alert only emails you; it does NOT stop spending. To actually limit spending, also set daily **quotas** on the Maps APIs (Google Cloud, APIs and services, Quotas). Claude never changes these for you.
- The Maps key is restricted to the website. If a new domain is used, it must be added to the key's allowed websites.
- The app limits itself to 300 road-route lookups per phone per day.

## 9. Small things

- A custom web address (for example rideshare.ca) instead of juliaonmoon.github.io/rideshare. Optional.
- Test accounts: sample riders appear only for the admin account in test mode.

## 10. Second ChatGPT review: what is done and what is still open (plain English)

The full review is in `design-review/CHATGPT_REVIEW_2.md` (kept on your computer only). Its verdict: **not ready for real strangers yet**.

### Already fixed

- The new buttons (Message, Meeting spot, Report, Rate) needed two taps. Now one tap.
- The Request button could book a different request than the one shown. Fixed.
- A driver could be paid for a ride where nobody was picked up. Now the rider gets the held points back, and an open report pauses the payout.
- Two drivers, or two accepts, could take the same seat. Fixed. A request that was withdrawn or switched off can no longer be accepted.
- Cancel my trip now cancels every booked rider and refunds them in one step.
- A trip or request that has a confirmed rider can no longer be deleted, or have its time or route changed.
- The 5-minute wait is enforced by the database.
- Reports work for past and cancelled rides too, with a daily limit.
- The meeting spot has to stay within 2 km of the pickup and cannot move once the driver is on the way.
- Signing out switches off the phone helper's access.
- The privacy text now says what we really store.
- After you accept a rider while driving, the notification has an **Update route** button. One tap restarts Google Maps with all remaining stops, including the new rider. (Needs migration 026.)

### Done since (needs migration 029 and the new phone app)

- **Phone app:** "driver has arrived" now needs a fresh, accurate position, the car nearly stopped, for 8 seconds. A trip ends by itself only after 15 seconds of fresh readings at the destination. A tap on Picked up, Dropped off, Accept or Decline without signal is saved and sent when the signal returns (answers expire after 10 minutes). Riders get phone alerts as soon as they ask for a ride (no location permission needed), and "Seat confirmed" is no longer missed after a restart.
- **Blocking:** an administrator block now cancels the person's future bookings (riders are refunded), switches off their offers and requests, and ends their phone helper access. Any user can also choose "Never match me with this person again" (in the Report a problem window); the list is in the Me tab.
- **Photo and plate:** the database now refuses to post a trip without a photo and car plate, or a request without a photo.
- **Live traffic** is working (tested 2026-10-31).

### Backlog (later, your decisions)

- Support contact, identity checks, legal and insurance (sections 3 and 4).
- Real two-phone test (section 2). This is the most important next step.

## 11. Switch on live traffic (one time, optional; the app works without it)

RideShare asks Google for live traffic only when a rider asks for a seat and when a driver accepts. It is capped at 150 lookups a day and 4,000 a month (Google's free allowance is 5,000 a month). When the cap is reached, or Google does not answer, the server uses the saved drive times instead, so the service never stops. The limits are two rows in the table `app_limits` (ask Claude to change them).

Steps (you do them; Claude never changes Google settings and never sees the key):
1. Run migration 027 (section 1). Without the next steps, it already works using the saved drive times.
2. Google Cloud, project rideshare-mvp-487708: APIs and services, Credentials, **Create credentials, API key**. Name it "RideShare server". Under **API restrictions** choose **Restrict key** and tick only **Routes API**. Leave website restrictions empty (the server has no website address). Copy the key.
3. In the same project, APIs and services, **Routes API**, **Quotas and system limits**. Find the daily limit for Compute Routes requests and set it to about 200 a day. This is what really stops spending. A billing budget only sends an email.
4. Supabase SQL editor: run this one line, with your key typed in place of the words (the key goes only into your own browser):
   `select vault.create_secret('PASTE-THE-KEY-HERE', 'google_routes_key');`
   If it says vault does not exist, turn on the extension in Database, Extensions, "supabase_vault", and run it again. If migration 027 printed a notice that the http extension is not available, turn on the extension "http" in Database, Extensions, and run migration 027 again.
5. Check it works: ask for a seat in the app (two test accounts), then run `select day, calls from public.route_usage order by day desc limit 3;` and `select quote_source, detour_min, price_dollars from public.matches order by created_at desc limit 3;`. The first should show lookups counted, and the second should say live.
