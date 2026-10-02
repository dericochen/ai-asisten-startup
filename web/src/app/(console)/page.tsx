'use client';
import Link from 'next/link';
import { useData, timeAgo } from '@/lib/api';
import { Badge, Empty, Progress, Stat } from '@/components/ui';
import { CeoChat } from '@/components/CeoChat';

function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

export default function Dashboard() {
  const { data: d } = useData<any>('/api/dashboard', { filter: (e) => !['AGENT_ACTIVITY', 'TASK_PROGRESS', 'AGENT_TOOL_CALL'].includes(e.type) });
  const { data: ev } = useData<any>('/api/events?limit=25', { filter: (e) => e.id > 0 });
  if (!d) return <p className="text-zinc-500">Loading…</p>;
  const delayed = d.projects.filter((p: any) => p.health.some((h: any) => h.status === 'BAD')).length;
  const healthy = d.projects.filter((p: any) => p.status === 'ACTIVE' || p.status === 'COMPLETED').length - delayed;
  const kiroUsage = d.usageToday.filter((u: any) => u.runtime === 'KIRO').reduce((a: number, u: any) => a + u.n, 0);
  const fbUsage = d.usageToday.filter((u: any) => u.runtime === 'FALLBACK');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight">{greeting()}, Owner.</h1>
        <p className="text-[12.5px] text-zinc-500">{d.company?.name} — {d.company?.mission}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="CEO status" value={d.ceoStatus === 'IDLE' ? 'ACTIVE' : d.ceoStatus} sub="Monitoring the company" />
        <Stat label="Active projects" value={d.activeProjects} sub={`${d.projects.length} total`} />
        <Stat label="Employees" value={d.employees.total} sub={`${d.employees.working} working · ${d.employees.waiting} waiting`} />
        <Stat label="Blocked" value={d.employees.blocked} tone={d.employees.blocked ? 'warn' : undefined} sub="employees blocked" />
        <Stat label="Owner approvals" value={d.ownerApprovals} tone={d.ownerApprovals ? 'warn' : undefined} sub={<Link href="/approvals" className="text-accent">{d.pendingApprovals} pending in total</Link>} />
        <Stat label="Production incidents" value={d.productionIncidents} tone={d.productionIncidents ? 'bad' : 'good'} sub="open" />
        <Stat label="Kiro status" value={d.kiro.connected ? 'CONNECTED' : 'OFFLINE'} tone={d.kiro.connected ? 'good' : 'bad'} sub={`v${d.kiro.version ?? '?'} · ${d.kiro.health}`} />
        <Stat label="Kiro usage" value={d.kiro.health === 'NEAR_LIMIT' ? 'NEAR LIMIT' : d.kiro.health === 'LIMITED' ? 'LIMITED' : 'NORMAL'} tone={d.kiro.health === 'HEALTHY' ? 'good' : 'warn'} sub={`${kiroUsage} runs · ${d.kiro.creditsToday.toFixed(2)} credits today`} />
        <Stat label="Fallback AI" value={d.fallback.status} tone={d.fallback.status === 'ACTIVE' ? 'warn' : undefined} sub={`Mode ${d.fallback.mode.replace('_', ' ')}`} />
        <Stat label="Working now" value={d.employees.working} sub={`${d.kiro.running} Kiro worker(s) busy · ${d.kiro.queued} queued`} />
        <Stat label="Deployments" value={`${d.deployments.staging} / ${d.deployments.production}`} sub="staging / production active" />
        <Stat label="Prod. failures" value={d.deployments.productionFailures} tone={d.deployments.productionFailures ? 'warn' : undefined} sub="failed or rolled back" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><CeoChat compact /></div>
        <div className="panel">
          <div className="panel-h">CEO daily summary</div>
          <dl className="grid grid-cols-2 gap-y-2 px-4 py-3 text-[12.5px]">
            <dt className="text-zinc-500">Projects</dt><dd>{Math.max(healthy, 0)} healthy · {delayed} at risk</dd>
            <dt className="text-zinc-500">Deployments</dt><dd>{d.deployments.staging} staging · {d.deployments.productionFailures} prod failures</dd>
            <dt className="text-zinc-500">Kiro</dt><dd>{d.kiro.health}</dd>
            <dt className="text-zinc-500">Fallback</dt><dd>{fbUsage.length ? fbUsage.map((u: any) => `${u.provider}: ${u.n} runs, $${u.usd.toFixed(2)}`).join('; ') : 'Not used today'}</dd>
            <dt className="text-zinc-500">Owner actions</dt><dd>{d.ownerApprovals} approval(s) pending</dd>
            <dt className="text-zinc-500">Incidents</dt><dd>{d.productionIncidents} open</dd>
          </dl>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="panel xl:col-span-2">
          <div className="panel-h">Projects<Link href="/projects" className="text-[12px] font-normal text-accent">All projects</Link></div>
          {d.projects.length === 0 ? <Empty>No projects yet. Ask the CEO to start one.</Empty> : (
            <table className="table">
              <thead><tr><th>Project</th><th>Phase</th><th className="w-48">Progress</th><th>Health</th><th>Updated</th></tr></thead>
              <tbody>{d.projects.slice(0, 8).map((p: any) => (
                <tr key={p.id}>
                  <td><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link><div className="text-[11px] text-zinc-500">{p.code} · <Badge>{p.status}</Badge>{p.isDemo ? <> <Badge tone="neutral">DEMO</Badge></> : null}</div></td>
                  <td className="text-[12px]">{p.phase.replace(/_/g, ' ')}</td>
                  <td><Progress value={p.progress} /></td>
                  <td><div className="flex flex-wrap gap-1">{p.health.filter((h: any) => h.status !== 'GOOD').map((h: any) => <Badge key={h.area} tone={h.status === 'BAD' ? 'bad' : 'warn'} title={h.reason}>{h.area}</Badge>)}{p.health.every((h: any) => h.status === 'GOOD') ? <Badge tone="good">OK</Badge> : null}</div></td>
                  <td className="text-[12px] text-zinc-500">{timeAgo(p.updatedAt)}</td>
                </tr>))}</tbody>
            </table>
          )}
        </div>
        <div className="panel">
          <div className="panel-h">Company activity</div>
          <ul className="max-h-96 overflow-y-auto">
            {(ev?.events ?? []).map((e: any) => (
              <li key={e.id} className="border-b border-zinc-100 px-4 py-1.5 text-[12px]"><span className="mr-2 tabular-nums text-zinc-400">{new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{e.message}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
