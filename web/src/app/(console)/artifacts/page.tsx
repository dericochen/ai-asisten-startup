'use client';
import Link from 'next/link';
import { useData, timeAgo } from '@/lib/api';
import { Badge, Empty, PageHeader } from '@/components/ui';

export default function ArtifactsPage() {
  const { data } = useData<any>('/api/artifacts', { filter: (e) => e.type === 'ARTIFACT_CREATED' });
  const { data: ps } = useData<any>('/api/projects');
  const name = (id: string) => ps?.projects.find((p: any) => p.id === id)?.code ?? '—';
  const list = data?.artifacts ?? [];
  return (
    <div>
      <PageHeader title="Artifacts" sub="Versioned deliverables produced by employees: research, PRDs, designs, architecture, reviews, reports." />
      <div className="panel overflow-x-auto">{list.length === 0 ? <Empty>No artifacts yet.</Empty> : (
        <table className="table"><thead><tr><th>Title</th><th>Kind</th><th>Version</th><th>Project</th><th>Created</th></tr></thead>
          <tbody>{list.map((a: any) => <tr key={a.id}><td><Link href={`/artifacts/${a.id}`} className="font-medium hover:underline">{a.title}</Link></td><td><Badge tone="neutral">{a.kind}</Badge></td><td>v{a.version}</td><td>{a.projectId ? <Link href={`/projects/${a.projectId}`} className="hover:underline">{name(a.projectId)}</Link> : '—'}</td><td className="text-zinc-500">{timeAgo(a.createdAt)}</td></tr>)}</tbody></table>
      )}</div>
    </div>
  );
}
