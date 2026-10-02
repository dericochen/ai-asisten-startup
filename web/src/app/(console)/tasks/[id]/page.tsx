'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { api, dateTime, duration, useData } from '@/lib/api';
import { Badge, ErrorNote, PageHeader, Progress } from '@/components/ui';
import { stepIcon } from '@/components/project-tabs';

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, reload } = useData<any>(`/api/tasks/${id}`, { filter: (e) => e.taskId === id, intervalMs: 5000 });
  const [run, setRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!d) return <p className="text-zinc-500">Loading…</p>;
  const t = d.task;
  const act = async (path: string) => { setError(null); try { await api(path, { method: 'POST' }); await reload(); } catch (e) { setError((e as Error).message); } };
  const shownRun = d.runs.find((r: any) => r.id === (run ?? d.runs[0]?.id));
  return (
    <div>
      <div className="mb-1 text-[12px] text-zinc-500">{t.projectId ? <Link href={`/projects/${t.projectId}`} className="hover:underline">Project</Link> : 'Company'} / {t.code}</div>
      <PageHeader title={`${t.code} · ${t.title}`} sub={`${t.stage} · ${t.departmentKey} · round ${t.round} · attempt ${t.attempts}`}
        actions={(t.status === 'BLOCKED' || t.status === 'FAILED') ? <><button className="btn" onClick={() => act(`/api/tasks/${id}/retry`)}>Retry on Kiro</button><button className="btn" onClick={() => act(`/api/tasks/${id}/force-fallback`)}>Approve fallback for this task</button></> : null} />
      <ErrorNote error={error} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="panel">
          <div className="panel-h">Status<Badge>{t.status}</Badge></div>
          <div className="px-4 py-3">
            <Progress value={t.status === 'DONE' ? 100 : t.progress} />
            <ul className="mt-3 space-y-1">{t.steps.map((s: any) => <li key={s.key} className="flex items-center gap-2 text-[12.5px]">{stepIcon(s.status)}{s.label}</li>)}</ul>
            {t.blockedReason ? <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{t.blockedReason}</div> : null}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">Assignment</div>
          <dl className="grid grid-cols-3 gap-y-1.5 px-4 py-3 text-[12.5px]">
            <dt className="text-zinc-500">Employee</dt><dd className="col-span-2">{d.assignee ? <Link href={`/employees/${d.assignee.id}`} className="hover:underline">{d.assignee.name}</Link> : '—'}</dd>
            <dt className="text-zinc-500">Role</dt><dd className="col-span-2">{t.roleKey}</dd>
            <dt className="text-zinc-500">Runtime</dt><dd className="col-span-2">{t.runtime ?? '—'}</dd>
            <dt className="text-zinc-500">Branch</dt><dd className="col-span-2 mono">{t.branch ?? '—'}</dd>
            <dt className="text-zinc-500">Cost</dt><dd className="col-span-2">{t.costCredits.toFixed(2)} Kiro credits{t.costUsd ? ` · $${t.costUsd.toFixed(3)} fallback` : ''}</dd>
            <dt className="text-zinc-500">Started</dt><dd className="col-span-2">{dateTime(t.startedAt)}</dd>
            <dt className="text-zinc-500">Completed</dt><dd className="col-span-2">{dateTime(t.completedAt)}</dd>
          </dl>
        </div>
        <div className="panel">
          <div className="panel-h">Result</div>
          <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap px-4 py-3 text-[11px]">{t.result ? JSON.stringify(t.result, null, 2) : '—'}</pre>
        </div>
      </div>
      <div className="panel mt-4">
        <div className="panel-h">Agent runs</div>
        <table className="table"><thead><tr><th>Started</th><th>Runtime</th><th>Provider / profile</th><th>Worker</th><th>Status</th><th>Tool calls</th><th>Credits / cost</th><th>Duration</th><th /></tr></thead>
          <tbody>{d.runs.map((r: any) => <tr key={r.id} className={shownRun?.id === r.id ? 'bg-zinc-50' : ''}><td>{dateTime(r.createdAt)}</td><td><Badge tone={r.runtime === 'FALLBACK' ? 'warn' : 'neutral'}>{r.runtime}</Badge></td><td>{r.provider} · <span className="mono">{r.agentProfile}</span>{r.fallbackReason ? <div className="text-[11px] text-amber-700">{r.fallbackReason}</div> : null}</td><td>{r.workerId ? `#${r.workerId}` : '—'}</td><td><Badge>{r.status}</Badge>{r.errorClass ? <div className="text-[11px] text-red-700">{r.errorClass}</div> : null}</td><td>{r.toolCalls}</td><td>{r.credits.toFixed(2)}{r.costUsd ? ` · $${r.costUsd.toFixed(3)}` : ''}</td><td>{duration(r.durationMs)}</td><td><button className="text-accent" onClick={() => setRun(r.id)}>View</button></td></tr>)}</tbody></table>
      </div>
      {shownRun ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="panel"><div className="panel-h">Agent output (streamed from Kiro)</div><pre className="mono max-h-[32rem] overflow-auto whitespace-pre-wrap px-4 py-3 text-[11px]">{shownRun.output || shownRun.errorMessage || '—'}</pre></div>
          <div className="panel"><div className="panel-h">Tool calls & policy decisions</div>
            <table className="table"><tbody>{d.toolCalls.filter((c: any) => c.runId === shownRun.id).map((c: any) => <tr key={c.id}><td className="mono w-20">{c.toolName}</td><td className="text-[12px]">{c.title}{c.reason ? <div className="text-[11px] text-zinc-500">{c.reason}</div> : null}</td><td><Badge tone={c.decision === 'DENIED' ? 'bad' : c.decision === 'ALLOWED' ? 'good' : 'neutral'}>{c.decision}</Badge></td><td className="text-[11px] text-zinc-500">{c.status}</td></tr>)}</tbody></table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
