// Usage: node scripts/api.mjs METHOD /api/path [jsonBody] [baseUrl]
const [method = 'GET', path = '/api/dashboard', base = 'http://127.0.0.1:4199'] = process.argv.slice(2);
const body = process.env.ACO_BODY || undefined;
if (!process.env.ACO_PASS) throw new Error('Set ACO_PASS for the Owner account; no default password is provided.');
const h = { 'content-type': 'application/json', 'x-aco-csrf': '1' };
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ username: process.env.ACO_USER ?? 'owner', password: process.env.ACO_PASS }) });
h.cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const res = await fetch(base + path, { method, headers: h, body: body ? body : undefined });
const text = await res.text();
let out = text;
try { out = JSON.stringify(JSON.parse(text), null, 1); } catch { /* raw */ }
console.log(res.status, out.length > 6000 ? out.slice(0, 6000) + '\n…' : out);
