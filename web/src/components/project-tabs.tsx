'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Circle, Lock, Loader2, XCircle } from 'lucide-react';
import { api, clock, dateTime, duration, useData, timeAgo } from '@/lib/api';
import { Badge, Empty, Progress } from '@/components/ui';
import { Markdown } from '@/components/Markdown';

const stepIcon = (s: string) => s === 'DONE' || s === 'SKIPPED' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-700" /> : s === 'ACTIVE' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /> : s === 'FAILED' ? <XCircle className="h-3.5 w-3.5 text-red-700" /> : <Circle className="h-3.5 w-3.5 text-zinc-300" />;

export function Overview({ d }: { d: any }) {
  const p = d.project; const pr = d.progress; const h = d.health;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="panel xl:col-span-2">
        <div className="panel-h">Where is the project?<span className="font-normal text-zinc-500">Progress is derived from gates, tasks and steps — hover for the explanation</span></div>
        <div className="grid gap-x-8 gap-y-2 px-4 py-3 md:grid-cols-2">
          {pr.groups.map((g: any) => (
            <div key={g.key} title={g.explanation} className="flex items-center gap-3">
              <span className="w-32 text-[12.5px]">{g.label}</span>
              {g.locked ? <span className="flex flex-1 items-center gap-1.5 text-[12px] text-zinc-400"><Lock className="h-3.5 w-3.5" />Locked</span> : <div className="flex-1"><Progress value={g.percent} /></div>}
            </div>
          ))}
          {pr.tracks.map((t: any) => (
            <div key={t.key} className="flex items-center gap-3"><span className="w-32 text-[12.5px] text-zinc-500">↳ {t.label}</span><div className="flex-1"><Progress value={t.percent} tone="muted" /></div></div>
          ))}
        </div>
        {pr.engineeringLocked ? <div className="border-t border-zinc-200 px-4 py-2 text-[12px] text-amber-800"><Lock className="mr-1 inline h-3.5 w-3.5" />ENGINEERING IMPLEMENTATION LOCKED until: {pr.engineeringLockReasons.join(' · ')}</div> : null}
      </div>
      <div className="space-y-4">
        <div className="panel">
          <div className="panel-h">Next gate{d.nextPhase ? `: ${d.nextPhase.replace(/_/g, ' ')}` : ''}</div>
          <ul className="px-4 py-2">{d.nextRequirements.length === 0 ? <li className="py-1 text-[12px] text-zinc-500">No mandatory gate for the next phase.</li> : d.nextRequirements.map((r: any) => (
            <li key={r.label} className="flex items-center gap-2 py-1 text-[12.5px]">{r.met ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <Circle className="h-4 w-4 text-zinc-300" />}{r.label}<span className="ml-auto text-[11px] text-zinc-500">{r.detail}</span></li>))}</ul>
        </div>
        <div className="panel">
          <div className="panel-h">Health</div>
          <ul className="px-4 py-2">{h.signals.map((s: any) => <li key={s.area} className="flex items-center gap-2 py-1 text-[12.5px]"><Badge tone={s.status === 'GOOD' ? 'good' : s.status === 'WARN' ? 'warn' : 'bad'}>{s.status}</Badge><span className="w-24 font-medium">{s.area}</span><span className="text-zinc-500">{s.reason}</span></li>)}</ul>
        </div>
      </div>
      <div className="panel">
        <div className="panel-h">Currently working</div>
        {d.working.length === 0 ? <Empty>Nobody is working on this project right now.</Empty> : <ul>{d.working.map((w: any) => <li key={w.id} className="border-b border-zinc-100 px-4 py-2"><div className="flex items-center gap-2"><Link className="font-medium hover:underline" href={`/employees/${w.id}`}>{w.name}</Link><Badge>{w.status}</Badge></div><div className="truncate text-[12px] text-zinc-500">{w.activity ?? '—'}</div></li>)}</ul>}
      </div>
      <div className="panel">
        <div className="panel-h">Blockers</div>
        {h.blockers.length === 0 ? <Empty>No blockers.</Empty> : <ul>{h.blockers.map((b: any) => (
          <li key={b.taskId} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]">
            <div className="flex items-center gap-2"><Badge tone="bad">BLOCKER</Badge><Link href={`/tasks/${b.taskId}`} className="font-medium hover:underline">{b.code} {b.title}</Link></div>
            <div className="mt-1 text-zinc-600">{b.reason}</div>
            <div className="mt-1 text-[11.5px] text-zinc-500">Blocking {b.downstream} downstream task(s)</div>
          </li>))}</ul>}
      </div>
      <div className="panel">
        <div className="panel-h">Project</div>
        <dl className="grid grid-cols-3 gap-y-1.5 px-4 py-3 text-[12.5px]">
          <dt className="text-zinc-500">Sponsor</dt><dd className="col-span-2">{d.sponsor?.name ?? '—'}</dd>
          <dt className="text-zinc-500">Project manager</dt><dd className="col-span-2">{d.projectManager?.name ?? '—'}</dd>
          <dt className="text-zinc-500">Type</dt><dd className="col-span-2">{p.type.replace(/_/g, ' ')}</dd>
          <dt className="text-zinc-500">Risk</dt><dd className="col-span-2">{p.risk}</dd>
          <dt className="text-zinc-500">Staging</dt><dd className="col-span-2">{p.stagingUrl ? <a href={p.stagingUrl} className="text-accent underline" target="_blank" rel="noreferrer">{p.stagingUrl}</a> : '—'}</dd>
          <dt className="text-zinc-500">Production</dt><dd className="col-span-2">{p.productionUrl ? <a href={p.productionUrl} className="text-accent underline" target="_blank" rel="noreferrer">{p.productionUrl}</a> : '—'}</dd>
          <dt className="text-zinc-500">Workspace</dt><dd className="col-span-2 mono break-all">{p.workspacePath}</dd>
          <dt className="text-zinc-500">Created</dt><dd className="col-span-2">{dateTime(p.createdAt)}</dd>
        </dl>
      </div>
    </div>
  );
}

export function Timeline({ id }: { id: string }) {
  const { data } = useData<any>(`/api/projects/${id}/timeline`, { filter: (e) => e.projectId === id && e.id > 0 });
  const evs = (data?.events ?? []).slice().reverse();
  return (
    <div className="panel">
      {evs.length === 0 ? <Empty>No activity yet.</Empty> : <ol>{evs.map((e: any) => (
        <li key={e.id} className="flex gap-3 border-b border-zinc-100 px-4 py-1.5 text-[12.5px]">
          <span className="w-12 shrink-0 tabular-nums text-zinc-400">{clock(e.createdAt)}</span>
          <span className="w-44 shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400">{e.type.replace(/_/g, ' ')}</span>
          <span>{e.message}</span>
        </li>))}</ol>}
    </div>
  );
}

const COLUMNS: [string, string[]][] = [['Backlog', ['BACKLOG']], ['Ready', ['READY']], ['Working', ['WORKING']], ['Review', ['REVIEW']], ['QA', ['QA']], ['Blocked', ['BLOCKED', 'FAILED']], ['Done', ['DONE']]];

export function TaskBoard({ id }: { id: string }) {
  const { data } = useData<any>(`/api/projects/${id}/tasks`, { filter: (e) => e.projectId === id && (e.type.startsWith('TASK_') || e.type === 'AGENT_TOOL_CALL') });
  const [mode, setMode] = useState<'board' | 'table'>('board');
  const tasks: any[] = (data?.tasks ?? []).filter((t: any) => t.status !== 'CANCELLED');
  const card = (t: any) => (
    <Link key={t.id} href={`/tasks/${t.id}`} className="block rounded border border-zinc-200 bg-white p-2 hover:border-zinc-400">
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500"><span className="mono">{t.code}</span>{t.runtime ? <Badge tone={t.runtime === 'FALLBACK' ? 'warn' : 'neutral'}>{t.runtime}</Badge> : null}{t.round > 1 ? <span>r{t.round}</span> : null}</div>
      <div className="my-1 text-[12.5px] font-medium leading-snug">{t.title}</div>
      <div className="mb-1 truncate text-[11.5px] text-zinc-500">{t.assignee?.name ?? '—'} · {t.departmentKey}</div>
      <Progress value={t.status === 'DONE' ? 100 : t.progress} />
      {t.blockedReason ? <div className="mt-1 line-clamp-2 text-[11px] text-red-700">{t.blockedReason}</div> : null}
    </Link>
  );
  return (
    <div>
      <div className="mb-2 flex gap-1" role="tablist">{(['board', 'table'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} className={`btn h-7 ${mode === m ? 'btn-primary' : ''}`} onClick={() => setMode(m)}>{m === 'board' ? 'Kanban' : 'Table'}</button>)}</div>
      {mode === 'board' ? (
        <div className="grid gap-2 overflow-x-auto" style={{ gridTemplateColumns: 'repeat(7, minmax(190px, 1fr))' }}>
          {COLUMNS.map(([label, sts]) => { const col = tasks.filter((t) => sts.includes(t.status)); return (
            <div key={label} className="rounded bg-zinc-100 p-2"><div className="label mb-2 flex justify-between">{label}<span>{col.length}</span></div><div className="space-y-2">{col.map(card)}</div></div>
          ); })}
        </div>
      ) : (
        <div className="panel overflow-x-auto"><table className="table">
          <thead><tr><th>Task</th><th>Employee</th><th>Department</th><th>Status</th><th className="w-36">Progress</th><th>Depends on</th><th>Runtime</th><th>Cost</th><th>Updated</th></tr></thead>
          <tbody>{tasks.map((t) => (
            <tr key={t.id}><td><Link className="font-medium hover:underline" href={`/tasks/${t.id}`}>{t.code} {t.title}</Link></td><td>{t.assignee?.name ?? '—'}</td><td>{t.departmentKey}</td><td><Badge>{t.status}</Badge></td><td><Progress value={t.status === 'DONE' ? 100 : t.progress} /></td><td className="mono text-[11px]">{t.dependsOnCodes.join(', ') || '—'}</td><td>{t.runtime ?? '—'}</td><td className="tabular-nums">{t.costCredits ? `${t.costCredits.toFixed(2)} cr` : ''}{t.costUsd ? ` $${t.costUsd.toFixed(3)}` : ''}</td><td className="text-zinc-500">{timeAgo(t.updatedAt)}</td></tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function Docs({ id, kinds }: { id: string; kinds: string[] }) {
  const { data } = useData<any>(`/api/artifacts?projectId=${id}`, { filter: (e) => e.type === 'ARTIFACT_CREATED' && e.projectId === id });
  const list = (data?.artifacts ?? []).filter((a: any) => kinds.includes(a.kind));
  const [sel, setSel] = useState<string | null>(null);
  const { data: doc } = useData<any>(sel ?? (list[0] ? `/api/artifacts/${list[0].id}` : null));
  if (!list.length) return <div className="panel"><Empty>No deliverables in this area yet.</Empty></div>;
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <ul className="panel h-fit">{list.map((a: any) => (
        <li key={a.id}><button className={`w-full border-b border-zinc-100 px-3 py-2 text-left text-[12.5px] hover:bg-zinc-50 ${(sel ?? `/api/artifacts/${list[0].id}`) === `/api/artifacts/${a.id}` ? 'bg-zinc-100 font-semibold' : ''}`} onClick={() => setSel(`/api/artifacts/${a.id}`)}>{a.title} <span className="text-zinc-400">v{a.version}</span><div className="text-[11px] font-normal text-zinc-500">{a.kind.replace(/_/g, ' ')} · {timeAgo(a.createdAt)}</div></button></li>))}</ul>
      <div className="panel p-5 lg:col-span-3">{doc ? <><div className="mb-2 flex items-center gap-2"><Badge tone="neutral">{doc.kind}</Badge><span className="text-[12px] text-zinc-500">v{doc.version} · {dateTime(doc.createdAt)}</span></div><Markdown text={doc.content} /></> : <Empty>Loading…</Empty>}</div>
    </div>
  );
}

export function Checks({ id, suites }: { id: string; suites: string[] }) {
  const { data } = useData<any>(`/api/projects/${id}/checks`, { filter: (e) => e.type === 'CHECK_COMPLETED' || e.type === 'TEST_FAILED' });
  const checks = (data?.checks ?? []).filter((c: any) => suites.includes(c.suite));
  if (!checks.length) return <div className="panel"><Empty>No check runs recorded yet. Results appear here as real executions complete.</Empty></div>;
  return (
    <div className="panel overflow-x-auto"><table className="table">
      <thead><tr><th>Suite</th><th>Check</th><th>Result</th><th>Details</th><th>Duration</th><th>When</th></tr></thead>
      <tbody>{checks.map((c: any) => (
        <tr key={c.id} className={c.name === 'summary' ? 'bg-zinc-50 font-semibold' : ''}><td>{c.suite}</td><td>{c.name}</td><td><Badge>{c.status}</Badge></td><td><pre className="mono max-h-40 max-w-xl overflow-auto whitespace-pre-wrap text-[11px] font-normal text-zinc-600">{c.details}</pre></td><td>{duration(c.durationMs)}</td><td className="text-zinc-500">{dateTime(c.createdAt)}</td></tr>))}</tbody>
    </table></div>
  );
}

export function Deployments({ id }: { id: string }) {
  const { data } = useData<any>(`/api/projects/${id}/releases`, { filter: (e) => /STAGING|PRODUCTION|RELEASE|ROLLBACK/.test(e.type) });
  const [log, setLog] = useState<any>(null);
  const rel = data?.releases ?? []; const deps = data?.deployments ?? [];
  const GATES = ['staging_deploy', 'staging_validation', 'release_board', 'production_deploy', 'production_health'];
  return (
    <div className="space-y-4">
      {rel.length === 0 ? <div className="panel"><Empty>No releases yet. A release candidate is created after code review, QA, security and performance pass.</Empty></div> : rel.map((r: any) => (
        <div key={r.id} className="panel">
          <div className="panel-h">RELEASE {r.version}<Badge>{r.status}</Badge></div>
          <div className="grid grid-cols-2 gap-2 px-4 py-3 text-[12.5px] md:grid-cols-5">{GATES.map((g) => <div key={g}><div className="label">{g.replace(/_/g, ' ')}</div><Badge tone={r.gates[g] === 'PASS' || r.gates[g] === 'GO' ? 'good' : r.gates[g] ? 'bad' : 'neutral'}>{r.gates[g] ?? 'PENDING'}</Badge></div>)}</div>
          <div className="border-t border-zinc-200 px-4 py-2 text-[12px] text-zinc-500">Commit <span className="mono">{r.commit.slice(0, 10)}</span> · {dateTime(r.createdAt)}</div>
        </div>))}
      {deps.length ? <div className="panel overflow-x-auto"><div className="panel-h">Deployments</div><table className="table">
        <thead><tr><th>Environment</th><th>Status</th><th>URL</th><th>Commit</th><th>Provider</th><th>Started</th><th /></tr></thead>
        <tbody>{deps.map((d: any) => <tr key={d.id}><td>{d.environment}{d.active ? ' · active' : ''}</td><td><Badge>{d.status}</Badge></td><td>{d.url ? <a className="text-accent underline" href={d.url} target="_blank" rel="noreferrer">{d.url}</a> : '—'}</td><td className="mono">{d.commit.slice(0, 8)}</td><td>{d.provider}</td><td>{dateTime(d.startedAt)}</td><td><button className="text-accent" onClick={() => setLog(d)}>Log</button></td></tr>)}</tbody>
      </table></div> : null}
      {log ? <div className="panel"><div className="panel-h">Deployment log<button onClick={() => setLog(null)} className="font-normal text-accent">Close</button></div><pre className="mono max-h-96 overflow-auto whitespace-pre-wrap px-4 py-3 text-[11px]">{log.log}</pre></div> : null}
    </div>
  );
}

export function Monitoring({ id }: { id: string }) {
  const { data } = useData<any>(`/api/projects/${id}/monitoring`, { intervalMs: 10_000 });
  const s = data?.samples ?? [];
  if (!s.length) return <div className="panel"><Empty>Monitoring begins once production is deployed.</Empty></div>;
  const up = s.filter((x: any) => x.ok).length;
  return (
    <div className="panel">
      <div className="panel-h">Production health probes<span className="font-normal text-zinc-500">{up}/{s.length} healthy · avg {Math.round(s.reduce((a: number, x: any) => a + (x.latencyMs ?? 0), 0) / s.length)}ms</span></div>
      <div className="flex gap-0.5 px-4 py-3" aria-label="Recent probes">{s.slice().reverse().map((x: any) => <span key={x.id} title={`${dateTime(x.createdAt)} — ${x.ok ? `HTTP ${x.httpStatus}, ${x.latencyMs}ms` : x.error ?? `HTTP ${x.httpStatus}`}`} className={`h-6 w-1.5 rounded-sm ${x.ok ? 'bg-green-600' : 'bg-red-600'}`} />)}</div>
    </div>
  );
}

export function Records({ id }: { id: string }) {
  const { data } = useData<any>(`/api/projects/${id}/records`, { filter: (e) => e.type === 'MEETING_HELD' || e.type === 'DECISION_RECORDED' });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="panel"><div className="panel-h">Meetings</div>{(data?.meetings ?? []).length === 0 ? <Empty>No meetings yet.</Empty> : data.meetings.map((m: any) => (
        <div key={m.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><div className="flex gap-2"><Badge tone="neutral">{m.type}</Badge><span className="font-medium">{m.title}</span></div><div className="mt-1"><span className="text-zinc-500">Decision:</span> {m.decision}</div>{m.objections.length ? <div className="text-zinc-500">Objections: {m.objections.join('; ')}</div> : null}{m.actionItems.length ? <ul className="ml-4 list-disc text-zinc-600">{m.actionItems.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul> : null}</div>))}</div>
      <div className="panel"><div className="panel-h">Decisions (ADRs)</div>{(data?.decisions ?? []).length === 0 ? <Empty>No decisions recorded yet.</Empty> : data.decisions.map((d: any) => (
        <div key={d.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><div className="font-medium"><span className="mono text-zinc-500">{d.code}</span> {d.title}</div><div>{d.decision}</div><div className="text-[11.5px] text-zinc-500">Proposed: {d.proposedBy} · Reviewed: {d.reviewedBy.join(', ')} · Approved: {d.approvedBy ?? '—'}</div></div>))}</div>
    </div>
  );
}

export function Costs({ id }: { id: string }) {
  const { data } = useData<any>(`/api/projects/${id}/costs`);
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="panel overflow-x-auto"><div className="panel-h">Runtime usage</div><table className="table">
        <thead><tr><th>Runtime</th><th>Provider</th><th>Runs</th><th>Kiro credits</th><th>API spend</th><th>Agent time</th></tr></thead>
        <tbody>{data.byRuntime.map((r: any) => <tr key={r.runtime + r.provider}><td><Badge tone={r.runtime === 'FALLBACK' ? 'warn' : 'neutral'}>{r.runtime}</Badge></td><td>{r.provider}</td><td>{r.runs}</td><td className="tabular-nums">{r.credits.toFixed(2)}</td><td className="tabular-nums">{r.runtime === 'FALLBACK' ? `$${r.usd.toFixed(3)}${r.estimated ? ' (estimated)' : ''}` : '—'}</td><td>{duration(r.ms)}</td></tr>)}</tbody>
      </table></div>
      <div className="panel"><div className="panel-h">Why paid APIs were used</div>{data.fallbackRuns.length === 0 ? <Empty>Fallback providers have not been used for this project.</Empty> : <table className="table"><thead><tr><th>When</th><th>Provider</th><th>Model</th><th>Reason</th><th>Cost</th></tr></thead><tbody>{data.fallbackRuns.map((r: any) => <tr key={r.id}><td>{dateTime(r.createdAt)}</td><td>{r.provider}</td><td>{r.model}</td><td>{r.reason}</td><td>${r.usd.toFixed(3)}{r.estimated ? ' (est.)' : ''}</td></tr>)}</tbody></table>}</div>
      <p className="text-[12px] text-zinc-500">Hosting: {data.hosting}</p>
    </div>
  );
}

export function Git({ id }: { id: string }) {
  const { data } = useData<any>(`/api/projects/${id}/git`, { filter: (e) => e.type === 'GIT_COMMIT' || e.type === 'GIT_MERGE' });
  if (!data) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-4">
      <div className="panel h-fit"><div className="panel-h">Branches</div><ul className="px-4 py-2">{data.branches.map((b: string) => <li key={b} className="mono py-0.5">{b}</li>)}</ul></div>
      <div className="panel xl:col-span-3"><div className="panel-h">Commit history (agent-attributed)</div><table className="table"><tbody>{data.log.map((c: any) => <tr key={c.hash}><td className="mono w-20 text-zinc-500">{c.hash.slice(0, 8)}</td><td>{c.subject}</td><td className="text-zinc-600">{c.author}</td><td className="text-zinc-500">{timeAgo(c.date)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function ProjectControls({ p, reload }: { p: any; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const set = async (status: string) => {
    const reason = status === 'CANCELLED' ? prompt('Reason for cancelling this project?') : 'Owner decision';
    if (status === 'CANCELLED' && !reason) return;
    setBusy(true);
    try { await api(`/api/projects/${p.id}/status`, { method: 'POST', body: { status, reason } }); reload(); } finally { setBusy(false); }
  };
  if (p.status === 'COMPLETED' || p.status === 'CANCELLED') return null;
  return (
    <>
      {p.status === 'ACTIVE' ? <button className="btn" disabled={busy} onClick={() => set('PAUSED')}>Pause</button> : <button className="btn" disabled={busy} onClick={() => set('ACTIVE')}>Resume</button>}
      <button className="btn btn-danger" disabled={busy} onClick={() => set('CANCELLED')}>Cancel</button>
    </>
  );
}

export { stepIcon };
