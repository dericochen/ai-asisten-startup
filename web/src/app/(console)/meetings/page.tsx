'use client';
import { dateTime, useData } from '@/lib/api';
import { Badge, Empty, PageHeader } from '@/components/ui';

export default function MeetingsPage() {
  const { data } = useData<any>('/api/meetings', { filter: (e) => e.type === 'MEETING_HELD' });
  const list = data?.meetings ?? [];
  return (
    <div>
      <PageHeader title="Meetings" sub="Structured review meetings: participants, positions, objections, decisions and action items." />
      {list.length === 0 ? <div className="panel"><Empty>No meetings held yet.</Empty></div> : <div className="space-y-3">{list.map((m: any) => (
        <div key={m.id} className="panel">
          <div className="panel-h"><span>{m.title}</span><span className="flex items-center gap-2"><Badge tone="neutral">{m.type}</Badge><span className="text-[11.5px] font-normal text-zinc-500">{dateTime(m.createdAt)}</span></span></div>
          <div className="grid gap-3 px-4 py-3 text-[12.5px] md:grid-cols-2">
            <div><div className="label mb-1">Agenda</div><ul className="ml-4 list-disc">{m.agenda.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul><div className="label mb-1 mt-2">Participants</div><p>{m.participants.join(', ')}</p></div>
            <div><div className="label mb-1">Decision</div><p className="font-medium">{m.decision}</p>{m.objections.length ? <><div className="label mb-1 mt-2">Objections</div><ul className="ml-4 list-disc">{m.objections.map((o: string, i: number) => <li key={i}>{o}</li>)}</ul></> : null}{m.actionItems.length ? <><div className="label mb-1 mt-2">Action items</div><ul className="ml-4 list-disc">{m.actionItems.map((o: string, i: number) => <li key={i}>{o}</li>)}</ul></> : null}</div>
            {m.positions.length ? <div className="md:col-span-2"><div className="label mb-1">Positions</div>{m.positions.map((p: any, i: number) => <p key={i} className="mb-1"><strong>{p.who}:</strong> <span className="text-zinc-600">{p.position}</span></p>)}</div> : null}
          </div>
        </div>))}</div>}
    </div>
  );
}
