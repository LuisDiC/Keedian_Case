# Site 01 – Remote management dashboard (Keedian case study)

**Live:** <your-vercel-url> · **Stack:** Vite + React + Tailwind + Recharts (static, no backend)

## Run locally
`npm install && npm run dev` (build: `npm run build`). Deploy: import the repo in Vercel (zero config) or Netlify (`netlify.toml` included).

## Indicators and why (first 10 seconds)
1. **Status banner + "attend first"** – one verdict (all clear / attention / action now) and the single alarm to handle first, with the reason.
2. **Alarm queue ranked by priority (0-100)** = severity + asset criticality (perishables > comfort) + business impact (product risk, $/h) + age. Device alarms and Keedian-derived alarms are labelled, because derived ones are the ones nobody else will flag.
3. **Cooler minutes above 41°F, last 24 h** – answers "was product at risk?" directly (4 h food-safety reference).
4. **Energy vs weather-adjusted baseline, 30 d vs previous 30 d** – 100% = expected for hour, day type and outdoor temp; removes weather from "better or worse than last month".
5. **RTU cooling ΔT trend** – degradation before failure; the unit raises no alarm, the derived rule does (ΔT < 15°F for 60 min of cooling).
Deliberately not shown: raw per-circuit charts, voltages, every setpoint – they don't drive a decision today.

## Assumptions
Site UTC-5, open 06:00-23:00, 2 x 5-ton RTUs (healthy ΔT ≈ 20°F), one walk-in (setpoint 36°F, 4 defrosts/day, limit 41°F), electricity $0.14/kWh, alarm thresholds are my own engineering judgement.

## Synthetic data
`src/sim/model.js`: deterministic physics-style model (daily load curve, traffic, outdoor temp, duty-cycling RTUs, cooler sawtooth + defrost, door events, compressor failure, RTU2 capacity loss, RTU1 filter fouling, RTU1 missing night setback). Computed in the browser at load (60 days @ 5 min) and ticked live every 5 s. Scripted incidents are placed relative to the load hour, so the dashboard always opens with a story. `src/sim/engine.js` is the alarm engine (start/end, hysteresis, priority).

## AI usage
<fill in: tools used, what I decided myself – indicators, thresholds, priority formula, information hierarchy>

## With more time
Per-equipment detail views, ack/assign workflow, energy cost view, trend-based early warning, real MQTT/Influx/Node-RED pipeline (see the docker-compose reference architecture), tests for the alarm engine.
