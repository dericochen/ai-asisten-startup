'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useData } from '@/lib/api';
import { Badge, PageHeader } from '@/components/ui';

export default function CompanyPage() {
  const { data } = useData<any>('/api/org', { intervalMs: 30_000 });
  const [sel, setSel] = useState<string | null>(null);
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const roles: any[] = data.roles; const emps: any[] = data.employees;
  const children = (key: string | null) => roles.filter((r) => r.reportsTo === key).sort((a, b) => b.authority - a.authority);
  const count = (key: string) => emps.filter((e) => e.roleKey === key).length;
  const working = (key: string) => emps.filter((e) => e.roleKey === key && (e.status === 'WORKING' || e.status === 'REVIEWING')).length;
  const role = roles.find((r) => r.key === sel);

  const Node = ({ r, depth }: { r: any; depth: number }) => (
    <li>
      <button onClick={() => setSel(r.key)} className={`my-0.5 flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-[12.5px] ${sel === r.key ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 bg-white hover:border-zinc-400'}`} style={{ marginLeft: depth * 18 }}>
        <span className="w-8 text-right text-[11px] tabular-nums text-zinc-400">{r.authority}</span>
        <span className="font-medium">{r.title}</span>
        <span className="text-[11px] text-zinc-500">×{count(r.key)}</span>
        {working(r.key) ? <Badge tone="info">{working(r.key)} working</Badge> : null}
      </button>
      {depth < 6 ? <ul>{children(r.key).map((c) => <Node key={c.key} r={c} depth={depth + 1} />)}</ul> : null}
    </li>
  );

  return (
    <div>
      <PageHeader title="Company" sub={`Organization chart · ${emps.length} AI employees in ${data.departments.length} departments · authority shown on the left (Owner = 100)`} />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="panel p-3 xl:col-span-2">
          <div className="mb-1 flex items-center gap-2 rounded border border-zinc-900 bg-zinc-900 px-2 py-1 text-[12.5px] text-white"><span className="w-8 text-right text-[11px]">100</span><span className="font-semibold">Owner / Founder / Chairman</span><span className="text-[11px] text-zinc-300">human · final authority</span></div>
          <ul>{children(null).map((r) => <Node key={r.key} r={r} depth={1} />)}</ul>
        </div>
        <div className="panel h-fit">
          <div className="panel-h">{role ? role.title : 'Select a role'}</div>
          {role ? (
            <div className="px-4 py-3 text-[12.5px]">
              <dl className="grid grid-cols-3 gap-y-1.5">
                <dt className="text-zinc-500">Level</dt><dd className="col-span-2">{role.level} · authority {role.authority}</dd>
                <dt className="text-zinc-500">Department</dt><dd className="col-span-2">{data.departments.find((d: any) => d.key === role.departmentKey)?.name}</dd>
                <dt className="text-zinc-500">Reports to</dt><dd className="col-span-2">{roles.find((r) => r.key === role.reportsTo)?.title ?? 'Owner'}</dd>
                <dt className="text-zinc-500">Kiro agent</dt><dd className="col-span-2 mono">{role.kiroAgent}</dd>
                <dt className="text-zinc-500">Tools</dt><dd className="col-span-2 mono">{role.capabilities.tools.join(', ')}</dd>
                <dt className="text-zinc-500">May write code</dt><dd className="col-span-2">{role.capabilities.canWriteCode ? 'Yes (own worktree only)' : 'No'}</dd>
                <dt className="text-zinc-500">May run shell</dt><dd className="col-span-2">{role.capabilities.canShell ? 'Yes (policy-checked)' : 'No'}</dd>
                <dt className="text-zinc-500">Web access</dt><dd className="col-span-2">{role.capabilities.canWeb ? 'Yes' : 'No'}</dd>
              </dl>
              <p className="mt-3 text-zinc-600">{role.responsibilities}</p>
              <div className="label mt-3 mb-1">Employees</div>
              <ul>{emps.filter((e) => e.roleKey === role.key).map((e) => <li key={e.id} className="flex items-center gap-2 py-0.5"><Link href={`/employees/${e.id}`} className="hover:underline">{e.name}</Link><Badge>{e.status}</Badge></li>)}</ul>
            </div>
          ) : <p className="px-4 py-6 text-zinc-500">Click any role in the chart to inspect it.</p>}
        </div>
      </div>
    </div>
  );
}
