// @ts-nocheck
'use strict';
/**
 * Deterministic synthetic model of ONE convenience store.
 * sample(t, anchor) -> { weather01, meter01, rtu01, rtu02, cooler01 } payloads.
 *
 * - Pure function of time: the 60-day backfill and the live simulator produce
 *   one continuous, coherent series (no state needed).
 * - `anchor` = moment the stack was first seeded. Scripted incidents are
 *   placed relative to it so the dashboard always opens with a story.
 *
 * Assumptions (documented in README): site in UTC-5 (no DST), open 06:00-23:00,
 * 2 x 5-ton RTUs, 1 walk-in cooler with 4 defrosts/day, electricity $0.14/kWh.
 */
const MIN = 60e3, H = 3600e3, DAY = 864e5;
const TZ = -5, OPEN_H = 6, CLOSE_H = 23;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function hash(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// smooth value noise in [-1,1], 5-min knots => same look at any sampling rate
function vnoise(t, k) {
  const P = 300000, b = Math.floor(t / P), f = t / P - b, s = f * f * (3 - 2 * f);
  const a = hash(b * 977 + k * 7919), c = hash((b + 1) * 977 + k * 7919);
  return (a + (c - a) * s) * 2 - 1;
}
function lp(t) {
  const s = t + TZ * H, d = new Date(s);
  return { h: d.getUTCHours() + d.getUTCMinutes() / 60, dow: d.getUTCDay(), day: Math.floor(s / DAY) };
}
const isOpen = (L) => L.h >= OPEN_H && L.h < CLOSE_H;

function traffic(L) {
  if (!isOpen(L)) return 0;
  const g = (c, w, a) => a * Math.exp(-((L.h - c) ** 2) / (2 * w * w));
  let v = 0.15 + g(8, 1.2, 0.7) + g(12.5, 1.2, 0.6) + g(17.5, 1.6, 0.9) + g(21, 1.2, 0.3);
  if (L.dow === 0 || L.dow === 6) v *= 0.85;
  return Math.min(1, v);
}

function weather(t, L) {
  const dayBias = (hash(L.day * 31 + 1) * 2 - 1) * 4;
  const drift = -0.05 * ((t - Date.UTC(2026, 8, 27)) / DAY); // slow end-of-summer cooling
  const oat = 83 + dayBias + drift + 6 * Math.sin((2 * Math.PI * (L.h - 9)) / 24) + vnoise(t, 1) * 0.8;
  const rh = clamp(75 - (oat - 80) * 1.5 + vnoise(t, 2) * 3, 40, 95);
  return { oat, rh };
}

const demandFor = (oat, tr, open, id) =>
  clamp(open ? (oat - 65) / 32 + 0.12 * tr : (oat - 76) / 20, 0.02, 0.9) * (id === 1 ? 1 : 0.9);
const nightKey = (L) => (L.h >= CLOSE_H ? L.day : L.h < 5 ? L.day - 1 : null);
const RTU_COOL_KW = 6.2, RTU_FAN_KW = 1.1, RTU_IDLE_KW = 0.05, PERIOD = 18;

function rtu(t, L, oat, tr, id, A) {
  const open = isOpen(L);
  const night = nightKey(L);
  // RTU1 sometimes fails to go into night setback (schedule fault) -> runs cooling all night
  const setbackFail = id === 1 && night !== null && (hash(night * 17 + 3) < 0.1 || night === lp(A).day - 1);
  const demand = setbackFail ? 0.85 : demandFor(oat, tr, open, id);
  // RTU2 loses cooling capacity slowly (fouled coil / low charge) and draws more current
  const deg = id === 2 ? clamp((t - (A - 52 * DAY)) / (80 * DAY), 0, 1) : 0;
  const ph = (t / MIN + (id === 1 ? 0 : 7)) % PERIOD;
  const cooling = ph < demand * PERIOD;
  const mode = cooling ? 2 : open ? 1 : 0;
  const sp = open && !setbackFail ? 72 : 78;
  const zone = sp + 1.3 * Math.sin((2 * Math.PI * ph) / PERIOD) + vnoise(t, 10 + id) * 0.2;
  const ret = zone + 2.5;
  const delta = cooling ? 20 - deg * 10 + vnoise(t, 20 + id) * 0.7 : mode === 1 ? 1.2 + vnoise(t, 30 + id) * 0.3 : 0;
  const ageD = Math.max(0, (t - (A - 45 * DAY)) / DAY);
  const dp = mode >= 1 ? (id === 1 ? 0.3 + (0.7 * ageD) / 43 : 0.38) + vnoise(t, 40 + id) * 0.02 : 0;
  const kw = cooling ? RTU_COOL_KW * (1 + deg * 0.2) + RTU_FAN_KW : open ? RTU_FAN_KW : RTU_IDLE_KW;
  return {
    kw,
    payload: {
      ts: t, mode, zone_temp_f: zone, setpoint_f: sp, return_temp_f: ret, supply_temp_f: ret - delta,
      delta_t_f: delta, comp_amps: cooling ? 16 * (1 + deg * 0.18) + vnoise(t, 50 + id) * 0.4 : 0, filter_dp_inwc: dp,
    },
  };
}

const DEFROSTS = [120, 480, 840, 1200]; // 02:00 08:00 14:00 20:00 local
const FAIL_DUR = 260; // min, scripted compressor failure at anchor-19h
function doorEvent(day) {
  if (hash(day * 13 + 5) >= 0.22) return null;
  return { start: (9 + hash(day * 13 + 6) * 11) * 60, dur: 8 + hash(day * 13 + 7) * 42 };
}
function cooler(t, L, tr, A) {
  const m = L.h * 60;
  const ph = (t / MIN + 3) % 22;
  let comp = ph < 10 ? 1 : 0;
  let temp = ph < 10 ? 37.5 - 3 * (ph / 10) : 34.5 + 3 * ((ph - 10) / 12);
  let since = 1e9;
  for (const s of DEFROSTS) { let x = m - s; if (x < 0) x += 1440; since = Math.min(since, x); }
  const defrost = since < 25 ? 1 : 0;
  if (defrost) comp = 0;
  temp += since < 25 ? 2.5 * (since / 25) : since < 50 ? 2.5 * (1 - (since - 25) / 25) : 0;
  temp += 0.3 * tr + vnoise(t, 60) * 0.25;
  let door = 0;
  const ev = doorEvent(L.day);
  if (ev) {
    const x = m - ev.start;
    if (x >= 0 && x < ev.dur) { door = 1; temp += 12 * (1 - Math.exp(-x / 25)); }
    else if (x >= ev.dur) temp += 12 * (1 - Math.exp(-ev.dur / 25)) * Math.exp(-(x - ev.dur) / 20);
  }
  let fault = 0;
  const x = (t - (A - 19 * H)) / MIN;
  if (x >= 0 && x < FAIL_DUR) {
    temp = 75 - 39 * Math.exp(-x / 480) + vnoise(t, 61) * 0.2; comp = 0; fault = 1; door = 0;
  } else if (x >= FAIL_DUR && x < FAIL_DUR + 150) {
    const tEnd = 75 - 39 * Math.exp(-FAIL_DUR / 480);
    const pull = tEnd - 0.25 * (x - FAIL_DUR);
    if (pull > temp) { temp = pull; comp = 1; }
  }
  const kw = 0.4 + (comp ? 3.1 : 0) + (defrost ? 2.8 : 0);
  return { kw, payload: { ts: t, temp_f: temp, setpoint_f: 36, compressor: comp, defrost, door_open: door, fault } };
}

function sample(t, A) {
  const L = lp(t), tr = traffic(L), w = weather(t, L), open = isOpen(L);
  const r1 = rtu(t, L, w.oat, tr, 1, A), r2 = rtu(t, L, w.oat, tr, 2, A), c = cooler(t, L, tr, A);
  const light = open ? 4.2 : 1.6;
  const plug = 2.0 + 4.5 * tr + vnoise(t, 70) * 0.2;
  const total = (light + plug + r1.kw + r2.kw + c.kw) * (1 + vnoise(t, 71) * 0.015);
  // weather-adjusted baseline: healthy equipment, normal schedules, duty-cycle averages
  const base = open ? RTU_FAN_KW : RTU_IDLE_KW;
  const avg = (id) => { const d = demandFor(w.oat, tr, open, id); return d * (RTU_COOL_KW + RTU_FAN_KW) + (1 - d) * base; };
  const coolerAvg = 0.4 + 3.1 * (10 / 22) * (1 - 100 / 1440) + 2.8 * (100 / 1440);
  const expected = light + (2.0 + 4.5 * tr) + avg(1) + avg(2) + coolerAvg;
  // Power factor: induction-motor compressors run lagging (~0.80-0.83), fan-only motors better (~0.90),
  // resistive defrost heater near unity (~0.98), lighting/plug (LED drivers, electronics) ~0.95-0.97.
  // Site PF is the kW-weighted blend of whatever branches are actually drawing right now (kVA sums, not kW).
  const pfRtu = (mode) => (mode === 2 ? 0.83 : mode === 1 ? 0.9 : 0.95);
  const pfCooler = c.payload.compressor ? 0.8 : c.payload.defrost ? 0.98 : 0.92;
  const branches = [
    [light, 0.95], [plug, 0.97], [r1.kw, pfRtu(r1.payload.mode)], [r2.kw, pfRtu(r2.payload.mode)], [c.kw, pfCooler],
  ];
  const kva = branches.reduce((s, [kw, pf]) => s + kw / pf, 0);
  const pf = clamp((total / Math.max(kva, 0.01)) * (1 + vnoise(t, 73) * 0.006), 0.6, 1);
  return {
    weather01: { ts: t, oat_f: w.oat, rh_pct: w.rh },
    meter01: {
      ts: t, kw: total, expected_kw: expected, kw_rtu1: r1.kw, kw_rtu2: r2.kw, kw_cooler: c.kw,
      kw_lighting: light, kw_plug: plug, voltage_v: 208 + vnoise(t, 72) * 1.5, power_factor: pf,
    },
    rtu01: r1.payload, rtu02: r2.payload, cooler01: c.payload,
  };
}
export { sample, MIN, H, DAY };
