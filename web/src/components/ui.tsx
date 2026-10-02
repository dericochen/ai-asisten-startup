import type { ReactNode } from 'react';

const TONE: Record<string, string> = {
  good: 'bg-green-50 text-green-800 border-green-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  neutral: 'bg-zinc-100 text-zinc-700 border-zinc-200',
};

export function toneFor(status: string | null | undefined): keyof typeof TONE {
  const s = String(status ?? '').toUpperCase();
  if (/^(DONE|PASS|APPROVED|HEALTHY|COMPLETED|SUCCEEDED|ACTIVE|CONNECTED|RUNNING|GOOD|GO|RESOLVED|STAGING_PASSED|ALLOWED)$/.test(s)) return 'good';
  if (/^(FAIL|FAILED|REJECTED|BLOCKED|UNHEALTHY|UNAVAILABLE|LIMITED|BAD|CRITICAL|SEV1|SEV2|DENIED|DEGRADED|ROLLED_BACK|ERROR|CANCELLED|NO_GO|STAGING_FAILED|OPEN)$/.test(s)) return 'bad';
  if (/^(PENDING|WAITING|REVISION_REQUESTED|NEAR_LIMIT|WARN|WARNING|PAUSED|QUEUED|REVIEW|QA|MITIGATING|AWAITING_FALLBACK_APPROVAL|SEV3|STANDBY|CANDIDATE|DEPLOYING|BUILDING|STAGING)$/.test(s)) return 'warn';
  if (/^(WORKING|REVIEWING|READY|IN_PROGRESS|INFO)$/.test(s)) return 'info';
  return 'neutral';
}

export function Badge({ children, tone, title }: { children: ReactNode; tone?: keyof typeof TONE; title?: string }) {
  const t = tone ?? toneFor(typeof children === 'string' ? children : '');
  return <span title={title} className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${TONE[t]}`}>{typeof children === 'string' ? children.replace(/_/g, ' ') : children}</span>;
}

export function Progress({ value, tone = 'accent', label }: { value: number; tone?: 'accent' | 'good' | 'muted'; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = tone === 'good' || v === 100 ? 'bg-green-600' : tone === 'muted' ? 'bg-zinc-300' : 'bg-blue-600';
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progress'}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200"><div className={`h-full ${color}`} style={{ width: `${v}%` }} /></div>
      <span className="w-9 text-right text-[11.5px] tabular-nums text-zinc-600">{v}%</span>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-zinc-900';
  return (
    <div className="panel px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold tabular-nums leading-tight ${color}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11.5px] text-zinc-500">{sub}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-[12.5px] text-zinc-500">{children}</div>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
        {sub ? <p className="mt-0.5 text-[12.5px] text-zinc-500">{sub}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div role="alert" className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">{error}</div>;
}
