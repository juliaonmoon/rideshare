# Recommendation: which redesign?

## TLDR

- Pick **Direction B (Rethink)**: bottom tabs (Home, Trips, Points, Me) plus a Driving / Riding switch.
- It fixes all six known problems at the root. Direction A only treats the symptoms.
- Rough size: **medium, about 6 to 9 working days** (estimate, not measured). Direction A is about 3 to 4 days.
- Do first: test both mockups with 3 or 4 friends on a real phone before any code.

## Why B

| Problem | A (tidy up) | B (rethink) |
|---|---|---|
| 5 cramped tabs | Shorter labels and icons. Still 5. | 4 bottom tabs. Thumb reach. |
| Long single-column pages | Still long. | Map on top, one sheet below, one action. |
| Look-alike buttons | Renamed. Both still on one page. | Offer a ride now is a switch. Start my trip is the one big button. |
| No "what next" | A banner on each page. | The sheet title is the next step. |
| Unclear role | Role is a tab. | A visible Driving / Riding switch on Home. |
| Map far from actions | Map is inside a card. | Map sits right above the action. |

A is the safe fallback. It keeps the owner's current structure and can ship in small steps.

## Honest notes

- **Research is partly unverified.** I did search-level reading only (see `research.md`). I did not open the Uber, Lyft or BlaBlaCar apps. Tab names and in-trip screens are from memory.
- Verified in sources: Waze Carpool shut down in 2022. Trust tools (PIN, share trip, emergency button) are common.
- Bottom tabs and a role switch are my judgement, not proven by those apps.
- Of the live app, I read only the README, the tab buttons in `index.html`, and the handoff headings. I did not run it or read `live.js`.
- Safety features (verified badge, car details, ride PIN, SOS, report/block) are shown as if they exist. They are **planned**. The mockups mark some as "Planned".
- The mockups are static. Nobody has tapped them on a phone yet.
- Numbers, names and plates are made up.

## Risks

1. **Rework of `index.html` and `live.js`.** B moves screens around. Bugs can appear in flows that work today. Mitigation: keep logic as is, change only layout, test each flow.
2. **Android WebView quirks.** Fixed bottom bars and the on-screen keyboard can clash. Test on a real phone early.
3. **Driving mode and the helper app** depend on Android alerts and Google Maps hand-off. This design does not change that. It is a separate risk.
4. **Safety features are big.** SOS and PIN need backend work. If not built, remove them from the screens. Do not show buttons that do nothing.
5. **Mode switch may confuse some people.** Test it.

## Rough build size (estimates)

- Direction B: 6 to 9 days. New shell and nav (2), Home for both modes (2 to 3), ride screen (1), Trips, Points, Me (1 to 2), polish and test (1).
- Direction A: 3 to 4 days.
- Safety features: extra, not counted. Each is its own piece of work.

## What to do first

1. Open both mockups on a phone. Ask 3 or 4 friends to do: post a trip, start it, accept Rae.
2. Pick one. If unsure, choose B.
3. Check the Android helper and alerts work with the new layout before polishing.
4. Build Home first (both modes). Ship it behind a switch, then move the other screens.
5. Decide which safety items are real for launch. Hide the rest.
