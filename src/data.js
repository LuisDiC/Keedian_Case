// Backfills 60 days in the browser with the SAME model + alarm engine used in the docker stack, then keeps ticking live.
import { sample, MIN, DAY, H } from './sim/model.js'
import { newState, step } from './sim/engine.js'
export const A = Math.floor(Date.now() / H) * H // anchor: scripted incidents are placed relative to it
const st = newState(A), byKey = {}
export const alarms = [], cooler = [], power = [], rtu = [], now = {}
function ingest(t) {
  const s = sample(t, A)
  for (const [asset, p] of Object.entries(s)) {
    for (const o of step(st, asset, p)) {
      const k = o.code + o.asset
      if (o.op === 'open') { byKey[k] = { ...o, endedAt: null }; alarms.push(byKey[k]) }
      else if (o.op === 'update' && byKey[k]) Object.assign(byKey[k], { severity: o.severity, priority: o.priority, reason: o.reason, title: o.title })
      else if (o.op === 'close' && byKey[k]) { byKey[k].endedAt = o.at; delete byKey[k] }
    }
    now[asset] = p
  }
  cooler.push({ t, v: s.cooler01.temp_f })
  power.push({ t, kw: s.meter01.kw, exp: s.meter01.expected_kw })
  ;[s.rtu01, s.rtu02].forEach((r, i) => r.mode === 2 && rtu.push({ t, id: i + 1, d: r.delta_t_f }))
}
for (let t = A - 60 * DAY; t <= Date.now(); t += 5 * MIN) ingest(t)
export const tick = () => ingest(Date.now())
