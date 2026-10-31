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

## 10. Second ChatGPT review (31 problems): where we are

The full review is in `design-review/CHATGPT_REVIEW_2.md` (kept on your computer only). Its verdict: **not ready for real strangers yet**. Claude's progress:

**Fixed (live, plus migration 025 above):** new buttons needed two taps; the Request button could use the wrong request; payout without a real pickup (now the held points go back to the rider, and an open report pauses payout); two drivers or two accepts taking the same seat; accepting a withdrawn or switched-off request; cancelling a whole trip now refunds every booked rider in one step; a booked trip can no longer be deleted or have its time or route changed behind the app's back; the 5-minute wait is enforced on the server; reports go through a checked function and also work for cancelled and no-show rides; the meeting spot must stay within 2 km and cannot move once the driver is on the way; signing out revokes the phone helper's access; the privacy text now matches what is stored.

**Still open (Claude will keep working through these, in this order):**
1. Server-checked price and detour (today the rider's phone sends them). Needs a bigger change.
2. Total cost of several riders can exceed the real trip cost (each rider is quoted as if alone).
3. Android: arrival only after a fresh, accurate, stopped position; saved-and-retried driver taps when offline; rider alerts that start as soon as a request is pending; per-trip scope for the phone helper's access.
4. Blocking a person should also hide their offers and cancel their future bookings; a "never match me with this person" option.
5. Server rule that a photo (and car plate for drivers) must exist before posting or requesting.

**Decision needed from you (new):** after a driver starts navigation in Google Maps, Google Maps cannot add a new pickup by itself. The review says to **stop offering new requests once navigation has started** (requests would only be accepted before departure). Today a notification Accept after departure opens RideShare to rebuild the route, which breaks the "never switch apps" rule. Do you want: (A) only accept requests before the driver starts (safest, my recommendation), or (B) keep accepting mid-drive and accept that the driver may have to open RideShare?
