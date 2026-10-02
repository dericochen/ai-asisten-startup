'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useData, timeAgo } from '@/lib/api';
import { Badge, PageHeader } from '@/components/ui';

export default function EmployeesPage() {
  const { data } = useData<any>('/api/org', { filter: (e) => e.type === 'TASK_ASSIGNED' || e.type === 'TASK_COMPLETED' });
  const [q, setQ] = useState(''); const [dept, setDept] = useState('');
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const roles = new Map<string, any>(data.roles.map((r: any) => [r.key, r]));
  const list = data.employees.filter((e: any) => (!dept || e.departmentKey === dept) && (!q || `${e.name} ${e.code}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <PageHeader title="Employees" sub={`${data.employees.length} AI employees. Each runs as a Kiro custom agent on demand — never continuously.`} />
      <div className="mb-3 flex gap-2">
        <input aria-label="Filter employees" className="input max-w-xs" placeholder="Filter by name or code" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Department" className="input max-w-xs" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{data.departments.map((d: any) => <option key={d.key} value={d.key}>{d.name}</option>)}</select>
      </div>
      <div className="panel overflow-x-auto"><table className="table">
        <thead><tr><th>Code</th><th>Name</th><th>Role</th><th>Authority</th><th>Department</th><th>Status</th><th>Current activity</th><th>Tasks done</th><th>Last active</th></tr></thead>
        <tbody>{list.map((e: any) => <tr key={e.id}><td className="mono text-zinc-500">{e.code}</td><td><Link href={`/employees/${e.id}`} className="font-medium hover:underline">{e.name}</Link></td><td>{roles.get(e.roleKey)?.title}</td><td className="tabular-nums">{roles.get(e.roleKey)?.authority}</td><td>{e.departmentKey}</td><td><Badge>{e.status}</Badge></td><td className="max-w-xs truncate text-zinc-600">{e.currentActivity ?? '—'}</td><td className="tabular-nums">{e.tasksCompleted}</td><td className="text-zinc-500">{timeAgo(e.lastActiveAt)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
