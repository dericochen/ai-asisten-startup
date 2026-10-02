// API smoke test against a running (isolated) server. Usage: node scripts/smoke-api.mjs [baseUrl]
const base = process.argv[2] ?? 'http://127.0.0.1:4199';
let cookie = '';
let failures = 0;

async function call(method, path, body, { csrf = true, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (csrf) headers['x-aco-csrf'] = '1';
  if (auth && cookie) headers.cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json, headers: res.headers };
}

function check(label, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const st = await call('GET', '/api/setup/status', null, { auth: false });
check('setup status reachable', st.status === 200, JSON.stringify(st.json?.needsSetup));

if (st.json?.needsSetup) {
  const bad = await call('POST', '/api/setup', { companyName: 'X', ownerName: 'O', username: 'o', password: 'short' }, { auth: false });
  check('setup rejects weak input', bad.status === 400);
  const ok = await call('POST', '/api/setup', { companyName: 'Smoke Test Labs', mission: 'test', ownerName: 'Test Owner', username: 'owner', password: 'correct-horse-battery' }, { auth: false });
  check('setup creates company + org', ok.status === 200 && ok.json?.org?.employees > 100, JSON.stringify(ok.json?.org));
  check('setup writes Kiro agent profiles', (ok.json?.profiles?.written ?? 0) > 50, `${ok.json?.profiles?.written} profiles`);
} else {
  cookie = '';
  const login = await call('POST', '/api/auth/login', { username: 'owner', password: 'correct-horse-battery' }, { auth: false });
  check('login', login.status === 200);
}

const again = await call('POST', '/api/setup', { companyName: 'Again', ownerName: 'O', username: 'other', password: 'correct-horse-battery' }, { auth: false });
check('setup cannot run twice', again.status === 409);

const noCsrf = await call('POST', '/api/projects', { name: 'x', objective: 'xxxxx' }, { csrf: false });
check('CSRF header required on mutations', noCsrf.status === 403);

const saved = cookie; cookie = '';
const anon = await call('GET', '/api/dashboard');
check('unauthenticated API rejected', anon.status === 401);
cookie = saved;

const wrong = await call('POST', '/api/auth/login', { username: 'owner', password: 'wrong-password-123' }, { auth: false });
check('wrong password rejected', wrong.status === 401);
cookie = saved;

const me = await call('GET', '/api/auth/me');
check('session identifies owner', me.status === 200 && me.json?.username === 'owner');

const dash = await call('GET', '/api/dashboard');
check('dashboard', dash.status === 200 && dash.json?.employees?.total > 100, `employees=${dash.json?.employees?.total}, kiro=${dash.json?.kiro?.health}`);
check('security headers on API', dash.headers.get('x-content-type-options') === 'nosniff' && dash.headers.get('x-frame-options') === 'DENY');

const health = await call('GET', '/api/system/health');
check('system health', health.status === 200, health.json?.checks?.map((c) => `${c.key}:${c.ok ? 'ok' : 'NO'}`).join(' '));

const org = await call('GET', '/api/org');
const ceo = org.json?.employees?.find((e) => e.roleKey === 'ceo');
check('org chart has CEO with authority 90', !!ceo && org.json.roles.find((r) => r.key === 'ceo')?.authority === 90);

const proj = await call('POST', '/api/projects', { name: 'Smoke Project', objective: 'Validate the control plane end to end', description: 'smoke', isDemo: true });
check('project created with git workspace', proj.status === 200 && !!proj.json?.workspacePath, proj.json?.code);
const pid = proj.json?.id;

const detail = await call('GET', `/api/projects/${pid}`);
check('project detail + progress', detail.status === 200 && typeof detail.json?.progress?.overall === 'number', `phase=${detail.json?.project?.phase} overall=${detail.json?.progress?.overall}%`);
check('engineering locked before approvals', detail.json?.engineeringLock?.locked === true, detail.json?.engineeringLock?.unmet?.join('; '));

const git = await call('GET', `/api/projects/${pid}/git`);
check('repo has main + develop', git.json?.branches?.includes('main') && git.json?.branches?.includes('develop'), git.json?.branches?.join(','));

const kiro = await call('GET', '/api/runtime/kiro');
check('kiro runtime status', kiro.status === 200 && kiro.json?.status?.detection?.installed === true, `auth=${kiro.json?.status?.detection?.authenticated}`);

const fb = await call('POST', '/api/runtime/fallback', { name: 'Test OpenRouter', provider: 'OPENROUTER', apiKey: 'sk-or-v1-0123456789abcdef0123456789abcdef7F91', model: 'openai/gpt-4o-mini' });
check('fallback connection saved', fb.status === 200);
const fbl = await call('GET', '/api/runtime/fallback');
const conn = fbl.json?.connections?.[0];
check('fallback key masked, never returned', conn?.maskedKey === 'sk-or-••••••••••7F91' && !JSON.stringify(fbl.json).includes('0123456789abcdef'), conn?.maskedKey);

const tl = await call('GET', `/api/projects/${pid}/timeline`);
check('timeline has PROJECT_CREATED', tl.json?.events?.some((e) => e.type === 'PROJECT_CREATED'));

const audit = await call('GET', '/api/audit');
check('audit log records actions', (audit.json?.entries?.length ?? 0) > 3, `${audit.json?.entries?.length} entries`);
check('audit never contains raw API key', !JSON.stringify(audit.json).includes('0123456789abcdef0123'));

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
