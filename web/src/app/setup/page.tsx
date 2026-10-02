'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/ui';

const STEPS = ['Company', 'Owner account', 'Kiro CLI', 'Policies', 'Launch'];

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kiro, setKiro] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [f, setF] = useState({ companyName: '', mission: 'We research, design, build, test and operate software products.', ownerName: '', username: '', password: '', confirm: '', deploymentMode: 'OWNER_APPROVAL', fallbackMode: 'ASK_OWNER' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api('/api/setup/status').then((s) => { if (!s.needsSetup) router.replace('/login'); setKiro(s.kiro); }).catch(() => undefined); }, [router]);

  const detect = async () => { setBusy(true); try { setKiro((await api('/api/setup/detect-kiro', { method: 'POST' })).detection); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  useEffect(() => { if (step === 2) void detect(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = [
    f.companyName.trim().length >= 2,
    f.ownerName.trim() && /^[a-zA-Z0-9_.-]{3,40}$/.test(f.username) && f.password.length >= 10 && f.password === f.confirm,
    true, true, true,
  ];

  const launch = async () => {
    setBusy(true); setError(null);
    try { setResult(await api('/api/setup', { method: 'POST', body: f })); setStep(4); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-[20px] font-semibold">Welcome to AI Startup Company OS</h1>
      <p className="mb-5 text-[12.5px] text-zinc-500">Set up your company. You are the Owner — final human authority over every AI employee.</p>
      <ol className="mb-5 flex gap-2 text-[12px]">{STEPS.map((s, i) => <li key={s} className={`flex-1 rounded border px-2 py-1 ${i === step ? 'border-zinc-900 font-semibold' : i < step ? 'border-green-300 text-green-800' : 'border-zinc-200 text-zinc-400'}`}>{i + 1}. {s}</li>)}</ol>
      <div className="panel p-5">
        <ErrorNote error={error} />
        {step === 0 && (<>
          <label className="label" htmlFor="cn">Company name</label>
          <input id="cn" className="input mb-3 mt-1" value={f.companyName} onChange={set('companyName')} placeholder="Northwind Software" />
          <label className="label" htmlFor="mi">Mission</label>
          <textarea id="mi" className="input mt-1" rows={2} value={f.mission} onChange={set('mission')} />
        </>)}
        {step === 1 && (<>
          <label className="label" htmlFor="on">Your name</label>
          <input id="on" className="input mb-3 mt-1" value={f.ownerName} onChange={set('ownerName')} />
          <label className="label" htmlFor="un">Username</label>
          <input id="un" className="input mb-3 mt-1" value={f.username} onChange={set('username')} autoComplete="username" />
          <label className="label" htmlFor="pw">Password (min. 10 characters)</label>
          <input id="pw" type="password" className="input mb-3 mt-1" value={f.password} onChange={set('password')} autoComplete="new-password" />
          <label className="label" htmlFor="pc">Confirm password</label>
          <input id="pc" type="password" className="input mt-1" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
          {f.confirm && f.password !== f.confirm ? <p className="mt-1 text-[12px] text-red-700">Passwords do not match.</p> : null}
        </>)}
        {step === 2 && (<div>
          <p className="mb-3 text-[12.5px] text-zinc-600">Kiro CLI is the primary intelligence of the company. Every employee runs as a Kiro custom agent through <span className="mono">kiro-cli acp</span>.</p>
          {[['Kiro CLI installed', kiro?.installed, kiro?.version ? `v${kiro.version}` : kiro?.error], ['Kiro authenticated', kiro?.authenticated, kiro?.authMethod ?? kiro?.error]].map(([l, ok, d]) => (
            <div key={String(l)} className="flex items-center gap-2 border-b border-zinc-100 py-2">{ok ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <XCircle className="h-4 w-4 text-red-700" />}<span className="font-medium">{l}</span><span className="ml-auto text-zinc-500">{d ?? '—'}</span></div>
          ))}
          {!kiro?.authenticated ? <p className="mt-3 text-[12.5px] text-amber-800">Run <span className="mono">kiro-cli login</span> in a terminal, then re-check. You can continue without Kiro, but work pauses until it is available (or fallback is configured).</p> : null}
          <button className="btn mt-3" onClick={detect} disabled={busy}>{busy ? 'Checking…' : 'Re-check'}</button>
          <p className="mt-4 text-[12.5px] text-zinc-600">On launch the initial organization (10 departments, 80+ roles, 110+ employees) is installed, and each role gets an isolated Kiro agent profile.</p>
        </div>)}
        {step === 3 && (<>
          <label className="label" htmlFor="dm">Production deployment policy</label>
          <select id="dm" className="input mb-1 mt-1" value={f.deploymentMode} onChange={set('deploymentMode')}>
            <option value="OWNER_APPROVAL">Owner approval (recommended)</option><option value="CEO_APPROVAL">CEO approval</option><option value="AUTO_AFTER_CHECKS">Automatic after all checks</option><option value="MANUAL">Manual</option>
          </select>
          <p className="mb-3 text-[12px] text-zinc-500">Production is always gated by code review, QA, security, staging validation and release review.</p>
          <label className="label" htmlFor="fm">Fallback AI policy (when Kiro cannot continue)</label>
          <select id="fm" className="input mb-1 mt-1" value={f.fallbackMode} onChange={set('fallbackMode')}>
            <option value="ASK_OWNER">Ask Owner (recommended)</option><option value="AUTO">Automatic</option><option value="DISABLED">Disabled — pause until Kiro is back</option>
          </select>
          <p className="text-[12px] text-zinc-500">Fallback providers (OpenRouter, OpenAI, Anthropic, Gemini, Ollama…) are optional and configured later in AI Runtime. Deployment integrations can also be added later per project.</p>
        </>)}
        {step === 4 && result && (<div>
          <p className="mb-2 font-semibold text-green-800">Company launched.</p>
          <ul className="mb-4 list-disc pl-5 text-[12.5px]"><li>{result.org.departments} departments, {result.org.roles} roles, {result.org.employees} employees installed</li><li>{result.profiles.written} Kiro agent profiles written to the isolated Kiro home</li></ul>
          <button className="btn btn-primary" onClick={() => router.replace('/')}>Open the company</button>
        </div>)}
        {step < 4 ? (
          <div className="mt-5 flex justify-between">
            <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
            {step < 3 ? <button className="btn btn-primary" disabled={!valid[step]} onClick={() => setStep(step + 1)}>Continue</button>
              : <button className="btn btn-primary" disabled={busy} onClick={launch}>{busy ? 'Installing organization…' : 'Launch company'}</button>}
          </div>
        ) : null}
      </div>
    </main>
  );
}
