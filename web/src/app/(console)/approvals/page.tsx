'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, dateTime, useData } from '@/lib/api';
import { Badge, Empty, ErrorNote, PageHeader } from '@/components/ui';

function ApprovalCard({ a, reload }: { a: any; reload: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: string) => {
    if (decision !== 'APPROVED' && !note.trim()) { setError('Please add a note explaining the rejection or the revision you want.'); return; }
    setBusy(true); setError(null);
    try { await api(`/api/approvals/${a.id}/decide`, { method: 'POST', body: { decision, note } }); reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const rows: [string, string][] = [['Reason', a.reason], ['Impact', a.impact], ['Risks', a.risks], ['Alternatives', a.alternatives], ['Cost', a.cost], ['Recommendation', a.recommendation]];
  return (
    <div className="panel">
      <div className="panel-h">
        <span><span className="mono mr-2 text-zinc-500">{a.code}</span>{a.title}</span>
        <span className="flex items-center gap-2"><Badge tone="neutral">{a.gate.replace(/_/g, ' ')}</Badge><Badge>{a.status}</Badge></span>
      </div>
      <div className="grid gap-4 px-4 py-3 md:grid-cols-3">
        <dl className="space-y-1.5 text-[12.5px] md:col-span-2">
          <div className="flex gap-2"><dt className="w-28 text-zinc-500">Project</dt><dd>{a.project ? <Link href={`/projects/${a.projectId}`} className="hover:underline">{a.project.code} {a.project.name}</Link> : 'Company'}</dd></div>
          <div className="flex gap-2"><dt className="w-28 text-zinc-500">Requested by</dt><dd>{a.requestedBy} · {dateTime(a.createdAt)}</dd></div>
          <div className="flex gap-2"><dt className="w-28 text-zinc-500">Approver</dt><dd>{a.approverRole === 'OWNER' ? 'Owner (you)' : a.approverRole.toUpperCase()} · authority ≥ {a.requiredAuthority}</dd></div>
          {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-zinc-500">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>)}
          {a.status !== 'PENDING' ? <div className="flex gap-2"><dt className="w-28 text-zinc-500">Decision</dt><dd>{a.status} by {a.decidedByName} (authority {a.decidedByAuthority}) · {dateTime(a.decidedAt)}{a.decisionNote ? <div className="mt-1 whitespace-pre-wrap text-zinc-600">{a.decisionNote}</div> : null}</dd></div> : null}
        </dl>
        <div>
          <div className="label mb-1">Evidence</div>
          {a.evidence.length === 0 ? <p className="text-[12px] text-zinc-500">—</p> : <ul className="space-y-1 text-[12.5px]">{a.evidence.map((e: any, i: number) => <li key={i}>{e.kind === 'artifact' ? <Link className="text-accent underline" href={`/artifacts/${e.ref}`}>{e.label}</Link> : e.kind === 'url' && e.ref ? <a className="text-accent underline" href={e.ref} target="_blank" rel="noreferrer">{e.label}</a> : <span>{e.label}{e.ref ? `: ${e.ref}` : ''}</span>}</li>)}</ul>}
        </div>
      </div>
      {a.status === 'PENDING' ? (
        <div className="border-t border-zinc-200 px-4 py-3">
          <ErrorNote error={error} />
          {a.approverRole !== 'OWNER' ? <p className="mb-2 text-[12px] text-zinc-500">This gate is assigned to the {a.approverRole.toUpperCase()}, who is reviewing it now. As Owner you may decide it yourself.</p> : null}
          <label className="sr-only" htmlFor={`n-${a.id}`}>Decision note</label>
          <textarea id={`n-${a.id}`} className="input mb-2" rows={2} placeholder="Note / guidance (required to reject or request revision)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => decide('APPROVED')}>Approve</button>
            <button className="btn" disabled={busy} onClick={() => decide('REVISION_REQUESTED')}>Request revision</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => decide('REJECTED')}>Reject</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ApprovalsPage() {
  const [view, setView] = useState<'PENDING' | ''>('PENDING');
  const { data, reload } = useData<any>(`/api/approvals${view ? `?status=${view}` : ''}`, { filter: (e) => /APPROVAL/.test(e.type) });
  const list = data?.approvals ?? [];
  const mine = list.filter((a: any) => a.approverRole === 'OWNER');
  const others = list.filter((a: any) => a.approverRole !== 'OWNER');
  return (
    <div>
      <PageHeader title="Approval Center" sub="Mandatory gates. Every decision is verified against authority and recorded in the audit log." actions={<><button className={`btn ${view === 'PENDING' ? 'btn-primary' : ''}`} onClick={() => setView('PENDING')}>Pending</button><button className={`btn ${view === '' ? 'btn-primary' : ''}`} onClick={() => setView('')}>History</button></>} />
      {!data ? <Empty>Loading…</Empty> : list.length === 0 ? <div className="panel"><Empty>Nothing awaiting a decision.</Empty></div> : (
        <div className="space-y-4">
          {mine.length ? <><h2 className="label">Requires the Owner</h2>{mine.map((a: any) => <ApprovalCard key={a.id} a={a} reload={reload} />)}</> : null}
          {others.length ? <><h2 className="label mt-4">Executive gates (CEO / CTO)</h2>{others.map((a: any) => <ApprovalCard key={a.id} a={a} reload={reload} />)}</> : null}
        </div>
      )}
    </div>
  );
}
