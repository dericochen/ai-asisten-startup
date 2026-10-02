'use client';
import Link from 'next/link';
import { dateTime, useData } from '@/lib/api';
import { Badge, Empty, PageHeader } from '@/components/ui';

const GATES = ['staging_deploy', 'staging_validation', 'release_board', 'production_deploy', 'production_health'];

export default function DeploymentsPage() {
  const { data } = useData<any>('/api/deployments', { filter: (e) => /STAGING|PRODUCTION|RELEASE|ROLLBACK/.test(e.type) });
  return (
    <div>
      <PageHeader title="Deployments" sub="Releases only reach production after code review, QA, security, staging validation, release board and the required approvals." />
      <div className="panel mb-4 overflow-x-auto"><div className="panel-h">Releases</div>{(data?.releases ?? []).length === 0 ? <Empty>No releases yet.</Empty> : (
        <table className="table"><thead><tr><th>Project</th><th>Version</th><th>Status</th>{GATES.map((g) => <th key={g}>{g.replace(/_/g, ' ')}</th>)}<th>Commit</th><th>Created</th></tr></thead>
          <tbody>{data.releases.map((r: any) => <tr key={r.id}><td><Link href={`/projects/${r.projectId}`} className="hover:underline">{r.projectCode}</Link></td><td className="font-medium">{r.version}</td><td><Badge>{r.status}</Badge></td>{GATES.map((g) => <td key={g}>{r.gates[g] ? <Badge>{r.gates[g] === 'GO' ? 'PASS' : r.gates[g]}</Badge> : <span className="text-zinc-400">—</span>}</td>)}<td className="mono">{r.commit.slice(0, 8)}</td><td className="text-zinc-500">{dateTime(r.createdAt)}</td></tr>)}</tbody></table>
      )}</div>
      <div className="panel overflow-x-auto"><div className="panel-h">Deployments</div>{(data?.deployments ?? []).length === 0 ? <Empty>No deployments yet.</Empty> : (
        <table className="table"><thead><tr><th>Project</th><th>Environment</th><th>Status</th><th>URL</th><th>Provider</th><th>Commit</th><th>Started</th></tr></thead>
          <tbody>{data.deployments.map((d: any) => <tr key={d.id}><td><Link href={`/projects/${d.projectId}`} className="hover:underline">{d.projectCode}</Link></td><td>{d.environment}{d.active ? ' · active' : ''}</td><td><Badge>{d.status}</Badge></td><td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-accent underline">{d.url}</a> : '—'}</td><td>{d.provider}</td><td className="mono">{d.commit.slice(0, 8)}</td><td className="text-zinc-500">{dateTime(d.startedAt)}</td></tr>)}</tbody></table>
      )}</div>
    </div>
  );
}
