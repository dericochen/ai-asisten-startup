'use client';
import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api, useData } from '@/lib/api';
import { ErrorNote, PageHeader } from '@/components/ui';

export default function SettingsPage() {
  const { data, reload } = useData<any>('/api/policies');
  const { data: health } = useData<any>('/api/system/health', { intervalMs: 20_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const p = data.policies;
  const save = async (patch: any) => { setErr(null); try { await api('/api/policies', { method: 'PUT', body: patch }); setMsg('Saved'); setTimeout(() => setMsg(null), 1500); reload(); } catch (e) { setErr((e as Error).message); } };
  const num = (label: string, value: number, patch: (v: number) => any, min = 1, max = 5) => (
    <label className="text-[12.5px]">{label}<input type="number" min={min} max={max} className="input mt-1" defaultValue={value} onBlur={(e) => save(patch(Number(e.target.value)))} /></label>
  );
  return (
    <div>
      <PageHeader title="Settings" sub="Owner policies. Agents cannot change these; every change is audited." actions={msg ? <span className="text-[12px] text-green-700">{msg}</span> : null} />
      <ErrorNote error={err} />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="panel"><div className="panel-h">Stage gate approvals</div>
          <div className="px-4 py-3">
            <select aria-label="Gate approver" className="input" value={p.gateApprover ?? 'OWNER'} onChange={(e) => save({ gateApprover: e.target.value })}>
              <option value="OWNER">OWNER — I approve research, product, design, architecture and release myself</option>
              <option value="EXECUTIVES">EXECUTIVES — CEO/CTO agents decide; I only get escalations</option>
            </select>
            <p className="mt-2 text-[12px] text-zinc-500">With OWNER, no CEO/CTO review runs; every gate waits in the Approval Center. Approving a release also authorises production when the deployment policy is OWNER APPROVAL.</p>
          </div>
        </div>
        <div className="panel"><div className="panel-h">Deployment policy</div>
          <div className="px-4 py-3">
            <select aria-label="Deployment mode" className="input" value={p.deploymentMode} onChange={(e) => save({ deploymentMode: e.target.value })}>
              <option value="OWNER_APPROVAL">OWNER APPROVAL — you approve each production release (default)</option>
              <option value="CEO_APPROVAL">CEO APPROVAL — CEO release approval is sufficient</option>
              <option value="AUTO_AFTER_CHECKS">AUTO AFTER ALL CHECKS — for personal low-risk projects</option>
              <option value="MANUAL">MANUAL — you trigger production explicitly</option>
            </select>
            <p className="mt-2 text-[12px] text-zinc-500">Regardless of mode, production requires code review, QA, security, staging validation, release board GO and CEO approval. Health is verified after every deploy, with rollback on failure.</p>
          </div>
        </div>
        <div className="panel"><div className="panel-h">Loop limits (no infinite AI loops)</div>
          <div className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-3">
            {num('Max research rounds', p.limits.maxResearchRounds, (v) => ({ limits: { maxResearchRounds: v } }))}
            {num('Max review rounds', p.limits.maxReviewRounds, (v) => ({ limits: { maxReviewRounds: v } }))}
            {num('Max agent retries', p.limits.maxAgentRetries, (v) => ({ limits: { maxAgentRetries: v } }), 0)}
            {num('Max task revisions', p.limits.maxTaskRevisions, (v) => ({ limits: { maxTaskRevisions: v } }), 0)}
            {num('Max fix attempts', p.limits.maxFixAttempts, (v) => ({ limits: { maxFixAttempts: v } }))}
            {num('Parallel researchers', p.research.researcherCount, (v) => ({ research: { researcherCount: v } }))}
          </div>
          <p className="px-4 pb-3 text-[12px] text-zinc-500">When a limit is reached the issue escalates (lead → CTO → Owner) instead of looping.</p>
        </div>
        <div className="panel"><div className="panel-h">Monitoring</div>
          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            {num('Probe interval (seconds)', Math.round(p.monitoring.intervalMs / 1000), (v) => ({ monitoring: { intervalMs: v * 1000 } }), 5, 3600)}
            {num('Healthy probes before completion', p.monitoring.samplesBeforeComplete, (v) => ({ monitoring: { samplesBeforeComplete: v } }), 1, 100)}
          </div>
        </div>
        <div className="panel"><div className="panel-h">System health</div>
          <ul className="px-4 py-2">{(health?.checks ?? []).map((c: any) => <li key={c.key} className="flex items-center gap-2 border-b border-zinc-100 py-1.5 text-[12.5px]">{c.ok ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <XCircle className="h-4 w-4 text-red-700" />}<span className="w-40 font-medium">{c.label}</span><span className="text-zinc-500">{c.detail}</span></li>)}</ul>
        </div>
      </div>
    </div>
  );
}
