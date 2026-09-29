# Site 01 — Remote management dashboard
**Case study — IoT Engineer, Keedian**

- **Repository:** `<your GitHub URL>`
- **Live prototype:** `<your Vercel URL>`

A navigable, single-site dashboard for a convenience store (1 electrical panel, 2 rooftop units, 1 walk-in cooler), built to answer one question in the first 10 seconds: **what does the remote operator do right now, and why?**

---

## 1. How to run it locally

```bash
git clone <your GitHub URL>
cd keedian-web
npm install
npm run dev        # http://localhost:5173
npm run build       # production build -> dist/
```

No environment variables, API keys, or backend to configure. The app is 100% static: it generates its own synthetic data in the browser, ticks live in memory, and reads or writes nothing external.

**Deployment (requirement 5.2):** the repo is imported into Vercel with zero configuration (Vite is auto-detected). A `netlify.toml` is also included in case Netlify is preferred instead. Every push to `main` redeploys automatically.

---

## 2. Which indicators I chose, and why (the most important section)

I put myself in the shoes of someone managing this store remotely, opening the dashboard between other sites. They don't want a wall of charts — they want a verdict, and if there's an alarm, they want to know which one to touch first and why it's worth their time.

### 2.1 The screen, top to bottom

**1. Status banner (one verdict).** `ALL CLEAR` / `MINOR ISSUES` / `ATTENTION TODAY` / `ACTION NOW`, plus the single highest-priority alarm and its reason in plain language. This is the entire "first 10 seconds" answer — everything below is for someone who wants to go deeper.

**2. Four KPIs**, each answering one question from the brief directly:
| KPI | Question it answers |
|---|---|
| Critical + major alarms open | *Which alarm do I attend to first, and why?* — count first, detail in the queue below |
| Cooler minutes above 41°F, last 24 h | *Was the product in the walk-in cooler at risk in the last 24 hours?* |
| Cooler temperature now | Immediate sanity check, independent of history |
| Energy vs weather-adjusted baseline, last 30 d vs previous 30 d | *Is the store consuming more than it should for this day and weather?* and *is this site doing better or worse than last month?* combined into one number |

**3. Alarm queue, ranked by priority** — not a chronological list. Each row shows severity, which asset, whether it's a **device alarm** (the controller raised it itself) or a **derived alarm** (Keedian's own rule caught something the device won't flag), how long it's been open, and a one-line reason written for action, not for a log file. This directly answers *"which alarm do I attend to first, and why?"* — the question the brief says a good dashboard must answer.

**4. Three time-series charts**, each tied to a KPI above rather than decorative:
- **Walk-in cooler, 24 h**, with a 41°F reference line, so defrost cycles (expected sawtooth) are visually distinguishable from a real excursion (a spike that doesn't recover).
- **Site power vs its own weather-adjusted expectation, 24 h** — answers *"is the store consuming more than it should for this day and this weather?"* as a shape, not just a number, so a schedule fault (RTU running all night) is visible as a gap between the two lines rather than just a KPI going red. Below the chart, a **branch-circuit breakdown** (RTU 1, RTU 2, refrigeration, lighting, plug loads, each as a bar against the panel total, updating live) covers the brief's requirement to monitor "the main service entrance plus branch circuits" — the total kW alone doesn't tell the operator *which* branch is driving a deviation, this does.
- **RTU cooling ΔT, 30 d**, target line at 15°F — answers *"is a piece of equipment degrading before it fails?"* This is the one chart a facility manager cannot get from the RTU's own controller: the unit doesn't alarm on a slow capacity loss, only on outright failure.

**5. Alarm history (30 d)** — a second tab, not the first thing shown, because "did this happen before" is a follow-up question, not an opening one.

### 2.2 What I deliberately left out
Per-circuit voltage/current tables, every setpoint, RTU fan-only mode detail, granular device tags. None of them change what the operator does today; they belong in a per-equipment drill-down (see §6), not the first screen.

### 2.3 Alarms: device vs. derived, and the priority formula
Alarms come from two sources, both shown and labelled:
- **Device alarms** — conditions equipment already reports itself (compressor fault, door open, filter clogged).
- **Derived alarms** — conditions I compute from raw telemetry because no controller will flag them on its own: cooler time-above-limit (with automatic escalation to "perishables at risk" past 2 h), RTU cooling-capacity loss (ΔT trending down with no fault code), and site consumption drifting above its weather-adjusted baseline.

Every rule has an explicit clear condition with hysteresis (a different threshold to close than to open) and minimum open/close dwell times, so alarms have a real start and end and don't flap on noise — this was a specific requirement in the brief.

**Priority (0–100)** = `severity + asset criticality + business impact + age`:
- **Severity** — critical 60 / major 40 / warning 25 / minor 10.
- **Asset criticality** — cooler +15, RTU or meter +5 (perishable product outranks comfort/efficiency by design).
- **Business impact** — recomputed per sample from the actual data, not fixed per rule: e.g. the energy alarm's impact is the real extra cost in $/h × 10 (capped at 15); the cooler alarm's impact jumps from 8 to 20 once it crosses the 2 h food-safety escalation point.
- **Age** — +1 per 6 h an alarm has sat open, capped at +10, so a stale alarm nobody acknowledged rises even if nothing about it changed.

Example: *"Perishables at risk"* (cooler, critical, past 2h) = 60+15+20+0 = **95**. *"RTU filter clogged"* (minor, RTU) = 10+5+2+0 = **17**. The queue always puts perishable-product risk ahead of preventive maintenance, which is the intended behavior for a convenience-store operator.

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
`<fill in before submitting — be specific and honest, this is evaluated directly>`
- Which tool(s): e.g. Claude (chat + code generation), Claude Code, GitHub Copilot, etc.
- What AI generated: e.g. scaffolding (Vite/Tailwind/Recharts setup), first drafts of the synthetic model and alarm engine, the dashboard layout.
- What was my own decision: the indicators and information hierarchy in §2, the alarm thresholds and priority formula in §2.3, the assumptions in §3, which incidents to script into the data, what to leave out and why.
- Anything I changed or rejected from the AI's first suggestion, and why.

## 6. What I'd add with more time
- Per-equipment drill-down views (RTU detail with fan/cooling mode history, cooler detail with defrost log).
- Acknowledge/assign workflow for alarms, so "attend to this" becomes a tracked action, not just a ranked list.
- A dedicated energy/cost view (daily $ vs. baseline, not just kW).
- Trend-based early warning (e.g., forecasting when RTU-2's ΔT will cross the failure threshold) instead of a static rule.
- The `docker-compose` reference architecture from this same repo's `infra/` (Node-RED as gateway simulator, MQTT, InfluxDB, Postgres, Grafana) as the path to a real deployment once actual devices are in scope — this static prototype intentionally trades that off for a URL that always opens instantly and never cold-starts during the presentation.
- Automated tests for the alarm engine's hysteresis and priority logic.
