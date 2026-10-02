'use client';
import { useState } from 'react';
import { api, dateTime, useData } from '@/lib/api';
import { Badge, Empty, ErrorNote, PageHeader } from '@/components/ui';

function Resolve({ id, reload }: { id: string; reload: () => void }) {
  const [note, setNote] = useState(''); const [pm, setPm] = useState(''); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-t border-zinc-200 px-4 py-3">
      <ErrorNote error={err} />
      <input aria-label="Resolution note" className="input mb-2" placeholder="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} />
      <textarea aria-label="Postmortem" className="input mb-2" rows={3} placeholder="Postmortem (optional, saved as an artifact)" value={pm} onChange={(e) => setPm(e.target.value)} />
      <button className="btn" onClick={async () => { try { await api(`/api/incidents/${id}/resolve`, { method: 'POST', body: { note, postmortem: pm || undefined } }); reload(); } catch (e) { setErr((e as Error).message); } }}>Resolve incident</button>
    </div>
  );
}

export default function IncidentsPage() {
  const { data, reload } = useData<any>('/api/incidents', { filter: (e) => e.type.startsWith('INCIDENT') });
  const list = data?.incidents ?? [];
  return (
    <div>
      <PageHeader title="Incidents" sub="Opened automatically by production validation and monitoring. Production fixes always go through the full release gates." />
      {list.length === 0 ? <div className="panel"><Empty>No incidents. Production is quiet.</Empty></div> : <div className="space-y-3">{list.map((i: any) => (
        <div key={i.id} className="panel">
          <div className="panel-h"><span><span className="mono mr-2 text-zinc-500">{i.code}</span>{i.title}</span><span className="flex gap-2"><Badge>{i.severity}</Badge><Badge>{i.status}</Badge></span></div>
          <div className="px-4 py-3 text-[12.5px]"><p className="whitespace-pre-wrap text-zinc-700">{i.description}</p>
            <ol className="mt-2 border-l border-zinc-200 pl-3">{i.timeline.map((t: any, k: number) => <li key={k} className="text-[12px]"><span className="text-zinc-400">{dateTime(t.at)}</span> {t.note}</li>)}</ol>
            {i.postmortem ? <><div className="label mt-3">Postmortem</div><p className="whitespace-pre-wrap">{i.postmortem}</p></> : null}
          </div>
          {i.status !== 'RESOLVED' ? <Resolve id={i.id} reload={reload} /> : null}
        </div>))}</div>}
    </div>
  );
}
