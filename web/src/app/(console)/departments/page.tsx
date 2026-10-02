'use client';
import { useData } from '@/lib/api';
import { PageHeader } from '@/components/ui';

export default function DepartmentsPage() {
  const { data } = useData<any>('/api/departments', { filter: (e) => e.type === 'TASK_STARTED' || e.type === 'TASK_COMPLETED' });
  return (
    <div>
      <PageHeader title="Departments" sub="Headcount and live utilisation per department." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data?.departments ?? []).map((d: any) => (
          <div key={d.key} className="panel p-4">
            <div className="flex items-baseline justify-between"><h2 className="text-[14px] font-semibold">{d.name}</h2><span className="text-[11.5px] text-zinc-500">{d.floor}</span></div>
            <p className="mt-1 text-[12.5px] text-zinc-600">{d.description}</p>
            <div className="mt-3 flex gap-6 text-[12.5px]"><div><div className="label">Headcount</div><div className="text-[18px] font-semibold">{d.headcount}</div></div><div><div className="label">Working now</div><div className="text-[18px] font-semibold">{d.working}</div></div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
