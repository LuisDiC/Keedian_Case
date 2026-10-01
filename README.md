# Site 01 — Remote management dashboard
**Case study — IoT Engineer, Keedian**

- **Repository:** https://github.com/LuisDiC/Keedian_Case
- **Live prototype:** https://keedian-case.vercel.app/

A navigable, single-site dashboard for a convenience store (1 electrical panel, 2 rooftop units, 1 walk-in cooler), built to answer one question in the first 10 seconds: **what does the remote operator do right now, and why?**

---

## 1. How to run it locally

```bash
git clone https://github.com/LuisDiC/Keedian_Case
cd keedian-web
npm install
npm run dev        # http://localhost:5173
npm run build       # production build -> dist/
```

No environment variables, API keys, or backend to configure. The app is 100% static: it generates its own synthetic data in the browser, ticks live in memory, and reads or writes nothing external.

**Deployment (requirement 5.2):** the repo is imported into Vercel with zero configuration.
---

## 2. Which indicators I chose, and why (the most important section)

I put myself in the shoes of someone managing this store remotely, opening the dashboard between other sites. They don't want a wall of charts — they want a verdict, and if there's an alarm, they want to know which one to touch first and why it's worth their time.

### 2.1 The screen, top to bottom

**1. Status banner (one verdict).** `ALL CLEAR` / `MINOR ISSUES` / `ATTENTION TODAY` / `ACTION NOW`, plus the single highest-priority alarm and its reason in plain language. This is the entire "first 10 seconds" answer — everything below is for someone who wants to go deeper.

**2. Five KPIs**, each answering one question from the brief directly:
| KPI | Question it answers |
|---|---|
| Critical + major alarms open | *Which alarm do I attend to first, and why?* — count first, detail in the queue below |
| Cooler minutes above 41°F, last 24 h | *Was the product in the walk-in cooler at risk in the last 24 hours?* |
| Cooler temperature now | Immediate sanity check, independent of history |
| Energy vs weather-adjusted baseline, last 30 d vs previous 30 d | *Is the store consuming more than it should for this day and weather?* and *is this site doing better or worse than last month?* combined into one number |
| Site power now / power factor now | Instant sanity check on the panel meter itself, and a utility-cost signal (PF penalties) that the other KPIs don't capture |

**3. Alarm queue, ranked by priority** — not a chronological list. Each row shows severity, which asset, whether it's a **device alarm** (the controller raised it itself) or a **derived alarm** (Keedian's own rule caught something the device won't flag), how long it's been open, a one-line reason written for action, and a short numbered list of **suggested next steps** (e.g. for a door-open alarm: close it now, make it standing policy that the walk-in stays closed when not in use, check the door closer/gasket if it keeps recurring). This directly answers *"which alarm do I attend to first, and why — and what do I actually do about it?"*, which is the question the brief says a good dashboard must answer.

**4. Three time-series charts**, each tied to a KPI above rather than decorative:
- **Walk-in cooler, 24 h**, with a 41°F reference line, so defrost cycles (expected sawtooth) are visually distinguishable from a real excursion (a spike that doesn't recover).
- **Site power vs its own weather-adjusted expectation, 24 h** — answers *"is the store consuming more than it should for this day and this weather?"* as a shape, not just a number, so a schedule fault (RTU running all night) is visible as a gap between the two lines rather than just a KPI going red. Below the chart, a **branch-circuit breakdown** (RTU 1, RTU 2, refrigeration, lighting, plug loads, each as a bar against the panel total, updating live) covers the brief's requirement to monitor "the main service entrance plus branch circuits" — the total kW alone doesn't tell the operator *which* branch is driving a deviation, this does.
- **RTU cooling ΔT, 30 d**, target line at 15°F — answers *"is a piece of equipment degrading before it fails?"* This is the one chart a facility manager cannot get from the RTU's own controller: the unit doesn't alarm on a slow capacity loss, only on outright failure.
- **Power factor, 24 h**, target line at 0.90 — the branch breakdown explains *which* load drives consumption, this explains *how efficiently* the panel draws it. PF is derived per branch (motor-driven RTU/cooler compressors run lagging ~0.80-0.83, resistive defrost load near unity) and blended by apparent power, so it drops visibly whenever both RTUs are cooling at once — a real utility-billing signal a facility manager would otherwise only see once a month on the bill.

**5. Alarm history (30 d)** — a second tab, not the first thing shown, because "did this happen before" is a follow-up question, not an opening one.

### 2.2 What I deliberately left out
Per-circuit voltage/current tables, every setpoint, RTU fan-only mode detail, granular device tags. None of them change what the operator does today; they belong in a per-equipment drill-down (see §6), not the first screen.

### 2.3 Alarms: device vs. derived, and the priority formula
Alarms come from two sources, both shown and labelled:
- **Device alarms** — conditions equipment already reports itself (compressor fault, door open, filter clogged).
- **Derived alarms** — conditions I compute from raw telemetry because no controller will flag them on its own: cooler time-above-limit (with automatic escalation to "perishables at risk" past 2 h), RTU cooling-capacity loss (ΔT trending down with no fault code), and site consumption drifting above its weather-adjusted baseline.

Every rule has an explicit clear condition with hysteresis (a different threshold to close than to open) and minimum open/close dwell times, so alarms have a real start and end and don't flap on noise — this was a specific requirement in the brief. Each rule also carries its own **suggested actions** (a short, ordered list — e.g. "close the door" before "check the gasket" before "call a technician"), tuned to severity where it matters (a door-open alarm suggests closing the door; the same cooler crossing the 4h food-safety limit suggests assessing product for discard and dispatching a technician now). These live in `src/sim/engine.js` next to the rule itself, so the reason, the priority, and the recommended response are all generated from one place and never drift apart.

**Priority (0–100)** = `severity + asset criticality + business impact + age`:
- **Severity** — critical 60 / major 40 / warning 25 / minor 10.
- **Asset criticality** — cooler +15, RTU or meter +5 (perishable product outranks comfort/efficiency by design).
- **Business impact** — recomputed per sample from the actual data, not fixed per rule: e.g. the energy alarm's impact is the real extra cost in $/h × 10 (capped at 15); the cooler alarm's impact jumps from 8 to 20 once it crosses the 2 h food-safety escalation point.
- **Age** — +1 per 6 h an alarm has sat open, capped at +10, so a stale alarm nobody acknowledged rises even if nothing about it changed.

Example: *"Perishables at risk"* (cooler, critical, past 2h) = 60+15+20+0 = **95**. *"RTU filter clogged"* (minor, RTU) = 10+5+2+0 = **17**. The queue always puts perishable-product risk ahead of preventive maintenance, which is the intended behavior for a convenience-store operator.

### 2.4 Alarm acknowledgment vs. auto-close
The engine auto-closes an alarm when telemetry recovers (hysteresis logic in `src/sim/engine.js`). *Acknowledging* an alarm is a separate, human action layer on top of that — "an operator has seen this and is on it" is not the same fact as "the condition cleared," and conflating them loses operational information. In this static prototype, the **Acknowledge** button on the queue is a **local-only UI demo**: it's React state, not persisted, not shared between viewers, included so the interaction is visible in the presentation. A real deployment needs `acknowledged_by` / `acknowledged_at` columns on the `alarms` table, written through a small backend endpoint, then broadcast over MQTT (`keedian/site01/alarms/ack`) so every connected dashboard updates — the natural home for that endpoint is a Node-RED `http in` node in the docker-compose reference architecture, since Grafana alone has no action buttons for this.

---

## 3. Assumptions about the site, equipment, and data
- Single store, UTC-5, no DST modeled; open 06:00–23:00 daily (weekend traffic ~15% lower).
- 2× 5-ton rooftop units; healthy cooling ΔT ≈ 20°F; night setback raises the zone setpoint from 72°F to 78°F when the store is closed.
- 1 walk-in cooler; setpoint 36°F, alarm limit 41°F, 4 scheduled defrosts/day (02:00, 08:00, 14:00, 20:00 local), food-safety reference of 4 cumulative hours above 41°F before product is considered at risk.
- Electricity at $0.14/kWh, used only to translate the energy alarm's severity into a $/h figure.
- Standard instrumentation assumed per the brief: revenue-grade metering at the main panel (plus a breakdown I model by end use: RTUs, cooler, lighting, plug loads), controller-level RTU data (mode, zone/return/supply temp, setpoint, compressor amps, filter ΔP), and cooler temperature/door/defrost/compressor status.
- Alarm thresholds (41°F, 15°F ΔT, 1.0 in.w.c. filter ΔP, 15%/8% baseline hysteresis band) are my own engineering judgment, documented in `src/sim/engine.js`, not a client spec.

## 4. How I generated the synthetic data
`src/sim/model.js` is a deterministic function of time — `sample(t, anchor)` — not a random walk, so it produces the same coherent history on every load and the live ticks join it seamlessly:
- **Store traffic** as a sum of Gaussian bumps at breakfast/lunch/dinner/evening, scaled down on weekends, which drives lighting, plug load, and RTU demand.
- **Outdoor temperature** as a daily sine wave plus a slow seasonal drift plus small smooth noise (value noise interpolated between 5-minute knots — smooth like a real sensor, never flat or literally random).
- **RTUs** duty-cycle between fan-only and cooling based on that demand; supply/return/delta-T and compressor amps derive from whether the unit is actually cooling.
- **Cooler** follows a compressor sawtooth with defrost bumps at the scheduled times, plus occasional random door-open events (bounded duration, exponential recovery afterward).
- **Expected energy baseline** is computed from the same duty-cycle logic assuming healthy equipment and a normal schedule, so "actual vs. expected" is a like-for-like, weather-adjusted comparison rather than actual-vs-yesterday.
- **Three scripted incidents** are layered on top, anchored to the moment the app first loads so the story is always fresh: a walk-in compressor failure ending in a food-safety escalation ~19h before load, RTU-2 losing cooling capacity gradually over ~7 weeks with no device alarm, and RTU-1 intermittently failing to enter night setback (visible only as an energy-baseline deviation) plus a slowly clogging filter.

`src/sim/engine.js` (the alarm engine described in §2.3) runs over this stream both to backfill 60 days of alarm history at load and to evaluate each new live sample every 5 seconds, so historical and live alarms are produced by the exact same rules.

## 5. How I used AI in the process
I used Claude (Anthropic) as my main collaborator throughout the project, working conversationally rather than handing the task off wholesale — I drove the design and reviewed every result before moving on.

I started by describing the dashboard I had in mind: a rough sketch of the layout, the operational concept behind it (a remote operator who needs a verdict within the first ten seconds), and the KPIs I wanted the screen organized around. From there, Claude helped turn that into working code — component structure, chart logic, and the overall implementation. I specified the stack myself — Vite + React + TypeScript + Tailwind + Recharts, deployed as a static site on Vercel — because a facility-monitoring prototype with no real devices in scope doesn't need a backend, and a static build means the demo opens instantly and never cold-starts mid-presentation; that trade-off was my call, not a default Claude proposed. Claude also helped generate the synthetic telemetry itself: a deterministic model of store traffic, outdoor temperature, RTU duty cycles and the cooler's defrost cycle, plus the alarm engine's hysteresis logic so alarms have a real start and end instead of flapping on noise.

Separately, I shared a `docker-compose` reference I normally use for this kind of remote-monitoring work — Node, PostgreSQL/TimescaleDB, Grafana, Mosquitto — so Claude could sketch how this prototype would evolve into a production deployment with real devices. That reference lives in `reference-architecture/` as illustrative material only; it isn't wired into the deliverable and I haven't deployed it. Finally, I gave Claude this README in draft form and asked for help structuring it with language suited to a business case like this one — concrete, evidence-based, organized around the questions the brief itself asks.

What stayed mine throughout: the indicators and the information hierarchy (§2), the alarm thresholds and the priority formula (§2.3), the asset-criticality weighting (perishable product over comfort/efficiency), the assumptions about the site (§3), and what I deliberately left off the first screen. I also drove the review loop: I tested the deployed dashboard against what it was supposed to show, and caught several cases where the implementation didn't match the intent yet — a branch-circuit breakdown I'd described in an earlier pass wasn't actually rendered in the UI, defrost cycles were present in the underlying data but visually erased on the chart by an unrelated incident spike, and the alarm-history table and the live queue could show different alarms at the top because they sorted on different fields. I flagged each of these specifically and had Claude fix them. That back-and-forth — knowing what a correct dashboard should show well enough to catch where the code didn't — is the part of "using AI" I'd want to walk through in the interview.

## 6. What I'd add with more time
- Per-equipment drill-down views (RTU detail with fan/cooling mode history, cooler detail with defrost log).
- A persisted version of the acknowledge/assign workflow (see §7) — the queue already has the interaction, it just isn't wired to a backend yet.
- A dedicated energy/cost view (daily $ vs. baseline, not just kW).
- Trend-based early warning (e.g., forecasting when RTU-2's ΔT will cross the failure threshold) instead of a static rule.
- Automated tests for the alarm engine's hysteresis and priority logic.

## 7. Plus — production reference architecture
This prototype is intentionally a static site: no real devices are in scope, so a backend would add deployment risk (cold starts, infra to babysit during the presentation) without adding a feature the brief asks for. But a real site has a controller/gateway pushing live data, so `reference-architecture/docker-compose.yml` sketches the stack I'd stand up for that — it's reference material only, **not wired into this app, not deployed, and not required to run this deliverable**.

| Service | Role |
|---|---|
| **Mosquitto** | MQTT broker — the gateway-to-cloud hop a real site controller would publish telemetry to. |
| **Node** | A small service that would reuse the exact same `src/sim/model.js` / `src/sim/engine.js` from this repo (same source of truth, two targets) to simulate a gateway and run the alarm engine against incoming telemetry — or, with real devices, replace the simulator half and keep the alarm-engine half unchanged. |
| **PostgreSQL + TimescaleDB** | One database for both jobs: a hypertable for telemetry time series (what InfluxDB does in a typical IoT stack, without adding a second database technology) and a plain relational table for the `alarms` registry (start, end, priority, reason, and the acknowledgment columns described in §2.4). |
| **Grafana** | Ops-facing dashboards over that same database, for the audiences (shift leads, techs) who live in Grafana day to day rather than this React app. |

`reference-architecture/.env.example` lists the variables the compose file expects (none of them secrets — defaults are provided so the file documents the shape of the configuration, not actual credentials). Both files are meant to be read, not run as part of grading this submission.
