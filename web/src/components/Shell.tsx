'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard, Briefcase, FolderKanban, ListChecks, Building2, Users, Network, CalendarClock, ShieldCheck, Scale, FileText,
  Rocket, Activity, Siren, Cpu, ScrollText, Settings, Search, Bell, LogOut, MonitorPlay,
} from 'lucide-react';
import { api, useData, type LiveEvent, useLiveEvents } from '@/lib/api';

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; group?: string }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/ceo', label: 'CEO Office', icon: Briefcase },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/office', label: 'Live Office', icon: MonitorPlay, group: 'Company' },
  { href: '/company', label: 'Company', icon: Building2 },
  { href: '/employees', label: 'Employees', icon: Users },
  { href: '/departments', label: 'Departments', icon: Network },
  { href: '/meetings', label: 'Meetings', icon: CalendarClock, group: 'Governance' },
  { href: '/approvals', label: 'Approvals', icon: ShieldCheck },
  { href: '/decisions', label: 'Decisions', icon: Scale },
  { href: '/artifacts', label: 'Artifacts', icon: FileText },
  { href: '/deployments', label: 'Deployments', icon: Rocket, group: 'Operations' },
  { href: '/monitoring', label: 'Monitoring', icon: Activity },
  { href: '/incidents', label: 'Incidents', icon: Siren },
  { href: '/runtime', label: 'AI Runtime', icon: Cpu, group: 'System' },
  { href: '/audit', label: 'Audit', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function RuntimeBanner() {
  const { data } = useData<any>('/api/dashboard', { filter: (e) => /KIRO|FALLBACK/.test(e.type), intervalMs: 20_000 });
  if (!data) return null;
  const k = data.kiro; const f = data.fallback;
  if (k.health === 'HEALTHY' && f.running === 0) return null;
  const limited = k.health === 'LIMITED' || k.health === 'UNAVAILABLE';
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-2 text-[12.5px] ${limited ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <strong>KIRO {k.health.replace('_', ' ')}</strong>
      <span>{k.reason}</span>
      {f.running > 0 ? <span>{f.running} task(s) currently running on the fallback provider.</span> : null}
      {limited ? <span>Fallback mode: <strong>{f.mode.replace('_', ' ')}</strong>{f.enabled ? '' : ' (fallback disabled — affected tasks are paused)'}</span> : null}
      <Link href="/runtime" className="ml-auto underline">Manage runtime</Link>
    </div>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => { api(`/api/search?q=${encodeURIComponent(q)}`).then((r) => setResults(r.results)).catch(() => setResults([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const go = (r: any) => {
    setOpen(false); setQ('');
    const href = r.type === 'project' ? `/projects/${r.id}` : r.type === 'task' ? `/tasks/${r.id}` : r.type === 'employee' ? `/employees/${r.id}` : r.type === 'artifact' ? `/artifacts/${r.id}` : r.type === 'incident' ? '/incidents' : r.type === 'decision' ? '/decisions' : '/meetings';
    router.push(href);
  };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-zinc-400" aria-hidden />
      <input aria-label="Search the company" className="input pl-8" placeholder="Search projects, tasks, employees, decisions, artifacts…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && results.length > 0 ? (
        <ul className="panel absolute z-30 mt-1 max-h-96 w-full overflow-auto py-1 shadow-sm" role="listbox">
          {results.map((r) => (
            <li key={`${r.type}-${r.id}`}>
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-50" onMouseDown={() => go(r)}>
                <span className="w-16 text-[10.5px] font-semibold uppercase text-zinc-400">{r.type}</span>
                <span className="truncate">{r.label}</span>
                <span className="ml-auto text-[11px] text-zinc-400">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Notifications() {
  const { data, reload } = useData<any>('/api/notifications', { filter: (e) => e.type === 'NOTIFICATION' });
  const [open, setOpen] = useState(false);
  const unread = (data?.notifications ?? []).filter((n: any) => !n.readAt).length;
  return (
    <div className="relative">
      <button className="btn h-8 px-2" aria-label={`Notifications (${unread} unread)`} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-4 w-4" />{unread ? <span className="rounded bg-red-600 px-1 text-[10px] font-bold text-white">{unread}</span> : null}
      </button>
      {open ? (
        <div className="panel absolute right-0 z-30 mt-1 w-96 shadow-sm">
          <div className="panel-h">Owner notifications<button className="text-[11.5px] font-normal text-accent" onClick={async () => { await api('/api/notifications/read-all', { method: 'POST' }); void reload(); }}>Mark all read</button></div>
          <ul className="max-h-96 overflow-auto">
            {(data?.notifications ?? []).length === 0 ? <li className="px-4 py-6 text-center text-zinc-500">Nothing needs your attention.</li> : null}
            {(data?.notifications ?? []).map((n: any) => (
              <li key={n.id} className={`border-b border-zinc-100 px-4 py-2 ${n.readAt ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2"><span className={`text-[10.5px] font-bold uppercase ${n.severity === 'CRITICAL' ? 'text-red-700' : n.severity === 'WARNING' ? 'text-amber-700' : 'text-zinc-500'}`}>{n.category}</span><span className="ml-auto text-[11px] text-zinc-400">{new Date(n.createdAt).toLocaleString()}</span></div>
                <div className="font-medium">{n.title}</div>
                {n.body ? <div className="line-clamp-2 text-[12px] text-zinc-500">{n.body}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function LiveTicker() {
  const [last, setLast] = useState<LiveEvent | null>(null);
  useLiveEvents((e) => { if (e.type !== 'TASK_PROGRESS') setLast(e); });
  if (!last) return <span className="text-[11.5px] text-zinc-400">Live updates connected</span>;
  return <span className="truncate text-[11.5px] text-zinc-500" aria-live="polite"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-600 align-middle" />{last.message}</span>;
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ displayName: string } | null>(null);
  const [company, setCompany] = useState<string>('');
  useEffect(() => {
    api('/api/setup/status').then((s) => {
      if (s.needsSetup) { router.replace('/setup'); return; }
      api('/api/auth/me').then(setMe).catch(() => router.replace('/login'));
      api('/api/dashboard').then((d) => setCompany(d.company?.name ?? '')).catch(() => undefined);
    }).catch(() => undefined);
  }, [router]);
  if (!me) return <div className="flex h-screen items-center justify-center text-zinc-500">Loading company…</div>;
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-4 py-3">
          <div className="text-[13px] font-semibold leading-tight">{company || 'AI Startup Company'}</div>
          <div className="text-[11px] text-zinc-500">Company OS · Owner console</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Main">
          {NAV.map((n) => (
            <div key={n.href}>
              {n.group ? <div className="label mt-3 mb-1 px-2">{n.group}</div> : null}
              <Link href={n.href} aria-current={active(n.href) ? 'page' : undefined}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-[12.5px] ${active(n.href) ? 'bg-zinc-100 font-semibold text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}`}>
                <n.icon className="h-4 w-4" aria-hidden />{n.label}
              </Link>
            </div>
          ))}
        </nav>
        <div className="border-t border-zinc-200 px-3 py-2 text-[12px]">
          <div className="flex items-center justify-between">
            <span><span className="text-zinc-500">Owner · </span>{me.displayName}</span>
            <button aria-label="Sign out" className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); router.replace('/login'); }}><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-5">
          <SearchBox />
          <div className="min-w-0 flex-1"><LiveTicker /></div>
          <Notifications />
        </header>
        <RuntimeBanner />
        <main className="flex-1 overflow-y-auto px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
