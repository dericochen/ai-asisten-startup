'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, useData, timeAgo } from '@/lib/api';
import { Badge, Empty, ErrorNote, PageHeader, Progress } from '@/components/ui';

export default function ProjectsPage() {
  const router = useRouter();
  const { data } = useData<any>('/api/projects', { filter: (e) => e.type.startsWith('PROJECT_') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', objective: '', description: '', priority: 'MEDIUM' });
  const [error, setError] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { const p = await api('/api/projects', { method: 'POST', body: f }); router.push(`/projects/${p.id}`); }
    catch (err) { setError((err as Error).message); }
  };
  return (
    <div>
      <PageHeader title="Projects" sub="Every project runs the full company workflow with machine-enforced gates." actions={<button className="btn btn-primary" onClick={() => setOpen(!open)}>New project</button>} />
      {open ? (
        <form onSubmit={create} className="panel mb-4 grid gap-3 p-4 md:grid-cols-2">
          <ErrorNote error={error} />
          <div><label className="label" htmlFor="pn">Name</label><input id="pn" className="input mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} /></div>
          <div><label className="label" htmlFor="pp">Priority</label><select id="pp" className="input mt-1" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="md:col-span-2"><label className="label" htmlFor="po">Objective</label><input id="po" className="input mt-1" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} required minLength={5} /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="pd">Description / requirements</label><textarea id="pd" className="input mt-1" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="md:col-span-2"><button className="btn btn-primary">Create project</button> <span className="ml-2 text-[12px] text-zinc-500">Tip: you can also just ask the CEO.</span></div>
        </form>
      ) : null}
      <div className="panel">
        {!data ? <Empty>Loading…</Empty> : data.projects.length === 0 ? <Empty>No projects yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Project</th><th>Status</th><th>Phase</th><th className="w-52">Progress</th><th>Priority</th><th>Health signals</th><th>Production</th><th>Updated</th></tr></thead>
            <tbody>{data.projects.map((p: any) => (
              <tr key={p.id}>
                <td><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link><div className="text-[11px] text-zinc-500">{p.code}{p.isDemo ? ' · demo' : ''}</div></td>
                <td><Badge>{p.status}</Badge></td>
                <td className="text-[12px]">{p.phase.replace(/_/g, ' ')}</td>
                <td><Progress value={p.progress} /></td>
                <td><Badge tone={p.priority === 'CRITICAL' || p.priority === 'HIGH' ? 'warn' : 'neutral'}>{p.priority}</Badge></td>
                <td><div className="flex flex-wrap gap-1">{p.health.filter((h: any) => h.status !== 'GOOD').map((h: any) => <Badge key={h.area} tone={h.status === 'BAD' ? 'bad' : 'warn'} title={h.reason}>{h.area}</Badge>)}</div></td>
                <td className="text-[12px]">{p.productionUrl ? <a className="text-accent underline" href={p.productionUrl} target="_blank" rel="noreferrer">{p.productionUrl}</a> : '—'}</td>
                <td className="text-[12px] text-zinc-500">{timeAgo(p.updatedAt)}</td>
              </tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
