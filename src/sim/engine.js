// @ts-nocheck
'use strict';
/**
 * Alarm engine. step(state, asset, payload) -> ops[] ; mutates `state` (JSON-serialisable).
 * ops: {op:'open'|'update'|'close', code, asset, source, severity, title, priority, reason, details, at}
 *
 * source 'device'  = alarm the equipment/controller would raise by itself
 * source 'derived' = alarm Keedian generates from telemetry (nobody else will flag it)
 *
 * Every rule = condition + clear condition (hysteresis) + open/close delays,
 * so alarms have a real start and end and do not flap.
 */
const MIN = 60e3, H = 3600e3;
const SEV = { critical: 60, major: 40, warning: 25, minor: 10 };
const ASSET_W = (a) => (a.startsWith('cooler') ? 15 : 5); // perishables > comfort
const PRICE = 0.14; // $/kWh
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function newState(anchor) {
  return { anchor, last: {}, rules: {}, ctx: { ewKw: null, ewExp: null } };
}

// priority 0-100 = severity + asset criticality + business impact + age
function prio(sev, asset, ageMs, impact) {
  return Math.min(100, Math.round(SEV[sev] + ASSET_W(asset) + impact + Math.min(10, ageMs / H / 6)));
}

function step(state, asset, p) {
  const t = p.ts, ops = [];
  const last = state.last[asset];
  const dt = last == null ? 0 : clamp(t - last, 0, 30 * MIN);
  state.last[asset] = t;

  function rule(code, cond, clr, openAfter, closeAfter, build) {
    const key = code + '|' + asset;
    const r = state.rules[key] || (state.rules[key] = { condMs: 0, clearMs: 0, open: false, startedAt: 0, lastUpd: 0, sig: '', x: {} });
    if (cond) { r.condMs += dt; r.clearMs = 0; } else if (clr) { r.clearMs += dt; r.condMs = 0; }
    let justOpened = false;
    if (!r.open && cond && r.condMs >= openAfter) {
      r.open = true; r.startedAt = t - r.condMs; r.x = {}; r.sig = ''; justOpened = true;
    }
    if (!r.open) return;
    if (!justOpened && clr && r.clearMs >= closeAfter) {
      r.open = false; r.condMs = 0; r.clearMs = 0;
      ops.push({ op: 'close', code, asset, at: t });
      return;
    }
    if (!cond) return; // in hysteresis band: keep alarm open, don't re-evaluate text
    const a = build(r);
    const priority = prio(a.severity, asset, t - r.startedAt, a.impact || 0);
    const sig = a.severity + priority + a.reason;
    const o = { code, asset, source: a.source, severity: a.severity, title: a.title, priority, reason: a.reason, details: a.details || {}, actions: a.actions || [], at: t };
    if (justOpened) { ops.push({ op: 'open', ...o, startedAt: r.startedAt }); r.sig = sig; r.lastUpd = t; }
    else if (sig !== r.sig && t - r.lastUpd >= 60000) { ops.push({ op: 'update', ...o }); r.sig = sig; r.lastUpd = t; }
  }

  if (asset.startsWith('cooler')) {
    rule('COOLER_COMPRESSOR_FAULT', p.fault === 1, p.fault === 0, 0, 0, () => ({
      source: 'device', severity: 'critical', title: 'Walk-in cooler: compressor fault', impact: 5,
      reason: 'Controller reports compressor fault. Box will cross 41°F in about an hour without intervention.',
      details: { temp_f: +p.temp_f.toFixed(1) },
      actions: [
        'Dispatch a refrigeration technician now — this needs a truck roll, not a remote fix.',
        'If available, move high-risk perishable stock to backup cooling or an ice chest.',
        'Minimize door openings while temperature is rising.',
      ],
    }));
    rule('COOLER_DOOR_OPEN', p.door_open === 1, p.door_open === 0, 5 * MIN, 0, () => ({
      source: 'device', severity: 'minor', title: 'Walk-in cooler: door open', impact: 2,
      reason: `Door left open; box at ${p.temp_f.toFixed(1)}°F and rising. Someone on site can fix it in a minute.`,
      details: { temp_f: +p.temp_f.toFixed(1) },
      actions: [
        'Call the store to have someone close the walk-in door now.',
        'Make it a standing rule: the walk-in stays closed whenever it isn\u2019t actively in use.',
        'If this keeps recurring, check the door closer/hinges and the gasket seal — a slow closer or worn gasket stops the door from sealing on its own.',
      ],
    }));
    rule('COOLER_TEMP_HIGH', p.temp_f > 41, p.temp_f <= 40, 30 * MIN, 15 * MIN, (r) => {
      r.x.peak = Math.max(r.x.peak || 0, p.temp_f);
      const mins = Math.round((t - r.startedAt) / MIN), risk = mins >= 120;
      const dur = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
      return {
        source: 'derived', severity: risk ? 'critical' : 'major', title: risk ? 'Walk-in cooler: perishables at risk' : 'Walk-in cooler: temperature high',
        impact: risk ? 20 : 8,
        reason: risk
          ? `${dur} above 41°F (peak ${r.x.peak.toFixed(1)}°F). Food-safety limit is 4h${mins >= 240 ? ' — EXCEEDED: assess product for discard' : ''}.`
          : `Above 41°F for ${dur} (now ${p.temp_f.toFixed(1)}°F). Escalates to product-at-risk at 2h.`,
        details: { peak_f: +r.x.peak.toFixed(1), minutes_above_41: mins },
        actions: risk ? [
          mins >= 240 ? 'Food-safety limit exceeded — assess perishable product for discard per policy.' : 'Approaching the 4h food-safety limit — prepare to assess product for discard.',
          'Dispatch a technician now if one isn\u2019t already en route.',
          'Confirm the door is closed and the gasket is sealing while you wait for service.',
        ] : [
          'Confirm the door is fully closed and the gasket is sealing.',
          'Check that the compressor is actually cycling (listen or check the controller).',
          'If it hasn\u2019t recovered within the hour, escalate to a technician before it reaches the 2h risk threshold.',
        ],
      };
    });
  }

  if (asset.startsWith('rtu')) {
    const cooling = p.mode === 2, fan = p.mode >= 1;
    rule('RTU_DELTAT_LOW', cooling && p.delta_t_f < 15, cooling && p.delta_t_f >= 16.5, 60 * MIN, 30 * MIN, () => {
      const cap = Math.round((p.delta_t_f / 20 - 1) * 100);
      const severe = p.delta_t_f < 12;
      return {
        source: 'derived', severity: severe ? 'major' : 'warning', title: 'RTU: cooling capacity degrading', impact: severe ? 8 : 3,
        reason: `Cooling ΔT ${p.delta_t_f.toFixed(1)}°F vs ≥15°F target (about ${cap}% capacity). The unit raises no alarm — will fail on the first hot day.`,
        details: { delta_t_f: +p.delta_t_f.toFixed(1), comp_amps: +p.comp_amps.toFixed(1) },
        actions: severe ? [
          'Schedule a refrigerant charge / coil inspection before the next hot day — capacity loss is significant.',
          'Prioritize this unit on the next maintenance visit; it is at risk of failing under peak demand.',
        ] : [
          'Add a refrigerant-charge and coil check to the next scheduled maintenance visit.',
          'No emergency dispatch needed yet — capacity is trending down but not critical.',
        ],
      };
    });
    rule('RTU_FILTER_DP_HIGH', fan && p.filter_dp_inwc > 1.0, fan && p.filter_dp_inwc < 0.8, 10 * MIN, 10 * MIN, () => ({
      source: 'device', severity: 'minor', title: 'RTU: filter clogged', impact: 2,
      reason: `Filter ΔP ${p.filter_dp_inwc.toFixed(2)} in.w.c. (limit 1.0). Restricted airflow raises energy use and can ice the coil.`,
      details: { filter_dp_inwc: +p.filter_dp_inwc.toFixed(2) },
      actions: [
        'Replace or clean the air filter at the next site visit.',
        'If left unaddressed, restricted airflow can ice the coil and increase energy use further.',
      ],
    }));
  }

  if (asset.startsWith('meter')) {
    const c = state.ctx, a = 1 - Math.exp(-dt / (60 * MIN));
    c.ewKw = c.ewKw == null ? p.kw : c.ewKw + (p.kw - c.ewKw) * a;
    c.ewExp = c.ewExp == null ? p.expected_kw : c.ewExp + (p.expected_kw - c.ewExp) * a;
    const ratio = c.ewKw / c.ewExp;
    rule('ENERGY_ABOVE_BASELINE', ratio > 1.18, ratio < 1.08, 30 * MIN, 30 * MIN, () => {
      const extra = c.ewKw - c.ewExp, cost = extra * PRICE;
      return {
        source: 'derived', severity: 'warning', title: 'Site: consumption above weather-adjusted baseline', impact: Math.min(15, cost * 10),
        reason: `+${extra.toFixed(1)} kW over baseline (~$${cost.toFixed(2)}/h, ${Math.round((ratio - 1) * 100)}% above). Typical cause: equipment running outside its schedule.`,
        details: { extra_kw: +extra.toFixed(1), ratio: +ratio.toFixed(2) },
        actions: [
          'Check whether an RTU is stuck running outside its schedule (e.g., missed night setback).',
          'Confirm setpoints and schedules, on-site or remotely if the controller allows it.',
          'If no equipment issue is found, compare against actual weather before assuming a fault — some deviation is normal.',
        ],
      };
    });
  }
  return ops;
}
export { newState, step };
