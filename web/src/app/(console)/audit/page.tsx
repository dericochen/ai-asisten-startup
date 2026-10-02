'use client';
import { useState } from 'react';
import { dateTime, useData } from '@/lib/api';
import { Badge, Empty, PageHeader } from '@/components/ui';

export default function AuditPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data } = useData<any>(`/api/audit${query ? `?q=${encodeURIComponent(query)}` : ''}`, { intervalMs: 10_000 });
  const list = data?.entries ?? [];
  return (
    <div>
      <PageHeader title="Audit log" sub="Owner commands, approvals, tool calls (allowed and denied), commits, deployments, fallback activations. Secrets are redacted before storage." />
      <form className="mb-3 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}><input aria-label="Search audit log" className="input" placeholder="Filter: tool.denied, approval, deploy, git…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn">Filter</button></form>
      <div className="panel overflow-x-auto">{list.length === 0 ? <Empty>No entries.</Empty> : (
        <table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>{list.map((a: any) => <tr key={a.id}><td className="whitespace-nowrap text-zinc-500">{dateTime(a.createdAt)}</td><td><Badge tone={a.actorType === 'OWNER' ? 'info' : 'neutral'}>{a.actorType}</Badge> {a.actorName}</td><td className="mono">{a.action}</td><td className="mono">{a.target ?? '—'}</td><td><pre className="mono max-h-24 max-w-xl overflow-auto whitespace-pre-wrap text-[11px] text-zinc-600">{JSON.stringify(a.details)}</pre></td></tr>)}</tbody></table>
      )}</div>
    </div>
  );
}
