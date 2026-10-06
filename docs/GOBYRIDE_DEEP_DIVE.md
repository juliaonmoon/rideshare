# gobyRIDE Deep Dive

_2026-10-06. Based on web search summaries only (company sites were mostly unreachable). Small samples, possibly out of date. Verify by installing the app._

## Who is behind it

- gobyRIDE is the public-facing app of **[RideShark](https://www.crunchbase.com/organization/rideshark)**, an **Ottawa** company founded in 2002.
- RideShark's main business is **enterprise**: a white-label carpool platform that employers brand as their own, with employer-designed rewards. gobyRIDE is the open, public network on the same technology (the store listing is titled "gobyRIDE – Rideshark Mobile App").
- [TransLink](https://www.translink.ca/rider-guide/driving/carpooling-and-carsharing) lists gobyRIDE as a carpool option in Metro Vancouver.
- Funding found: only about $30K from an accelerator (Crunchbase summary, low confidence). It looks like a small, long-running, bootstrapped company, not a venture-backed growth story.

## Is it 100% the same as our idea?

**No. It overlaps heavily, but not entirely.**

| | gobyRIDE (as described publicly) | Our idea |
|---|---|---|
| Cost sharing | Yes, $0.58/km (CRA-limited), split by number of riders | Yes |
| Price drops with more riders | **Yes** | Yes |
| Points | Rewards "for participation, actions and sharing" — **loyalty-style**; not clear they can pay for a ride | Earn by driving, **spend on rides** (closed loop) |
| Platform fee | **15%** | None / non-profit |
| Driver sets max detour and wait | Matching by distance and route; **no evidence of a driver-set detour limit** | Core feature |
| Driver recommendations ("here's a qualified rider") | Automatic matching exists | One-tap suggestions within the driver's limits |
| Business | For-profit, sells to employers | Non-profit |
| Reach | Metro Vancouver and "anywhere" | BC first |

**Closest match:** the cost-split and the points concept. **Real differences:** no rider fee, driver-first detour/wait control, and points that are actually spendable (still to be confirmed by testing).

## Are they successful?

Evidence is thin and leans modest:

- **Alive for years** and listed by TransLink — that counts for something in a category where Waze Carpool and Jack Bell ended.
- **Small consumer footprint:** Google Play shows about **1K+ downloads**; Apple App Store shows **2.3 stars from only 3 ratings**.
- **Reviews:** one user "found a match and saved money"; another found no results for any city and reported crashes and glitches.
- No public user numbers, trips completed or revenue found.

**My read:** the public app does not look like a runaway success. It probably survives on RideShark's employer business. That is consistent with the pattern seen elsewhere: the consumer side struggles with **not enough people on the same route**, and the money is in selling to employers.

## What this means for us

1. Their weak spot is likely **match density and app quality**, not the idea. We would have the same density problem.
2. A non-profit with **no 15% fee** is a real price advantage, but only if people can actually find a match.
3. Before building, **install gobyRIDE and the TransLink/Liftango app**, enter your Burnaby commute, and record how many matches each shows at 7:30am.
