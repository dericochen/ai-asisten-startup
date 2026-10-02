'use client';
import Link from 'next/link';
import { use } from 'react';
import { dateTime, duration, useData } from '@/lib/api';
import { Badge, Empty, PageHeader } from '@/components/ui';

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d } = useData<any>(`/api/employees/${id}`, { filter: (e) => e.employeeId === id && e.type !== 'AGENT_ACTIVITY' });
  if (!d) return <p className="text-zinc-500">Loading…</p>;
  const e = d.employee; const r = d.role;
  return (
    <div>
      <div className="mb-1 text-[12px] text-zinc-500"><Link href="/employees" className="hover:underline">Employees</Link> / {e.code}</div>
      <PageHeader title={e.name} sub={`${r.title} · ${r.level} · authority ${r.authority} · Kiro agent ${r.kiroAgent}`} actions={<Badge>{e.status}</Badge>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="panel"><div className="panel-h">Profile</div><div className="px-4 py-3 text-[12.5px]"><p className="mb-2 text-zinc-600">{r.responsibilities}</p><div><span className="text-zinc-500">Current activity:</span> {e.currentActivity ?? '—'}</div><div><span className="text-zinc-500">Tasks completed:</span> {e.tasksCompleted}</div><div><span className="text-zinc-500">Tools:</span> <span className="mono">{r.capabilities.tools.join(', ')}</span></div></div></div>
        <div className="panel xl:col-span-2"><div className="panel-h">Task history</div>{d.tasks.length === 0 ? <Empty>No tasks yet.</Empty> : <table className="table"><tbody>{d.tasks.map((t: any) => <tr key={t.id}><td><Link href={`/tasks/${t.id}`} className="hover:underline">{t.code} {t.title}</Link></td><td><Badge>{t.status}</Badge></td><td className="text-zinc-500">{dateTime(t.updatedAt)}</td></tr>)}</tbody></table>}</div>
        <div className="panel xl:col-span-3"><div className="panel-h">Runtime history</div>{d.runs.length === 0 ? <Empty>No agent runs yet.</Empty> : <table className="table"><thead><tr><th>When</th><th>Runtime</th><th>Provider</th><th>Status</th><th>Credits</th><th>Duration</th></tr></thead><tbody>{d.runs.map((x: any) => <tr key={x.id}><td>{dateTime(x.createdAt)}</td><td>{x.runtime}</td><td>{x.provider}</td><td><Badge>{x.status}</Badge></td><td>{x.credits.toFixed(2)}</td><td>{duration(x.durationMs)}</td></tr>)}</tbody></table>}</div>
      </div>
    </div>
  );
}
