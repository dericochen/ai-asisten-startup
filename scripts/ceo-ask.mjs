// Sends one Owner command to the CEO through the API and waits for the Kiro-generated reply.
// Usage: node scripts/ceo-ask.mjs "message" [baseUrl] [username] (password from ACO_PASS)
const [msg = 'How many employees does the company have, and what projects exist? Answer briefly.', base = 'http://127.0.0.1:4199', user = process.env.ACO_USER ?? 'owner'] = process.argv.slice(2);
const pass = process.env.ACO_PASS;
if (!pass) throw new Error('Set ACO_PASS for the Owner account.');
const h = { 'content-type': 'application/json', 'x-aco-csrf': '1' };
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ username: user, password: pass }) });
h.cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const sent = await (await fetch(`${base}/api/ceo/messages`, { method: 'POST', headers: h, body: JSON.stringify({ content: msg }) })).json();
const started = Date.now();
while (Date.now() - started < 10 * 60_000) {
  await new Promise((r) => setTimeout(r, 3000));
  const { messages } = await (await fetch(`${base}/api/ceo/messages`, { headers: h })).json();
  const reply = messages.find((m) => m.id === sent.replyId);
  if (reply && reply.status !== 'PENDING') {
    console.log(`STATUS ${reply.status} after ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(reply.content);
    console.log('ACTIONS', JSON.stringify(reply.actions));
    const runs = (await (await fetch(`${base}/api/runtime/runs`, { headers: h })).json()).runs.slice(0, 2);
    console.log('RUNS', JSON.stringify(runs.map((r) => ({ status: r.status, runtime: r.runtime, profile: r.agentProfile, worker: r.workerId, credits: r.credits, ms: r.durationMs, err: r.errorMessage }))));
    process.exit(reply.status === 'DONE' ? 0 : 1);
  }
}
console.log('TIMEOUT');
process.exit(1);
