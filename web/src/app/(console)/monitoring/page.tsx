'use client';
import Link from 'next/link';
import { dateTime, useData } from '@/lib/api';
import { Empty, PageHeader } from '@/components/ui';

export default function MonitoringPage() {
  const { data } = useData<any>('/api/monitoring', { intervalMs: 10_000 });
  const list = (data?.projects ?? []).filter((p: any) => p.samples.length);
  return (
    <div>
      <PageHeader title="Monitoring" sub="Real HTTP health probes against every active production deployment." />
      {list.length === 0 ? <div className="panel"><Empty>No production deployments are being monitored yet.</Empty></div> : <div className="space-y-3">{list.map((p: any) => {
        const ok = p.samples.filter((s: any) => s.ok).length; const last = p.samples[0];
        return (
          <div key={p.id} className="panel">
            <div className="panel-h"><Link href={`/projects/${p.id}`} className="hover:underline">{p.code} {p.name}</Link><span className="font-normal text-zinc-500">{ok}/{p.samples.length} healthy · last {last.ok ? `HTTP ${last.httpStatus} in ${last.latencyMs}ms` : last.error ?? `HTTP ${last.httpStatus}`} · {dateTime(last.createdAt)}</span></div>
            <div className="flex gap-0.5 px-4 py-3">{p.samples.slice().reverse().map((s: any) => <span key={s.id} title={`${dateTime(s.createdAt)} ${s.ok ? `${s.latencyMs}ms` : s.error ?? s.httpStatus}`} className={`h-6 w-2 rounded-sm ${s.ok ? 'bg-green-600' : 'bg-red-600'}`} />)}</div>
            {p.productionUrl ? <div className="border-t border-zinc-200 px-4 py-2 text-[12px]"><a className="text-accent underline" href={p.productionUrl} target="_blank" rel="noreferrer">{p.productionUrl}</a></div> : null}
          </div>
        );
      })}</div>}
    </div>
  );
}
