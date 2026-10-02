'use client';
import Link from 'next/link';
import { useData, timeAgo } from '@/lib/api';
import { Badge, Empty, PageHeader, Progress } from '@/components/ui';
import { CeoChat } from '@/components/CeoChat';

export default function CeoOffice() {
  const { data } = useData<any>('/api/ceo/office', { filter: (e) => !['AGENT_ACTIVITY', 'TASK_PROGRESS', 'AGENT_TOOL_CALL'].includes(e.type) });
  const active = (data?.projects ?? []).filter((p: any) => p.status === 'ACTIVE');
  const pend = data?.pendingApprovals ?? [];
  return (
    <div>
      <PageHeader title="CEO Office" sub="Executive priorities, reviews and the Owner's line to the CEO." />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2"><CeoChat /></div>
        <div className="space-y-4">
          <div className="panel"><div className="panel-h">Current priorities</div>{active.length === 0 ? <Empty>No active projects.</Empty> : <ul>{active.map((p: any) => <li key={p.id} className="border-b border-zinc-100 px-4 py-2"><div className="flex items-center gap-2"><Link className="font-medium hover:underline" href={`/projects/${p.id}`}>{p.name}</Link><Badge tone={p.priority === 'HIGH' || p.priority === 'CRITICAL' ? 'warn' : 'neutral'}>{p.priority}</Badge></div><div className="text-[11.5px] text-zinc-500">{p.phase.replace(/_/g, ' ')}</div><Progress value={p.progress} /></li>)}</ul>}</div>
          <div className="panel"><div className="panel-h">Pending owner approvals<Link href="/approvals" className="font-normal text-accent">Open</Link></div>{pend.filter((a: any) => a.approverRole === 'OWNER').length === 0 ? <Empty>None.</Empty> : <ul>{pend.filter((a: any) => a.approverRole === 'OWNER').map((a: any) => <li key={a.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><span className="mono text-zinc-500">{a.code}</span> {a.title}</li>)}</ul>}</div>
          <div className="panel"><div className="panel-h">Pending executive reviews</div>{pend.filter((a: any) => a.approverRole !== 'OWNER').length === 0 ? <Empty>None.</Empty> : <ul>{pend.filter((a: any) => a.approverRole !== 'OWNER').map((a: any) => <li key={a.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><span className="mono text-zinc-500">{a.code}</span> {a.title} <Badge tone="neutral">{a.approverRole}</Badge></li>)}</ul>}</div>
          <div className="panel"><div className="panel-h">Risks & incidents</div>{(data?.incidents ?? []).length === 0 ? <Empty>No open incidents.</Empty> : <ul>{data.incidents.map((i: any) => <li key={i.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><Badge>{i.severity}</Badge> {i.title}</li>)}</ul>}</div>
        </div>
        <div className="panel"><div className="panel-h">CEO inbox</div>{(data?.inbox ?? []).length === 0 ? <Empty>No escalations or blockers.</Empty> : <ul>{data.inbox.map((m: any) => <li key={m.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><div className="flex gap-2"><Badge>{m.type}</Badge><span className="font-medium">{m.subject}</span><span className="ml-auto text-[11px] text-zinc-400">{timeAgo(m.createdAt)}</span></div><div className="line-clamp-2 text-zinc-500">{m.body}</div></li>)}</ul>}</div>
        <div className="panel"><div className="panel-h">Executive meetings</div>{(data?.meetings ?? []).length === 0 ? <Empty>No meetings yet.</Empty> : <ul>{data.meetings.map((m: any) => <li key={m.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><div className="font-medium">{m.title}</div><div className="text-zinc-500">{m.decision}</div></li>)}</ul>}</div>
        <div className="panel"><div className="panel-h">Recent decisions</div>{(data?.recentDecisions ?? []).length === 0 ? <Empty>No decisions yet.</Empty> : <ul>{data.recentDecisions.map((d: any) => <li key={d.id} className="border-b border-zinc-100 px-4 py-2 text-[12.5px]"><span className="mono text-zinc-500">{d.code}</span> {d.title}</li>)}</ul>}</div>
      </div>
    </div>
  );
}
