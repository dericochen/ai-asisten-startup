'use client';
import Link from 'next/link';
import { use } from 'react';
import { dateTime, useData } from '@/lib/api';
import { Badge, PageHeader } from '@/components/ui';
import { Markdown } from '@/components/Markdown';

export default function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: a } = useData<any>(`/api/artifacts/${id}`);
  if (!a) return <p className="text-zinc-500">Loading…</p>;
  return (
    <div>
      <div className="mb-1 text-[12px] text-zinc-500"><Link href="/artifacts" className="hover:underline">Artifacts</Link>{a.projectId ? <> / <Link href={`/projects/${a.projectId}`} className="hover:underline">Project</Link></> : null}</div>
      <PageHeader title={`${a.title} v${a.version}`} sub={dateTime(a.createdAt)} actions={<Badge tone="neutral">{a.kind}</Badge>} />
      <div className="panel max-w-4xl p-6"><Markdown text={a.content} /></div>
      {a.data ? <details className="panel mt-4 max-w-4xl"><summary className="panel-h cursor-pointer">Structured result (JSON)</summary><pre className="mono overflow-auto px-4 py-3 text-[11px]">{JSON.stringify(a.data, null, 2)}</pre></details> : null}
    </div>
  );
}
