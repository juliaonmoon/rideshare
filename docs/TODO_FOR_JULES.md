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

### Still open, in plain English

1. **Fake numbers from a rider's phone.** When a rider asks for a seat, the rider's phone works out how many extra minutes the trip adds and what it costs, then sends those numbers to the server. The server believes them. Someone who changes the app could send "0 extra minutes" for a trip that really adds 30. The fix: the server works out the numbers itself, so they can't be faked.
2. **Riders together pay more than the trip costs.** Each rider is quoted the price as if they were the only passenger. When four riders share one car, all four still pay that "alone" price, so together they pay about double the real cost. ChatGPT's example: four riders paying $6.80 in total for a trip that costs about $3.47. RideShare promises nobody profits, so the driver must never receive more than the trip costs. The fix: when more riders join, every share gets smaller so the total stays at or below the real cost.
3. **Phone fixes (Android).**
   - *Arrival:* the phone currently says "driver has arrived" when the car comes within 250 metres of the pickup, even if it is only driving past or the GPS is wrong. That starts the 5-minute no-show clock unfairly. The fix: only count it as arrived when the car has nearly stopped and the GPS is accurate.
   - *No signal:* if the phone has no signal when you tap "Picked up", the tap is lost and the notification says to open RideShare. The fix: save the tap on the phone and send it when the signal returns.
   - *Rider alerts:* a rider only starts getting phone alerts after a seat is accepted, and the first "Seat confirmed" alert can be missed. The fix: start the alerts as soon as the rider asks for a ride.
4. **Blocking a person.** Blocking stops them from doing new things, but their existing offers and bookings stay. The fix: blocking should also hide their offers and cancel their future bookings. We also need a "never match me with this person again" button for ordinary users.
5. **Photo and plate required.** The app asks for a photo (and a car plate for drivers), but the database does not insist. Someone could skip the app and post without them. The fix: the database requires them.
6. **Identity, support and legal.** See sections 3 and 4 above. These are yours to decide.
