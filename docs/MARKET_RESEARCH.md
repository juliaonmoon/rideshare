# Market Research

_Based on web searches on 2026-10-05. Figures come from search summaries and are **not independently verified** — check before using them in anything external._

## Competitors

| App | Model | Status / notes | Lesson for us |
|---|---|---|---|
| [Waze Carpool](https://techcrunch.com/2022/08/26/googles-waze-shutting-down-its-carpool-service/) | Matched commuters on their route; reimbursed drivers per mile | **Shut down Sept 2022** after hybrid work cut commuter density | Needs many people on the same route at the same hour. Hybrid work hurts. |
| [Hytch Rewards](https://sustainableamerica.org/blog/hytch-an-app-that-pays-you-to-carpool/) (US) | **Sponsors** (e.g. Nissan, banks) pay users cents per mile; cash out at $10 | Active in Tennessee | Closest to "rewards" idea, but money comes from sponsors, not riders |
| [Scoop](https://www.scoopcommute.com/solutions/for-employers) (US) | Rider pays distance-based fee through app; app takes a cut; sold to **employers** | Active, enterprise focus | Employer channel is how this survives |
| [Carma / GoCarma](https://en.wikipedia.org/wiki/Carma) (US) | Cost-sharing + automatic HOV verification | 75,000+ users on a Dallas toll-discount deal (per search result) | Government/toll partnerships can fund it |
| [Poparide](https://www.vancouverisawesome.com/local-news/poparide-carpool-bc-1940638) (Vancouver) | Intercity carpool, ~2M members claimed | Active; **not** a daily-commute product | Strong local brand, but different use case |
| Netlift (Montréal) | Commuter carpool, Quebec | Active; Poparide's top competitor per [Owler](https://www.owler.com/company/poparide/competitors) | Canadian commuter competitor to study |
| gobyRIDE (Metro Vancouver, TransLink) | Carpool matching; ~$0.58/km + 15% fee per [TransLink-area listing](https://www.translink.ca/rider-guide/driving/carpooling-and-carsharing) | Active | **Direct local competitor** and a useful price benchmark |
| Others in Canada | R-Hero, Kabu, HOVR, Loop Rideshare, CarpoolWorld ([list](https://www.savvynewcanadians.com/rideshare-apps-carpooling-canada/)) | Small | Fragmented market, no clear commuter winner found |
| Uber / Lyft | Paid on-demand rides | Dominant, but real money and professional-style | Not the same product; no cost-sharing for commuters |

## Feature comparison (our judgement from public descriptions)

| Feature | Us (planned) | gobyRIDE | Scoop | Hytch | Poparide |
|---|---|---|---|---|---|
| Daily commute focus | Yes | Yes | Yes | Yes | No (intercity) |
| Driver sets max detour | **Yes (core)** | Unclear | Partly | Unclear | No |
| Points paid by riding **and** earned by driving | **Yes** | No | No | Sponsor rewards only | No |
| Cash cost-share option | Yes | Yes | Yes | Rewards payout | Yes |
| Price drops with more riders | **Yes** | Unclear | Unclear | N/A | Per seat |
| Employer dashboard | Planned | Unclear | Yes | Yes | No |

"Unclear" = I could not confirm from public info; verify by downloading the apps.

## Is there still an opportunity?

**Yes, narrowly.**

For:
- Metro Vancouver households spend about [$19,000/yr on transportation](https://metrovancouver.org/services/regional-planning/Documents/transportation-cost-estimate-technical-report.pdf) (per Metro Vancouver report), almost all of it car costs.
- No clear winner in Canadian daily-commute carpooling.
- A driver-first design and a closed-loop points system are real, not copied, ideas.

Against:
- The category has a history of failing on **density** (Waze Carpool).
- Hybrid work shrinks the number of people with the same schedule.
- gobyRIDE already exists locally with TransLink ties.
- Cost-sharing law caps what drivers can earn (see Business Plan), so the "earn" appeal is limited.

**Conclusion:** Worth a small, cheap pilot. Not worth a big upfront build.

## Legal / insurance flags (not legal advice)

- BC [exempts carpools](https://www2.gov.bc.ca/gov/content/family-social-supports/seniors/transportation/carpooling-and-car-sharing) from the Passenger Transportation Act only if the driver gets **no compensation beyond contributions to operating costs** (gas, tolls, insurance, maintenance), total contributions can't exceed the trip's operating cost, and it's a return trip between home/work/common destination.
- [ICBC personal insurance may be void](https://www.tranbc.ca/2020/01/23/everything-you-wanted-to-know-about-ride-hailing-in-bc/) if a driver is carrying **paying** passengers outside that exemption. Must confirm with ICBC/a lawyer.
- Points that can be cashed out may count as money-like value — keep them **ride-only, non-transferable, no cash-out** unless a lawyer says otherwise.
