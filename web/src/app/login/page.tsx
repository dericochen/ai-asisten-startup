'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/api/auth/login', { method: 'POST', body: { username, password } }); router.replace('/'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <h1 className="text-[17px] font-semibold">Owner sign in</h1>
        <p className="mb-4 text-[12.5px] text-zinc-500">AI Startup Company OS</p>
        <ErrorNote error={error} />
        <label className="label" htmlFor="u">Username</label>
        <input id="u" className="input mb-3 mt-1" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <label className="label" htmlFor="p">Password</label>
        <input id="p" type="password" className="input mb-4 mt-1" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
