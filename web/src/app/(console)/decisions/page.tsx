'use client';
import { dateTime, useData } from '@/lib/api';
import { Badge, Empty, PageHeader } from '@/components/ui';

export default function DecisionsPage() {
  const { data } = useData<any>('/api/decisions', { filter: (e) => e.type === 'DECISION_RECORDED' });
  const list = data?.decisions ?? [];
  return (
    <div>
      <PageHeader title="Decision ledger" sub="Company decisions and architecture decision records with proposer, reviewers and approver." />
      <div className="panel overflow-x-auto">{list.length === 0 ? <Empty>No decisions recorded yet.</Empty> : (
        <table className="table"><thead><tr><th>ID</th><th>Decision</th><th>Reason</th><th>Proposed</th><th>Reviewed</th><th>Approved</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>{list.map((d: any) => <tr key={d.id}><td className="mono text-zinc-500">{d.code}</td><td><div className="font-medium">{d.title}</div><div className="text-zinc-600">{d.decision}</div></td><td className="max-w-md whitespace-pre-wrap text-zinc-600">{d.reason}</td><td>{d.proposedBy}</td><td>{d.reviewedBy.join(', ')}</td><td>{d.approvedBy ?? '—'}</td><td><Badge>{d.status}</Badge></td><td className="text-zinc-500">{dateTime(d.createdAt)}</td></tr>)}</tbody></table>
      )}</div>
    </div>
  );
}
