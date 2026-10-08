# Cost Estimate (rough, USD unless noted)

_2026-10-08. Ranges mix **published vendor estimates** (marked "src") and **my own judgement** (marked "est"). Vendor figures come from app-development companies that profit from higher quotes. Get 3 written quotes against the feature list in REQUIREMENTS.md before committing money._

## Three ways to do it

| | A. Pilot first | B. Lean MVP | C. Agency build |
|---|---|---|---|
| What | Thin web app / PWA + spreadsheet matching for ~30–50 EA commuters | One cross-platform app (React Native or Flutter), P0 features only | Full custom app, both stores, QA, design |
| Build cost | ~$0–2K cash (your time, AI-assisted coding) | **$15K–40K** | **$40K–70K** (src) |
| Time | 2–6 weeks | 3–5 months (src: 6–14 weeks focused MVP; 4–7 months typical) | 4–7 months |
| Purpose | Prove people use it | Launch in BC | Launch with polish |

Published breakdowns (src): discovery $3–8K, design $5–15K, MVP core (register, post route, search, book, payments, ratings, iOS + Android) $15–18K, launch/testing/security/store submission $8–20K. Basic carpool app $20–35K, mid-level $40–70K. Uber-style ride-hailing MVPs run $120K–$600K, which we are **not** building.

## Build cost levers
- **One cross-platform framework** saves 25–40% over separate native apps (src).
- **Region of developers:** US/Western Europe $100–200/hr vs South Asia $25–60/hr (src). Cheaper isn't always cheaper; fix scope and milestones in writing.
- **Cut P1/P2 features.** No payments to process (points + cash settled outside the app) removes the most expensive and riskiest part. Matching, recurring trips and ratings are the core.

## Infrastructure & running costs (pilot to ~1,000 users) — est

| Item | Monthly | Notes |
|---|---|---|
| Hosting + database (e.g. Supabase/Firebase/small VPS) | $0–50 | Free tiers cover a pilot |
| Maps / routing | $0–100 | Google Routes: [10K free events/month per SKU, then ~$5 per 1K](https://developers.google.com/maps/billing-and-pricing/pricing) (src, not fully verified). Mapbox: [100K free requests/month, then ~$2 per 1K](https://storerocket.io/learn/mapbox-pricing) (src, sources disagree). Cache routes; matching uses many route calls |
| Push notifications | $0 | Apple/Google free |
| SMS or email verification | $0–50 | Work-email verification is free; SMS costs cents each |
| Monitoring, email, misc | $0–50 | |
| **Running total** | **~$0–250/mo** at pilot, rising with use | Per-user cost is mostly maps |

## One-time / yearly fixed costs — est

| Item | Cost |
|---|---|
| Apple Developer account | $99/yr |
| Google Play account | $25 once |
| Domain, email | ~$20–50/yr |
| **BC lawyer** (cost-sharing rules, ICBC, terms of service, privacy policy, points rules) | **~$1,500–5,000** |
| Non-profit society or company setup | ~$100–1,000 |
| Liability / cyber insurance for the platform | ~$1,000–3,000/yr |
| Safety/background checks per driver (if used) | per-check fee, varies |
| Marketing / launch events / employer outreach | $1,000–5,000 |

## Ongoing after launch
- **Maintenance and support:** typically 15–20% of build cost per year (est), or a part-time developer.
- **Customer support and safety reports:** your time, or a paid part-time person once there are real users.

## Year-1 total

| Scenario | Rough total |
|---|---|
| **A. Pilot only** | **~$2K–6K** (lawyer + accounts + hosting + small outreach) |
| **B. Lean MVP launched in BC** | **~$25K–55K** (build $15–40K + legal/insurance $3–8K + running $1–3K + launch $2–5K) |
| **C. Agency build** | **~$55K–95K** |

## Revenue to set against it
- Non-profit with no rider fee: income comes from **employer subscriptions, grants (e.g. transit/climate programs), sponsors**. None are confirmed; ask TransLink Travel Smart what funding exists.
- A 15% fee (gobyRIDE-style) on ~100 active riders is on the order of $8K/month on my earlier illustration, but that assumes 100 active, matched riders, which is the hard part.

## Recommendation
Spend **Scenario A first (~$2–6K)**. Decide on B only if the pilot shows real usage at EA and at least one funding source (employer fee or grant) looks plausible.
