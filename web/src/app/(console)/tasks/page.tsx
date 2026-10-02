'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useData, timeAgo } from '@/lib/api';
import { Badge, Empty, PageHeader, Progress } from '@/components/ui';

const FILTERS = { 'Active': 'READY,WORKING,REVIEW,QA', Blocked: 'BLOCKED,FAILED', Done: 'DONE', All: '' };

export default function TasksPage() {
  const [f, setF] = useState<keyof typeof FILTERS>('Active');
  const { data } = useData<any>(`/api/tasks${FILTERS[f] ? `?status=${FILTERS[f]}` : ''}`, { filter: (e) => e.type.startsWith('TASK_') });
  return (
    <div>
      <PageHeader title="Tasks" sub="All work across the company. Tasks are created by the workflow engine and executed by Kiro agents." />
      <div className="mb-3 flex gap-1">{(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((k) => <button key={k} className={`btn h-7 ${f === k ? 'btn-primary' : ''}`} onClick={() => setF(k)}>{k}</button>)}</div>
      <div className="panel overflow-x-auto">
        {!data ? <Empty>Loading…</Empty> : data.tasks.length === 0 ? <Empty>No tasks.</Empty> : (
          <table className="table">
            <thead><tr><th>Task</th><th>Project</th><th>Employee</th><th>Department</th><th>Status</th><th className="w-36">Progress</th><th>Runtime</th><th>Updated</th></tr></thead>
            <tbody>{data.tasks.map((t: any) => (
              <tr key={t.id}><td><Link className="font-medium hover:underline" href={`/tasks/${t.id}`}>{t.code} {t.title}</Link>{t.blockedReason ? <div className="line-clamp-1 text-[11px] text-red-700">{t.blockedReason}</div> : null}</td><td>{t.projectCode ? <Link href={`/projects/${t.projectId}`} className="hover:underline">{t.projectCode}</Link> : '—'}</td><td>{t.assignee?.name ?? '—'}</td><td>{t.departmentKey}</td><td><Badge>{t.status}</Badge></td><td><Progress value={t.status === 'DONE' ? 100 : t.progress} /></td><td>{t.runtime ?? '—'}</td><td className="text-zinc-500">{timeAgo(t.updatedAt)}</td></tr>))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
