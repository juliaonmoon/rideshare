# Market Research

_Updated 2026-10-06. BC focus. Based on web search summaries; several company sites were not reachable from my environment, so **nothing here is independently verified**. Before relying on it, install the BC apps below and test them yourself._

## Bottom line

**BC is not empty.** There are already free and paid commuter carpool apps in Metro Vancouver, one of them backed by TransLink. A new app needs a clear reason to exist. See "What's left for us" at the end.

## BC / Canada competitors

| App | Who / where | How it works | Cost | Status & notes |
|---|---|---|---|---|
| **[Metro Vancouver Carpool](https://www.liftango.com/app/metro-vancouver-carpool)** (Liftango) | **TransLink "Travel Smart" initiative**, Metro Vancouver | Real-time matching and trip scheduling for employees/students. Sign-up needs a company email registered with TransLink. 2024–25 [challenge](https://buzzer.translink.ca/2025/01/swipe-right-on-this-app-to-find-your-carpooling-match/) gave prizes for carpooling to Park & Rides | **Free** to users | Active. **Strongest competitor: free, funded by TransLink, aimed at employers and students.** |
| **[gobyRIDE](https://www.gobyride.com/Public/WebPage.aspx?n=Overview)** | Vancouver region | Drivers post trips; passengers request by route and preference; in-app payment, in-app messaging, live map; **points** for participation | $0.58/km (CRA-limited) + **15% fee**; 2 riders halve the price | Active. **Closest to our idea** (cost-share + points + price drops with more riders). |
| **[Poparide](https://www.poparide.com/en-ca/)** | Vancouver HQ, national | **City-to-city** (e.g. Vancouver–Whistler $15/seat) | Driver sets price; passenger booking fee ~20%; driver payout fee ~3% ([fees](https://support.poparide.com/en/articles/9704847-how-much-are-the-fees-to-use-poparide)) | Active, 2M+ users claimed. **Not a daily-commute product.** |
| **[Carpooll.com](https://carpooll.com/)** | Canada-wide | City-to-city, driver sets price, women-only "Pinkpool", in-app payment | Free download | Active, small. Intercity. |
| **[CarpoolWorld](https://www.carpoolworld.com/carpool_British_Columbia_CAN.html)** | Canada-wide web | Listings board for rides | Mostly free | Old-style, low engagement. |
| **[Go2gether](https://www.go2gether.ca/terms.php)** | Vancouver startup (2013), trialled by SFU, Vancity, YVR | Suggested payments, cash in person, not-for-profit intent | — | **Unclear if still operating** (only old coverage found). |
| **Jack Bell Ride-Share** | Vancouver nonprofit, TransLink-funded | Vanpools 1992–2017, ride-matching site 2005–2018 | — | **Ended.** A nonprofit carpool in BC has been tried and wound down. |
| Uber / Lyft | Metro Vancouver since Jan 2020 | On-demand paid rides | Market fares | Active. Different product (professional drivers, real fares). |

Outside BC (for reference): [Waze Carpool](https://techcrunch.com/2022/08/26/googles-waze-shutting-down-its-carpool-service/) shut down 2022; [Hytch](https://sustainableamerica.org/blog/hytch-an-app-that-pays-you-to-carpool/) pays sponsor-funded rewards per mile; [Scoop](https://www.scoopcommute.com/solutions/for-employers) sells to employers.

## Comparison (from public descriptions — verify by testing)

| | **Us (planned)** | Metro Van Carpool (Liftango) | gobyRIDE | Poparide | Carpooll |
|---|---|---|---|---|---|
| Daily commute | Yes | Yes | Yes | No | No |
| Cost to rider | Gas share or points | Free app; riders/drivers arrange cost (unconfirmed) | $0.58/km + 15% | Price + ~20% | Driver-set |
| Platform fee | Your call (nonprofit = ~0) | None to users | 15% | ~20% + ~3% | Unclear |
| Points system | Earn by driving, **spend on rides** | Prizes in challenges | Participation points (can they pay for rides? unclear) | No | No |
| Driver sets max detour / wait | **Core feature** | Unclear | Preferences, unclear | No | No |
| Price falls with more riders | Yes | Unclear | **Yes** | Per seat | Per seat |
| Backed by TransLink / employers | No | **Yes** | Listed by TransLink | No | No |
| Women-only option | Planned | Unclear | Unclear | Unclear | **Yes** |
| Works for any commuter (no employer email) | Yes | **No** (company/student email) | Yes | Yes | Yes |

## What's left for us

Gaps that appear real (still to be confirmed by trying the apps):
1. **People without an employer or school on TransLink's list.** The free TransLink app needs a registered company email; small employers and independents may be left out.
2. **Driver-first matching.** Nobody I found leads with "set your maximum detour and wait, we only show riders who fit."
3. **Points you can actually spend on rides.** gobyRIDE's points sound like loyalty rewards; a closed-loop "drive to earn, ride to spend" currency may be different. Unconfirmed.
4. **Non-profit, no-fee positioning.** gobyRIDE takes 15%, Poparide ~23%.

Weak points:
- A free, government-funded rival is hard to beat on price.
- The density problem (Waze Carpool) hits every new entrant, and a previous BC nonprofit (Jack Bell) wound down.
- gobyRIDE already covers much of the feature list.

## Recommendation

1. **Do not start by building a full app.** The market is crowded enough that building first is the risky path.
2. **Step 1 (a week or two, no cost):** install Metro Vancouver Carpool and gobyRIDE, try to set up a Burnaby commute on each, and write down what is annoying or missing. That is your real feature list.
3. **Step 2:** talk to TransLink Travel Smart / Liftango and to gobyRIDE. A partnership or running your idea as a pilot on top of an existing platform may be faster than a new app.
4. **Step 3, only if gaps are confirmed:** build a small app for the gap (e.g. independents and small employers, driver-first matching, spendable points).

## Legal / insurance (not legal advice)

- BC [exempts carpools](https://www2.gov.bc.ca/gov/content/family-social-supports/seniors/transportation/carpooling-and-car-sharing) from the Passenger Transportation Act when the driver receives **no compensation beyond contributions to operating costs**, total contributions don't exceed the trip's operating cost, and it is one return trip between home and work/common destination.
- Per search summaries of ICBC guidance, if passengers only share actual trip costs (fuel, insurance, wear, parking, tolls — not depreciation) the driver keeps their **normal personal-use rate class** and liability coverage applies. If the driver **profits**, it becomes for-hire driving needing different insurance. **Confirm with ICBC.**
- Points: unconfirmed how ICBC treats them. Keep them ride-only, no cash-out, valued at no more than the driver's real cost share.
