# Backlog (the one place for "later")

Newest decisions first. Nothing here is being built. Jules decides what moves up. Helpers: add items here, don't start them.

## Decided by Jules (2026-11-09)
- **Adults only (18+).** Reason: minors cannot return the favour (the ride-sharing is two-way).
- **Exact addresses stay.** Accuracy matters more. Hiding addresses and public pickup points are parked (see below).
- **Points: no buying, refunding or cashing out for now.** Revisit later. Not a priority.
- **First route / employer / campus:** does not matter for now.
- **Next to build:** reliability record, then cancellation and no-show rules. After that: the rider's view requirements.

## Parked ideas (from the ChatGPT review, 2026-11-09; full text in `team-chat/notes/2026-11-09-1000-from-chatgpt-to-claude.md`)
| Item | Size | Note |
|---|---|---|
| Hide exact addresses until a ride is confirmed; suggest public pickup points | medium | Jules chose exact addresses for now |
| Identity and driver verification (ID, licence, vehicle, insurance) | large | Costs money per check; see TODO_FOR_JULES section 4 |
| Private in-app messages (no phone numbers shown) | medium | |
| Safety tools: share trip, emergency screen, trusted contacts | large | |
| Push notifications for every step (matches, approvals, reminders, "leave soon") | medium | Some alerts exist in the Android app |
| Real payment handling (buy, refund, payout, disputes) | large | Parked: points stay closed-loop |
| Saved recurring commute that matches automatically | large | |
| Accessibility and personal needs (wheelchair, service animal, luggage, child seat, quiet ride, women-only) | medium | Women-only etc. needs legal review |
| Riders double-booking (drivers are already protected) | small | Asked, not answered |
| Launch with a few dense routes or employers | plan | Jules: does not matter for now |

## Legal questions to answer before real launch (Jules does not know these yet; a BC lawyer and ICBC can)
1. **Is it still a "carpool" in BC law?** The trip must be the driver's own journey and contributions must not exceed the real running costs. Do points, flexible destinations or several trips a day change that?
2. **How do we enforce "the driver never profits"?** A maximum contribution by distance, counting all passengers together.
3. **Does the driver's ICBC insurance still cover these trips** (injury, damage, deductibles, underinsured drivers, trips into the USA)? Must drivers tell ICBC?
4. **Platform liability:** general liability, cyber and directors' insurance; what happens if we verify someone wrongly or ignore a safety complaint.
5. **Are points "stored value"?** If points can be bought, refunded, transferred or cashed out, payment and consumer rules may apply. Closed-loop points keep this simple.
6. **Privacy:** exact home/work/schedule/messages are sensitive. Consent, deletion periods, account deletion, no background location tracking.
7. **What may we claim when someone is "verified",** how often documents must be renewed, what records we must keep.
8. **Cross-border (USA) trips:** insurance, customs, payments and local transport laws. Until answered, consider turning off US and cross-border booking (address search can stay).
9. **Terms of use:** cancellations, refunds, damage, misconduct, service animals, discrimination, bans, law-enforcement requests. Have counsel read the real product flow.

## Older backlog (still open)
- Support contact, identity checks, legal and insurance: `docs/TODO_FOR_JULES.md` sections 3 and 4.
- Real two-phone test: `docs/TODO_FOR_JULES.md` section 2 (most important).
- iPhone options, Play Store, Supabase settings before real users: `docs/TODO_FOR_JULES.md` sections 5 to 7.
- Decisions list: `docs/OPEN_QUESTIONS.md`.

## Cancellation and no-show gaps (found 2026-11-09; the rider side is already covered: 2-hour late rule, one free late cancel a month, half the points kept, driver can mark a missed pickup)
- A rider cannot report that the DRIVER never showed. Today the driver still gets the points after 3 hours. Idea: rider taps 'Driver did not arrive' 15+ min after pickup time, gets all points back, it goes on the driver's record. (Money rule: needs Jules' OK.)
- A driver who cancels late has no consequence except a count (already shown as 'cancelled rides (30 days)').
- No repeat-offender rule yet (for example a warning or pause after several no-shows).
