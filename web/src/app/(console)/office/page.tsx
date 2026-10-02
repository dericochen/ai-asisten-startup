'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useData, useLiveEvents } from '@/lib/api';
import { Badge, Empty, PageHeader, Progress } from '@/components/ui';

export default function LiveOffice() {
  const { data } = useData<any>('/api/office', { filter: (e) => ['TASK_ASSIGNED', 'TASK_STARTED', 'TASK_COMPLETED', 'TASK_FAILED', 'TASK_BLOCKED', 'AGENT_TOOL_CALL', 'KIRO_WORKER_ALLOCATED'].includes(e.type), intervalMs: 10_000 });
  const [tails, setTails] = useState<Record<string, string>>({});
  useLiveEvents((e) => { if (e.type === 'AGENT_ACTIVITY' && e.employeeId) setTails((t) => ({ ...t, [e.employeeId!]: String(e.data.tail ?? '') })); });
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const floors = Array.from(new Set(data.departments.map((d: any) => d.floor))) as string[];
  return (
    <div>
      <PageHeader title="Live Office" sub="Who is working on what, right now. Reflects real task assignments and live Kiro activity." />
      {data.employees.length === 0 ? <div className="panel"><Empty>The office is quiet — no employee has an active assignment.</Empty></div> : (
        <div className="space-y-5">
          {floors.map((floor) => {
            const depts = data.departments.filter((d: any) => d.floor === floor).map((d: any) => d.key);
            const emps = data.employees.filter((e: any) => depts.includes(e.departmentKey));
            if (!emps.length) return null;
            return (
              <section key={floor}>
                <h2 className="label mb-2">{floor}</h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {emps.map((e: any) => (
                    <div key={e.id} className="panel p-3">
                      <div className="flex items-center gap-2"><Link href={`/employees/${e.id}`} className="font-medium hover:underline">{e.name}</Link><span className="ml-auto"><Badge>{e.status}</Badge></span></div>
                      <div className="mt-0.5 truncate text-[12px] text-zinc-600">{e.currentActivity ?? '—'}</div>
                      {e.task ? <div className="mt-2"><Link className="text-[11.5px] text-zinc-500 hover:underline" href={`/tasks/${e.task.id}`}>{e.task.code} · {e.task.title}</Link><Progress value={e.task.progress} /></div> : null}
                      {tails[e.id] ? <pre className="mono mt-2 max-h-16 overflow-hidden whitespace-pre-wrap rounded bg-zinc-50 px-2 py-1 text-[10.5px] text-zinc-500">…{tails[e.id].slice(-220)}</pre> : null}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
