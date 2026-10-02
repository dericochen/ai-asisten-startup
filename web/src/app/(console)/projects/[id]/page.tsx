'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useData } from '@/lib/api';
import { Badge, PageHeader, Progress } from '@/components/ui';
import { Checks, Costs, Deployments, Docs, Git, Monitoring, Overview, ProjectControls, Records, TaskBoard, Timeline } from '@/components/project-tabs';

const TABS = ['Overview', 'Timeline', 'Research', 'Product', 'Design', 'Architecture', 'Engineering', 'Tasks', 'QA', 'Security', 'Deployments', 'Monitoring', 'Meetings & Decisions', 'Artifacts', 'Costs'] as const;

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, error, reload } = useData<any>(`/api/projects/${id}`, { filter: (e) => e.projectId === id && e.type !== 'AGENT_ACTIVITY' });
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  if (error) return <p className="text-red-700">{error}</p>;
  if (!d) return <p className="text-zinc-500">Loading…</p>;
  const p = d.project;
  return (
    <div>
      <div className="mb-1 text-[12px] text-zinc-500"><Link href="/projects" className="hover:underline">Projects</Link> / {p.code}</div>
      <PageHeader title={p.name} sub={p.objective} actions={<ProjectControls p={p} reload={reload} />} />
      <div className="panel mb-4 grid grid-cols-2 gap-4 px-4 py-3 md:grid-cols-5">
        <div><div className="label">Overall</div><div className="mt-1 w-40"><Progress value={d.progress.overall} /></div></div>
        <div><div className="label">Current phase</div><div className="mt-1 font-semibold">{p.phase.replace(/_/g, ' ')}</div></div>
        <div><div className="label">Status</div><div className="mt-1"><Badge>{p.status}</Badge></div></div>
        <div><div className="label">Priority</div><div className="mt-1">{p.priority}</div></div>
        <div><div className="label">Working now</div><div className="mt-1">{d.working.length} employee(s)</div></div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-1.5 text-[12.5px] ${tab === t ? 'border-zinc-900 font-semibold' : 'border-transparent text-zinc-500 hover:text-zinc-900'}`}>{t}</button>)}
      </div>
      {tab === 'Overview' && <Overview d={d} />}
      {tab === 'Timeline' && <Timeline id={id} />}
      {tab === 'Research' && <Docs id={id} kinds={['RESEARCH_REPORT', 'RESEARCH_BRIEF', 'RESEARCH_FINDINGS', 'RESEARCH_CRITIQUE', 'EXECUTIVE_REVIEW']} />}
      {tab === 'Product' && <Docs id={id} kinds={['PRD', 'PRODUCT_REVIEW']} />}
      {tab === 'Design' && <Docs id={id} kinds={['DESIGN_DOC', 'DESIGN_REVIEW']} />}
      {tab === 'Architecture' && <Docs id={id} kinds={['ARCHITECTURE_DOC', 'ARCHITECTURE_REVIEW', 'ADR']} />}
      {tab === 'Engineering' && <div className="space-y-4"><Git id={id} /><Checks id={id} suites={['INTEGRATION', 'CODE_REVIEW']} /><Docs id={id} kinds={['ENGINEERING_REPORT', 'CODE_REVIEW']} /></div>}
      {tab === 'Tasks' && <TaskBoard id={id} />}
      {tab === 'QA' && <div className="space-y-4"><Checks id={id} suites={['QA_AUTOMATED', 'QA', 'PERFORMANCE']} /><Docs id={id} kinds={['QA_REPORT']} /></div>}
      {tab === 'Security' && <div className="space-y-4"><Checks id={id} suites={['SECURITY_AUTOMATED', 'SECURITY']} /><Docs id={id} kinds={['SECURITY_REPORT']} /></div>}
      {tab === 'Deployments' && <div className="space-y-4"><Deployments id={id} /><Checks id={id} suites={['STAGING', 'PRODUCTION']} /></div>}
      {tab === 'Monitoring' && <Monitoring id={id} />}
      {tab === 'Meetings & Decisions' && <Records id={id} />}
      {tab === 'Artifacts' && <Docs id={id} kinds={['RESEARCH_BRIEF', 'RESEARCH_FINDINGS', 'RESEARCH_CRITIQUE', 'RESEARCH_REPORT', 'PRD', 'PRODUCT_REVIEW', 'DESIGN_DOC', 'DESIGN_REVIEW', 'ARCHITECTURE_DOC', 'ARCHITECTURE_REVIEW', 'ADR', 'ENGINEERING_REPORT', 'CODE_REVIEW', 'QA_REPORT', 'SECURITY_REPORT', 'RELEASE_NOTES', 'RELEASE_REPORT', 'COMPLETION_REPORT', 'POSTMORTEM', 'EXECUTIVE_REVIEW']} />}
      {tab === 'Costs' && <Costs id={id} />}
    </div>
  );
}
