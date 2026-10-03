'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, dateTime, duration, useData, timeAgo } from '@/lib/api';
import { Badge, Empty, ErrorNote, PageHeader } from '@/components/ui';

function Row({ k, v }: { k: string; v: React.ReactNode }) { return <><dt className="text-zinc-500">{k}</dt><dd className="col-span-2">{v}</dd></>; }

function FallbackForm({ providers, connection, onDone }: { providers: any[]; connection?: any; onDone: () => void }) {
  const [f, setF] = useState({ name: connection?.name ?? '', provider: connection?.provider ?? 'NINE_ROUTER', apiKey: '', baseUrl: connection?.baseUrl ?? '', model: connection?.model ?? '', priority: connection?.priority ?? 1, costIn: connection?.costInputPerMTok?.toString() ?? '', costOut: connection?.costOutputPerMTok?.toString() ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [modelMessage, setModelMessage] = useState('');
  const p = providers.find((x) => x.key === f.provider);
  const discover = async () => {
    setBusy(true); setErr(null); setModels([]); setModelMessage('');
    try {
      const data = connection && !f.apiKey && f.baseUrl === (connection.baseUrl ?? '')
        ? await api(`/api/runtime/fallback/${connection.id}/models`, { method: 'POST' })
        : await api('/api/runtime/fallback/models', { method: 'POST', body: { provider: f.provider, apiKey: f.apiKey || undefined, baseUrl: f.baseUrl || null } });
      setModels(data.models); setModelMessage(`${data.models.length} models loaded. Choose a model or enter its ID.`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await api(connection ? `/api/runtime/fallback/${connection.id}` : '/api/runtime/fallback', { method: connection ? 'PUT' : 'POST', body: { name: f.name, provider: connection ? undefined : f.provider, apiKey: f.apiKey || undefined, baseUrl: f.baseUrl || null, model: f.model, priority: Number(f.priority), costInputPerMTok: f.costIn ? Number(f.costIn) : null, costOutputPerMTok: f.costOut ? Number(f.costOut) : null } });
      setF({ ...f, apiKey: '' }); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 border-t border-zinc-200 px-4 py-3 md:grid-cols-4">
      <div className="md:col-span-4"><ErrorNote error={err} /></div>
      <div><label className="label" htmlFor="fn">Name</label><input id="fn" className="input mt-1" placeholder="My AI router" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
      <div><label className="label" htmlFor="fp">Provider</label><select id="fp" className="input mt-1" disabled={!!connection} value={f.provider} onChange={(e) => { setF({ ...f, provider: e.target.value, baseUrl: '', apiKey: '', model: '' }); setModels([]); setModelMessage(''); }}>{providers.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
      <div><label className="label" htmlFor="fmo">Model</label><input id="fmo" list="router-models" className="input mt-1" placeholder="Model ID from your provider" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} required /><datalist id="router-models">{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist></div>
      <div><label className="label" htmlFor="fpr">Priority</label><input id="fpr" type="number" min={1} max={9} className="input mt-1" value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} /></div>
      <div className="md:col-span-2"><label className="label" htmlFor="fk">API key {connection ? '(leave blank to keep current key)' : p?.needsKey ? '(required)' : '(if required by your router)'}</label><input id="fk" type="password" autoComplete="off" required={!connection && p?.needsKey} className="input mt-1" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></div>
      <div className="md:col-span-2"><label className="label" htmlFor="fb">Base URL</label><input id="fb" className="input mt-1" placeholder={p?.baseUrl} value={f.baseUrl} onChange={(e) => { setF({ ...f, baseUrl: e.target.value }); setModels([]); setModelMessage(''); }} /><p className="mt-1 text-xs text-zinc-500">Default: {p?.baseUrl}</p></div>
      <div className="md:col-span-4 flex items-center gap-3"><button type="button" className="btn" disabled={busy || ['ANTHROPIC', 'GEMINI'].includes(f.provider)} onClick={discover}>{busy ? 'Please wait…' : 'Load models'}</button><span className="text-xs text-zinc-500">{modelMessage || (f.provider === 'NINE_ROUTER' ? 'Start 9Router and connect a provider in its dashboard first.' : 'Load available models or enter an exact model ID.')}</span></div>
      <div><label className="label" htmlFor="ci">$ / 1M input tokens</label><input id="ci" className="input mt-1" inputMode="decimal" value={f.costIn} onChange={(e) => setF({ ...f, costIn: e.target.value })} /></div>
      <div><label className="label" htmlFor="co">$ / 1M output tokens</label><input id="co" className="input mt-1" inputMode="decimal" value={f.costOut} onChange={(e) => setF({ ...f, costOut: e.target.value })} /></div>
      <div className="flex items-end md:col-span-2"><button disabled={busy} className="btn btn-primary">{connection ? 'Save connection' : 'Add connection'}</button></div>
    </form>
  );
}


export default function RuntimePage() {
  const { data, reload } = useData<any>('/api/runtime/kiro', { filter: (e) => /KIRO|FALLBACK/.test(e.type), intervalMs: 5000 });
  const { data: fb, reload: reloadFb } = useData<any>('/api/runtime/fallback');
  const { data: runs } = useData<any>('/api/runtime/runs', { filter: (e) => e.type === 'KIRO_RUN_FINISHED' || e.type === 'FALLBACK_ACTIVATED', intervalMs: 10_000 });
  const { data: pol, reload: reloadPol } = useData<any>('/api/policies');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const s = data.status; const d = s.detection;
  const savePolicy = async (patch: any) => { setPolicyError(null); try { await api('/api/policies', { method: 'PUT', body: patch }); await reloadPol(); await reload(); } catch (e) { setPolicyError((e as Error).message); } };
  const kiroToday = data.today.filter((t: any) => t.runtime === 'KIRO');
  const fbToday = data.today.filter((t: any) => t.runtime === 'FALLBACK');
  return (
    <div>
      <PageHeader title="AI Runtime" sub="Choose Kiro CLI, 9Router, OpenRouter or another connected AI provider." actions={<button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await api('/api/runtime/kiro/detect', { method: 'POST' }); await reload(); } finally { setBusy(false); } }}>{busy ? 'Checking…' : 'Re-detect Kiro'}</button>} />
      <ErrorNote error={policyError} />
      {pol ? <div className="panel mb-4 p-4"><label className="label" htmlFor="primary-ai">Primary AI</label><select id="primary-ai" className="input mt-1 max-w-lg" value={pol.policies.primaryRuntime ?? 'KIRO'} onChange={(e) => savePolicy({ primaryRuntime: e.target.value })}><option value="KIRO">Kiro CLI</option><option value="PROVIDERS">Connected providers — 9Router / OpenRouter</option></select><p className="mt-2 text-xs text-zinc-500">Connected providers run immediately in priority order, without waiting for Kiro. API calls may use your provider quota. This mode generates text and files without Kiro's live tools.</p></div> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="panel xl:col-span-2">
          <div className="panel-h">KIRO CLI<Badge>{s.health}</Badge></div>
          <dl className="grid grid-cols-3 gap-y-1.5 px-4 py-3 text-[12.5px] md:grid-cols-6">
            <Row k="Status" v={<Badge tone={d.installed && d.authenticated ? 'good' : 'bad'}>{d.installed && d.authenticated ? 'CONNECTED' : 'DISCONNECTED'}</Badge>} />
            <Row k="Authentication" v={d.authenticated ? `ACTIVE (${d.authMethod})` : d.error ?? 'Not signed in'} />
            <Row k="Executable" v={d.installed ? 'Detected' : 'Not found'} />
            <Row k="Version" v={d.version ?? '—'} />
            <Row k="Health" v={`${s.health} — ${s.healthReason}`} />
            <Row k="Active sessions" v={s.activeSessions} />
            <Row k="Running agents" v={`${s.runningJobs} / pool ${s.poolSize}`} />
            <Row k="Queued jobs" v={s.queuedJobs} />
            <Row k="Last successful run" v={s.lastSuccessAt ? `${dateTime(s.lastSuccessAt)} (${timeAgo(s.lastSuccessAt)})` : '—'} />
            <Row k="Failure rate" v={`${(s.failureRate * 100).toFixed(0)}% of last ${s.recentRuns} runs`} />
            <Row k="Credits today" v={`${s.creditsToday.toFixed(2)}${s.dailyCreditSoftLimit ? ` / ${s.dailyCreditSoftLimit} budget` : ''}`} />
            <Row k="Fallback status" v={data.policies.fallbackEnabled ? `STANDBY (${data.policies.fallbackMode.replace('_', ' ')})` : 'DISABLED'} />
            {s.limitedUntil ? <Row k="Limited until" v={dateTime(s.limitedUntil)} /> : null}
            {s.lastError ? <Row k="Last error" v={<span className="text-red-700">{s.lastError}</span>} /> : null}
            <Row k="Last checked" v={dateTime(d.checkedAt)} />
          </dl>
          <div className="border-t border-zinc-200 px-4 py-3">
            <div className="label mb-2">Worker pool</div>
            {s.workers.length === 0 ? <p className="text-[12px] text-zinc-500">No Kiro workers running. Workers start on demand and are reused across employees.</p> : (
              <table className="table"><thead><tr><th>Worker</th><th>State</th><th>Current job</th><th>Jobs</th><th>Sessions</th><th>Uptime</th></tr></thead>
                <tbody>{s.workers.map((w: any) => <tr key={w.id}><td>#{w.id}</td><td><Badge tone={w.busy ? 'info' : 'neutral'}>{w.busy ? 'BUSY' : 'IDLE'}</Badge></td><td>{w.label ?? '—'}</td><td>{w.jobs}</td><td>{w.sessions}</td><td>{duration(w.uptimeSec * 1000)}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
        <div className="space-y-4">
          <div className="panel"><div className="panel-h">Runtime usage today</div>
            <ul className="px-4 py-2 text-[12.5px]">
              <li className="flex justify-between py-1"><span>Kiro</span><span>{kiroToday.reduce((a: number, t: any) => a + t.n, 0)} runs · {kiroToday.reduce((a: number, t: any) => a + t.credits, 0).toFixed(2)} credits</span></li>
              {fbToday.length === 0 ? <li className="flex justify-between py-1 text-zinc-500"><span>Fallback</span><span>0 runs</span></li> : Object.values(fbToday.reduce((m: any, t: any) => { m[t.provider] = m[t.provider] ?? { p: t.provider, n: 0, usd: 0 }; m[t.provider].n += t.n; m[t.provider].usd += t.usd; return m; }, {})).map((x: any) => <li key={x.p} className="flex justify-between py-1"><span>Fallback {x.p}</span><span>{x.n} runs · ${x.usd.toFixed(2)}</span></li>)}
            </ul>
          </div>
          {pol ? <div className="panel"><div className="panel-h">Kiro pool & limits</div>
            <div className="grid grid-cols-2 gap-3 px-4 py-3 text-[12.5px]">
              <label>Pool size<input type="number" min={1} max={20} className="input mt-1" defaultValue={pol.policies.kiro.poolSize} onBlur={(e) => savePolicy({ kiro: { poolSize: Number(e.target.value) } })} /></label>
              <label>Daily credit budget (0 = none)<input type="number" min={0} className="input mt-1" defaultValue={pol.policies.kiro.dailyCreditSoftLimit} onBlur={(e) => savePolicy({ kiro: { dailyCreditSoftLimit: Number(e.target.value) } })} /></label>
            </div>
          </div> : null}
        </div>
      </div>

      <div className="panel mt-4">
        <div className="panel-h">AI provider connections<span className="flex items-center gap-2 font-normal">{msg ? <span className="text-[12px] text-zinc-600">{msg}</span> : null}<button className="btn h-7" onClick={() => { setAdding(!adding); setEditing(null); }}>{adding ? 'Close' : 'Add connection'}</button></span></div>
        {pol ? (
          <div className="grid gap-4 px-4 py-3 text-[12.5px] md:grid-cols-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={pol.policies.fallbackEnabled} onChange={(e) => savePolicy({ fallbackEnabled: e.target.checked })} />Fallback enabled</label>
            <label>Approval mode<select className="input mt-1" value={pol.policies.fallbackMode} onChange={(e) => savePolicy({ fallbackMode: e.target.value })}><option value="ASK_OWNER">ASK OWNER — pause task and request approval</option><option value="AUTO">AUTO — switch immediately when Kiro cannot continue</option><option value="DISABLED">DISABLED — pause until Kiro is available</option></select></label>
            <p className="text-zinc-500">When Kiro is primary, fallback activates only for: rate limit, usage limit, Kiro unavailable, process error, timeout after retries, or your explicit override. Every switch is recorded with reason, task, employee, model, duration and cost.</p>
          </div>
        ) : null}
        {fb?.connections?.length ? (
          <table className="table"><thead><tr><th>Priority</th><th>Name</th><th>Provider</th><th>Model</th><th>Key</th><th>Health</th><th>Enabled</th><th /></tr></thead>
            <tbody>{fb.connections.map((c: any) => <tr key={c.id}><td>{c.priority === 1 ? 'Primary' : `#${c.priority}`}</td><td className="font-medium">{c.name}</td><td>{fb.providers.find((p: any) => p.key === c.provider)?.label ?? c.provider}</td><td className="mono">{c.model}</td><td className="mono">{c.maskedKey ?? '—'}</td><td><Badge>{c.health}</Badge>{c.healthMessage ? <div className="max-w-xs truncate text-[11px] text-zinc-500" title={c.healthMessage}>{c.healthMessage}</div> : null}</td><td><input type="checkbox" aria-label="Enabled" checked={c.enabled} onChange={async (e) => { await api(`/api/runtime/fallback/${c.id}`, { method: 'PUT', body: { enabled: e.target.checked } }); reloadFb(); }} /></td>
              <td className="whitespace-nowrap"><button className="text-accent" onClick={() => { setEditing(c); setAdding(false); }}>Edit</button> · <button className="text-accent" onClick={async () => { setMsg('Testing…'); const r = await api(`/api/runtime/fallback/${c.id}/test`, { method: 'POST' }); setMsg(`${c.name}: ${r.ok ? 'OK' : 'FAILED'} — ${r.message}`); reloadFb(); }}>Test</button> · <button className="text-red-700" onClick={async () => { if (confirm(`Delete ${c.name}? The encrypted key is destroyed.`)) { await api(`/api/runtime/fallback/${c.id}`, { method: 'DELETE' }); reloadFb(); } }}>Delete</button></td></tr>)}</tbody></table>
        ) : <Empty>No AI provider connections configured. Add 9Router or OpenRouter to get started.</Empty>}
        {editing && fb ? <FallbackForm key={editing.id} connection={editing} providers={fb.providers} onDone={() => { setEditing(null); reloadFb(); }} /> : null}
        {adding && fb ? <FallbackForm providers={fb.providers} onDone={() => { setAdding(false); reloadFb(); }} /> : null}
      </div>

      <div className="panel mt-4 overflow-x-auto">
        <div className="panel-h">Recent agent runs</div>
        {(runs?.runs ?? []).length === 0 ? <Empty>No runs yet.</Empty> : (
          <table className="table"><thead><tr><th>When</th><th>Runtime</th><th>Provider / agent</th><th>Worker</th><th>Status</th><th>Tools</th><th>Credits / cost</th><th>Duration</th><th>Task</th></tr></thead>
            <tbody>{runs.runs.slice(0, 60).map((r: any) => <tr key={r.id}><td className="text-zinc-500">{timeAgo(r.createdAt)}</td><td><Badge tone={r.runtime === 'FALLBACK' ? 'warn' : 'neutral'}>{r.runtime}</Badge></td><td>{r.provider} · <span className="mono">{r.agentProfile}</span>{r.fallbackReason ? <div className="text-[11px] text-amber-700">{r.fallbackReason}</div> : null}</td><td>{r.workerId ? `#${r.workerId}` : '—'}</td><td><Badge>{r.status}</Badge>{r.errorClass ? <div className="text-[11px] text-red-700" title={r.errorMessage}>{r.errorClass}</div> : null}</td><td>{r.toolCalls}</td><td>{r.credits.toFixed(2)}{r.costUsd ? ` · $${r.costUsd.toFixed(3)}` : ''}</td><td>{duration(r.durationMs)}</td><td>{r.taskId ? <Link href={`/tasks/${r.taskId}`} className="text-accent">open</Link> : 'CEO chat'}</td></tr>)}</tbody></table>
        )}
      </div>
    </div>
  );
}
