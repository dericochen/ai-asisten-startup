'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** All requests go to same-origin /api (proxied to the control plane). Mutations carry the CSRF header. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-aco-csrf': '1' },
    body: opts.body === undefined ? (opts.method && opts.method !== 'GET' ? '{}' : undefined) : JSON.stringify(opts.body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/setup')) location.href = '/login';
    throw new ApiError(res.status, data.error ? `${data.error}${data.issues ? `: ${data.issues.join('; ')}` : ''}` : `HTTP ${res.status}`);
  }
  return data as T;
}

export interface LiveEvent { id: number; type: string; projectId: string | null; taskId: string | null; employeeId: string | null; message: string; data: Record<string, unknown>; createdAt: string }

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensureSource() {
  if (source || typeof window === 'undefined') return;
  source = new EventSource('/api/stream');
  source.onmessage = (m) => { try { const e = JSON.parse(m.data) as LiveEvent; listeners.forEach((l) => l(e)); } catch { /* ignore */ } };
  source.onerror = () => { /* EventSource reconnects automatically */ };
}

export function useLiveEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ensureSource();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

/**
 * Fetches data, refreshes on matching live events (debounced) and on an interval fallback.
 * `filter` decides which events trigger a reload.
 */
export function useData<T = any>(path: string | null, opts: { filter?: (e: LiveEvent) => boolean; intervalMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => void load(), opts.intervalMs ?? 15_000);
    return () => clearInterval(t);
  }, [load, opts.intervalMs]);
  useLiveEvents((e) => {
    if (e.type === 'AGENT_ACTIVITY' && !opts.filter) return;
    if (opts.filter && !opts.filter(e)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 600);
  });
  return { data, error, loading, reload: load, setData };
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function duration(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
