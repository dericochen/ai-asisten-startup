'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Send } from 'lucide-react';
import { api, useData, timeAgo } from '@/lib/api';
import { Markdown } from './Markdown';
import { Badge, ErrorNote } from './ui';

export function CeoChat({ compact = false }: { compact?: boolean }) {
  const { data, reload } = useData<any>('/api/ceo/messages', { filter: (e) => e.type === 'CEO_MESSAGE', intervalMs: 8000 });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messages: any[] = data?.messages ?? [];
  const shown = compact ? messages.slice(-4) : messages;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { await api('/api/ceo/messages', { method: 'POST', body: { content: text } }); setText(''); await reload(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="panel">
      <div className="panel-h">Ask CEO<span className="text-[11.5px] font-normal text-zinc-500">The CEO runs on Kiro and acts only through validated company actions</span></div>
      <div className={`${compact ? 'max-h-80' : 'max-h-[60vh]'} space-y-3 overflow-y-auto px-4 py-3`}>
        {shown.length === 0 ? <p className="text-[12.5px] text-zinc-500">Give the company a goal, e.g. “CEO, build a booking website for barbershops. Research, design, build, test and deploy it — only contact me for major decisions.”</p> : null}
        {shown.map((m) => (
          <div key={m.id} className={m.role === 'OWNER' ? 'ml-10' : 'mr-10'}>
            <div className="mb-0.5 flex items-center gap-2 text-[11px] text-zinc-500"><strong className="text-zinc-700">{m.role === 'OWNER' ? 'You' : 'CEO'}</strong>{timeAgo(m.createdAt)}{m.status !== 'DONE' ? <Badge>{m.status === 'PENDING' ? 'THINKING' : m.status}</Badge> : null}</div>
            <div className={`rounded border px-3 py-2 ${m.role === 'OWNER' ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-200 bg-white'}`}>
              {m.status === 'PENDING' ? <span className="text-zinc-500">The CEO is reviewing company state…</span> : m.role === 'OWNER' ? <p className="whitespace-pre-wrap">{m.content}</p> : <Markdown text={m.content} />}
              {(m.actions ?? []).length ? (
                <div className="mt-2 flex flex-wrap gap-2 border-t border-zinc-100 pt-2">
                  {m.actions.map((a: any, i: number) => (
                    <span key={i} className="text-[11.5px]">
                      <Badge tone={a.ok ? 'good' : 'bad'}>{a.type}</Badge>{' '}
                      {a.projectId ? <Link className="text-accent underline" href={`/projects/${a.projectId}`}>{a.project}</Link> : a.approval ?? a.project ?? ''}
                      {a.error ? <span className="text-red-700"> {a.error}</span> : null}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="border-t border-zinc-200 p-3">
        <ErrorNote error={error} />
        <label htmlFor="ceo-input" className="sr-only">Message to the CEO</label>
        <div className="flex gap-2">
          <textarea id="ceo-input" className="input" rows={2} placeholder="Ask CEO…" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(e as unknown as React.FormEvent); }} />
          <button className="btn btn-primary self-end" disabled={busy || !text.trim()}><Send className="h-4 w-4" />Send</button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">Ctrl+Enter to send</p>
      </form>
    </div>
  );
}
