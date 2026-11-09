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

## Gathered from older docs and chats (added 2026-11-09)
### Product ideas (docs/REQUIREMENTS.md: P1 = soon after launch, P2 = later)
- P1: Share-my-trip link and an emergency button. (A "share this ride" message already exists.)
- P1: In-app chat with phone numbers hidden.
- P1: Women-only / same-company-only matching (needs legal review).
- P1: Insurance guidance screen ("what is covered").
- P1: Employer dashboard (participation, CO2, parking saved).
- P1: Rider-to-driver "I'm running late" automatic update.
- P2: HOV-lane and parking-perk tie-ins.
- P2: Savings and CO2 tracker.

### Driver wishes (docs/UX_REVIEW_2026-11-05.md, "Missing things a driver would reasonably expect"; check which are already done)
- Driver can send the rider a plan message ("I leave at 7:42, pick-up at X").
- Show "You will earn 17 pts" on every request and on the plan.
- If the window can't be edited after a rider locks it: say why and offer "Cancel and repost".
- Show the rider's ready window on the plan, and tell the driver when they may drive on.
- "1 of 3 seats taken" on the trip card.
- "Repost this trip" shortcut from past trips.
- Undo for Accept within about 1 minute.
- Optional decline reason (too far, time does not suit).
- One place to see the next 7 days of a repeating trip with the riders for each day.

### Business and launch decisions (docs/OPEN_QUESTIONS.md; mostly unanswered)
- Name: is "RideShare" final? Points for drivers who never ride (perks, sponsor rewards, or cash)? Platform fee (10-15% of cash shares or none until employers pay)? Profit or non-profit (leaning: no fee, funded by employers/grants)?
- Pilot first (30-50 commuters, no-code) or build first? Try the existing apps (Liftango, gobyRIDE) for 1-2 weeks first?
- Employer check: is Electronic Arts (Burnaby) on TransLink's registered-employer list? (email travelsmart@translink.ca)
- Scope: commute-only in BC first, long-distance and cross-border later (docs/EXPANSION_BEYOND_METRO.md).
- Check the employment agreement (IP ownership, outside business activity) before stage 1 (docs/STAGED_PLAN.md).

### Small clean-ups and chores
- Remove the "Test version" banner and sample riders before real launch (say "go live mode").
- Migration 056 (extra places) was not needed by the app; the row in TODO_FOR_JULES.md says so.
- Code-review leftovers from 2026-11-09: slow saves for drivers with very many repeating trips; other people's place names can appear in your place list; one temporary Google error turns address search off until reload; dead code in the Trips filter (old chip buttons).
- Jules only: set a Google Cloud budget alert (Claude makes no Google Cloud changes).
- Rejected on purpose: "change this date and all following dates" (too complicated).
- Not covered: older chats from before 2026-11-09 may hold items that were never written down; tell Claude if you remember one.

## Driver late / did not arrive (researched 2026-11-09; Jules: revisit later)
- Market: Uber waives the rider's cancel fee when the driver is 5+ minutes past the original arrival time or not making progress (Uber blog "changes to cancellation fees"). Lyft is reported to do the same (secondary sources, unverified). Poparide has no fixed minutes: the passenger reports a no-show after pickup time, support investigates, a verified no-show is a full refund.
- The rider is never forced to wait. They can cancel any time before pickup. The question is only whether it costs them points. Today a rider cancelling inside 2 hours loses half the points after the first free one each month, even if the driver is the late one.
- Proposed middle ground: rider may always cancel; free with full refund once the driver is 5+ minutes past pickup time with no "arrived" tap; goes on the driver's record only if the driver gave no heads-up; ride closes as "driver did not arrive" at 15 minutes with no word; automatic "driver is stuck in traffic" notice to the rider. Needs Jules' OK (points rule).
