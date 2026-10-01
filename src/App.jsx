import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import * as D from './data.js'

const SEV = { critical: 'bg-red-600', major: 'bg-orange-500', warning: 'bg-yellow-400 text-black', minor: 'bg-sky-600' }
const dur = (ms) => { const m = Math.floor(ms / 6e4); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` }
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const md = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
const bucket = (arr, ms, f) => { const m = new Map(); arr.forEach((p) => { const k = Math.floor(p.t / ms) * ms; (m.get(k) || m.set(k, []).get(k)).push(p) }); return [...m].map(([t, a]) => ({ t, ...f(a) })) }
const avg = (a, k) => a.reduce((s, p) => s + p[k], 0) / a.length
const max = (a, k) => Math.max(...a.map((p) => p[k]))
// contiguous runs where flag===1 in a time-bucketed series -> [{x1,x2}] for ReferenceArea shading
const segments = (data, key, stepMs) => {
  const out = []; let start = null
  data.forEach((p, i) => {
    if (p[key] && start === null) start = p.t
    if ((!p[key] || i === data.length - 1) && start !== null) { out.push({ x1: start, x2: p[key] ? p.t + stepMs : p.t }); start = null }
  })
  return out
}

const Kpi = ({ label, value, sub, tone }) => (
  <div className={`rounded-xl p-4 border ${tone}`}><div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-3xl font-semibold mt-1">{value}</div><div className="text-xs text-slate-400 mt-1">{sub}</div></div>)
const Card = ({ title, children, foot }) => (<div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><h3 className="text-sm font-medium text-slate-300 mb-3">{title}</h3><div className="h-64">{children}</div>{foot}</div>)
const Branch = ({ label, kw, total, color }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-24 text-slate-400 shrink-0">{label}</span>
    <div className="flex-1 h-2 rounded bg-slate-800 overflow-hidden"><div className="h-full rounded" style={{ width: `${total ? Math.min(100, (kw / total) * 100) : 0}%`, background: color }} /></div>
    <span className="w-16 text-right font-mono">{kw.toFixed(1)} kW</span>
  </div>)
const axes = (fmt) => [<CartesianGrid key="g" stroke="#1e293b" />, <XAxis key="x" dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmt} stroke="#64748b" fontSize={11} />, <Tooltip key="t" labelFormatter={fmt} contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} formatter={(v) => (+v).toFixed(1)} />]

export default function App() {
  const [, force] = useState(0); const [tab, setTab] = useState('overview')
  const [acked, setAcked] = useState(() => new Set())
  const toggleAck = (k) => setAcked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  useEffect(() => { const i = setInterval(() => { D.tick(); force((x) => x + 1) }, 5000); return () => clearInterval(i) }, [])
  const now = Date.now()
  const open = D.alarms.filter((a) => !a.endedAt).sort((a, b) => b.priority - a.priority)
  const c24 = D.cooler.filter((p) => p.t > now - DAY)
  let mins = 0; for (let i = 1; i < c24.length; i++) if (c24[i].v > 41) mins += Math.min(c24[i].t - c24[i - 1].t, 18e5) / 6e4
  const idx = (a, b) => { let k = 0, e = 0; D.power.forEach((p) => { if (p.t > a && p.t <= b) { k += p.kw; e += p.exp } }); return e ? (k / e) * 100 : 0 }
  const cur = idx(now - 30 * DAY, now), prev = idx(now - 60 * DAY, now - 30 * DAY)
  const worst = open[0], status = open.some((a) => a.severity === 'critical') ? ['ACTION NOW', 'bg-red-600'] : open.some((a) => ['major', 'warning'].includes(a.severity)) ? ['ATTENTION TODAY', 'bg-orange-500'] : open.length ? ['MINOR ISSUES', 'bg-sky-600'] : ['ALL CLEAR', 'bg-emerald-600']
  const coolerData = bucket(c24, 5 * MIN, (a) => ({ v: avg(a, 'v'), defrost: max(a, 'defrost'), door: max(a, 'door'), fault: max(a, 'fault') }))
  const defrostSeg = segments(coolerData, 'defrost', 5 * MIN)
  const doorSeg = segments(coolerData, 'door', 5 * MIN)
  const faultSeg = segments(coolerData, 'fault', 5 * MIN)
  const powerData = bucket(D.power.filter((p) => p.t > now - DAY), 15 * MIN, (a) => ({ kw: avg(a, 'kw'), exp: avg(a, 'exp'), pf: avg(a, 'pf') }))
  const rtuData = bucket(D.rtu.filter((p) => p.t > now - 30 * DAY), 12 * H, (a) => ({ rtu1: avg(a.filter((p) => p.id === 1).length ? a.filter((p) => p.id === 1) : [{ d: NaN }], 'd'), rtu2: avg(a.filter((p) => p.id === 2).length ? a.filter((p) => p.id === 2) : [{ d: NaN }], 'd') }))
  const coolerNow = D.now.cooler01?.temp_f
  const critMajor = open.filter((a) => ['critical', 'major'].includes(a.severity))
  const minorWarn = open.filter((a) => ['warning', 'minor'].includes(a.severity))
  const meterNow = D.now.meter01
  const branches = meterNow ? [
    { label: 'RTU 1', kw: meterNow.kw_rtu1, color: '#34d399' },
    { label: 'RTU 2', kw: meterNow.kw_rtu2, color: '#f472b6' },
    { label: 'Refrigeration', kw: meterNow.kw_cooler, color: '#38bdf8' },
    { label: 'Lighting', kw: meterNow.kw_lighting, color: '#fbbf24' },
    { label: 'Plug loads', kw: meterNow.kw_plug, color: '#a78bfa' },
  ] : []

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div><h1 className="text-xl font-semibold">Site 01 · Convenience store</h1><p className="text-xs text-slate-400">Synthetic data · live tick every 5 s · updated {hm(now)}</p></div>
        <nav className="flex gap-2 text-sm">{[['overview', 'Overview'], ['history', 'Alarm history']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg ${tab === k ? 'bg-slate-700' : 'bg-slate-900 text-slate-400'}`}>{l}</button>)}</nav>
      </header>

      {tab === 'overview' ? <>
        <section className={`rounded-xl p-4 ${status[1]}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold tracking-widest">{status[0]}</div>
            <div className="text-xs opacity-90">{critMajor.length} critical/major · {minorWarn.length} warning/minor open</div>
          </div>
          <div className="text-lg font-semibold mt-1">{worst ? `Attend first: ${worst.title}` : 'No open alarms'}</div>
          {worst && <div className="text-sm opacity-90">{worst.reason}</div>}
          {worst?.actions?.length > 0 && <div className="text-sm font-medium mt-1.5">→ {worst.actions[0]}</div>}
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Kpi label="Critical + major open" value={critMajor.length} sub={critMajor.length === 0 ? (minorWarn.length ? `0 — ${minorWarn.length} lower-severity still open` : 'Nothing open') : `${open.length} open in total`} tone={critMajor.length ? 'border-red-600 bg-red-950' : 'border-slate-800 bg-slate-900'} />
          <Kpi label="Cooler above 41°F · 24 h" value={`${Math.round(mins)} min`} sub={mins >= 240 ? 'Food-safety limit (4 h) exceeded' : mins > 0 ? 'Product exposure in last 24 h' : 'No exposure'} tone={mins >= 120 ? 'border-red-600 bg-red-950' : mins > 0 ? 'border-orange-500 bg-orange-950' : 'border-slate-800 bg-slate-900'} />
          <Kpi label="Cooler now" value={`${coolerNow?.toFixed(1)}°F`} sub="Setpoint 36°F · limit 41°F" tone={coolerNow > 41 ? 'border-red-600 bg-red-950' : 'border-slate-800 bg-slate-900'} />
          <Kpi label="Site power now" value={`${meterNow?.kw.toFixed(1)} kW`} sub={`expected ${meterNow?.expected_kw.toFixed(1)} kW`} tone="border-slate-800 bg-slate-900" />
          <Kpi label="Power factor now" value={meterNow?.power_factor.toFixed(2)} sub={meterNow?.power_factor < 0.85 ? 'Below 0.90 — utility penalty range' : meterNow?.power_factor < 0.9 ? 'Below utility target (0.90)' : 'Within utility target'} tone={meterNow?.power_factor < 0.85 ? 'border-red-600 bg-red-950' : meterNow?.power_factor < 0.9 ? 'border-orange-500 bg-orange-950' : 'border-slate-800 bg-slate-900'} />
          <Kpi label="Energy vs baseline · 30 d" value={`${cur.toFixed(0)}%`} sub={`prev. 30 d: ${prev.toFixed(0)}% → ${cur > prev ? 'worse' : 'better'} (weather-adjusted)`} tone={cur > prev + 0.5 ? 'border-orange-500 bg-orange-950' : 'border-slate-800 bg-slate-900'} />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Alarm queue — attend in this order</h2>
          {open.length === 0 && <p className="text-slate-400 text-sm">Nothing to do.</p>}
          <ul className="divide-y divide-slate-800">{open.map((a) => { const k = a.code + a.asset; const ack = acked.has(k); return (
            <li key={k} className={`py-3 flex gap-3 items-start ${ack ? 'opacity-60' : ''}`}>
              <div className="w-12 text-center"><div className="text-2xl font-bold">{a.priority}</div><div className="text-[10px] text-slate-500">PRIO</div></div>
              <div className="flex-1"><div className="flex flex-wrap gap-2 items-center"><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${SEV[a.severity]}`}>{a.severity.toUpperCase()}</span>
                <span className="font-medium">{a.title}</span><span className="text-xs text-slate-500">{a.asset} · {a.source === 'derived' ? 'derived by Keedian' : 'device alarm'} · open {dur(now - a.startedAt)}</span>
                {ack && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-700 text-slate-300">✓ ACKNOWLEDGED</span>}</div>
                <p className="text-sm text-slate-400 mt-1">{a.reason}</p>
                {a.actions?.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">Suggested actions</div>
                    <ul className="space-y-1 mt-1">{a.actions.map((act, i) => (
                      <li key={i} className="text-xs text-slate-300 flex gap-1.5"><span className="text-slate-600 shrink-0">{i + 1}.</span><span>{act}</span></li>))}</ul>
                  </div>
                )}</div>
              <button onClick={() => toggleAck(k)} className={`text-xs px-3 py-1.5 rounded-lg shrink-0 ${ack ? 'bg-slate-800 text-slate-400' : 'bg-slate-700 hover:bg-slate-600'}`}>{ack ? 'Unacknowledge' : 'Acknowledge'}</button>
            </li>)})}</ul>
          {open.length > 0 && <p className="text-[11px] text-slate-500 mt-3">Acknowledge is a local demo only — not persisted or shared. In production this writes to <code>alarms.acknowledged_by/at</code> and syncs to every connected dashboard over MQTT (see README).</p>}
        </section>

        <section className="grid lg:grid-cols-2 gap-3">
          <Card title="Walk-in cooler · last 24 h (shaded = defrost, red = door open, purple = equipment fault)">
            <ResponsiveContainer><LineChart data={coolerData}>{axes(hm)}<YAxis domain={[30, 'auto']} stroke="#64748b" fontSize={11} unit="°" />
              {defrostSeg.map((s, i) => <ReferenceArea key={'d' + i} x1={s.x1} x2={s.x2} fill="#f59e0b" fillOpacity={0.18} ifOverflow="extendDomain" />)}
              {doorSeg.map((s, i) => <ReferenceArea key={'o' + i} x1={s.x1} x2={s.x2} fill="#ef4444" fillOpacity={0.25} ifOverflow="extendDomain" />)}
              {faultSeg.map((s, i) => <ReferenceArea key={'f' + i} x1={s.x1} x2={s.x2} fill="#a855f7" fillOpacity={0.22} ifOverflow="extendDomain" />)}
              <ReferenceLine y={41} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '41°F', fill: '#ef4444', fontSize: 11 }} />
              <Line dataKey="v" dot={false} stroke="#38bdf8" strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer>
            <div className="flex flex-wrap gap-4 mt-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#f59e0b', opacity: 0.5 }} />defrost cycle (4×/day)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#ef4444', opacity: 0.5 }} />door open</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#a855f7', opacity: 0.5 }} />compressor fault</span>
            </div>
          </Card>
          <Card title="Site power vs weather-adjusted baseline · last 24 h (kW)"
            foot={meterNow && (
              <div className="mt-3 pt-3 border-t border-slate-800 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Current load breakdown — main panel branch circuits</div>
                {branches.map((b) => <Branch key={b.label} label={b.label} kw={b.kw} total={meterNow.kw} color={b.color} />)}
              </div>
            )}>
            <ResponsiveContainer><LineChart data={powerData}>{axes(hm)}<YAxis stroke="#64748b" fontSize={11} /><Legend /><Line name="actual" dataKey="kw" dot={false} stroke="#fb923c" strokeWidth={2} isAnimationActive={false} /><Line name="expected" dataKey="exp" dot={false} stroke="#94a3b8" strokeDasharray="5 5" isAnimationActive={false} /></LineChart></ResponsiveContainer>
          </Card>
          <Card title="RTU cooling ΔT · 30 d — silent degradation (target ≥ 15°F)"><ResponsiveContainer><LineChart data={rtuData}>{axes(md)}<YAxis domain={[8, 24]} stroke="#64748b" fontSize={11} /><Legend /><ReferenceLine y={15} stroke="#ef4444" strokeDasharray="4 4" /><Line name="RTU 1" dataKey="rtu1" dot={false} stroke="#34d399" strokeWidth={2} connectNulls isAnimationActive={false} /><Line name="RTU 2" dataKey="rtu2" dot={false} stroke="#f472b6" strokeWidth={2} connectNulls isAnimationActive={false} /></LineChart></ResponsiveContainer></Card>
          <Card title="Power factor · last 24 h (dashed = utility target 0.90)"><ResponsiveContainer><LineChart data={powerData}>{axes(hm)}<YAxis domain={[0.6, 1]} stroke="#64748b" fontSize={11} /><ReferenceLine y={0.9} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: '0.90', fill: '#f59e0b', fontSize: 11 }} /><Line dataKey="pf" name="power factor" dot={false} stroke="#22d3ee" strokeWidth={2} isAnimationActive={false} /></LineChart></ResponsiveContainer>
            <p className="text-[11px] text-slate-500 mt-2">Drops when both RTU compressors run at once (induction-motor lag); recovers during defrost (resistive load) or when fewer motors are on. Many utilities charge a penalty below 0.90.</p>
          </Card>
        </section></> :
        <>
          <section className="rounded-xl border border-amber-700/50 bg-slate-900 p-4 overflow-x-auto">
            <h2 className="text-sm font-medium text-amber-400 mb-3">Currently open ({open.length}) — same order as the queue on Overview</h2>
            {open.length === 0 ? <p className="text-slate-400 text-sm">Nothing open.</p> :
            <table className="w-full min-w-[640px] text-sm"><thead className="text-left text-slate-400"><tr>{['Prio', 'Severity', 'Asset', 'Alarm', 'Source', 'Open for'].map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>{open.map((a, i) => (
                <tr key={i} className="border-t border-slate-800 bg-amber-950/20"><td className="py-2 pr-3">{a.priority}</td><td className="pr-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${SEV[a.severity]}`}>{a.severity}</span></td><td className="pr-3">{a.asset}</td><td className="pr-3">{a.title}</td><td className="pr-3">{a.source}</td><td className="whitespace-nowrap">{dur(now - a.startedAt)}</td></tr>))}</tbody></table>}
          </section>
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 overflow-x-auto">
            <h2 className="text-sm font-medium text-slate-300 mb-3">Resolved — last 30 days</h2>
            <table className="w-full min-w-[640px] text-sm"><thead className="text-left text-slate-400"><tr>{['Prio', 'Severity', 'Asset', 'Alarm', 'Source', 'Start', 'End'].map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>{[...D.alarms].filter((a) => a.endedAt && a.startedAt > now - 30 * DAY).sort((a, b) => b.endedAt - a.endedAt).map((a, i) => (
                <tr key={i} className="border-t border-slate-800"><td className="py-2 pr-3">{a.priority}</td><td className="pr-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded ${SEV[a.severity]}`}>{a.severity}</span></td><td className="pr-3">{a.asset}</td><td className="pr-3">{a.title}</td><td className="pr-3">{a.source}</td><td className="pr-3 whitespace-nowrap">{md(a.startedAt)} {hm(a.startedAt)}</td><td className="whitespace-nowrap">{md(a.endedAt)} {hm(a.endedAt)}</td></tr>))}</tbody></table>
          </section>
        </>}
    </div>)
}
const { MIN, DAY, H } = { MIN: 6e4, DAY: 864e5, H: 36e5 }
