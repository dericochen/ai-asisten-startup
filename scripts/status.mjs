// Prints a compact pipeline status for one project. Usage: node scripts/status.mjs [projectId] [baseUrl] [nTasks]
const [id, B = 'http://127.0.0.1:4199', n = '8'] = process.argv.slice(2);
if (!id || !process.env.ACO_PASS) throw new Error('Provide a project ID and set ACO_PASS.');
const h = { 'content-type': 'application/json', 'x-aco-csrf': '1' };
const l = await fetch(`${B}/api/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ username: process.env.ACO_USER ?? 'owner', password: process.env.ACO_PASS }) });
h.cookie = (l.headers.get('set-cookie') ?? '').split(';')[0];
const get = async (p) => (await fetch(B + p, { headers: h })).json();
const d = await get(`/api/projects/${id}`);
console.log(`${new Date().toLocaleTimeString()} phase=${d.project.phase} overall=${d.progress.overall}% status=${d.project.status} engLock=${d.engineeringLock.locked}`);
const t = await get(`/api/projects/${id}/tasks`);
for (const x of t.tasks.slice(-Number(n))) console.log(`  ${x.code.padEnd(8)} ${x.stage.padEnd(28)} ${x.status.padEnd(8)} r${x.round} a${x.attempts} ${x.assignee?.name ?? ''}${x.blockedReason ? ` | ${x.blockedReason.slice(0, 220).replace(/\s+/g, ' ')}` : ''}`);
const a = await get(`/api/approvals?projectId=${id}`);
console.log('  approvals:', a.approvals.map((x) => `${x.code}:${x.gate}:${x.status}${x.approverRole === 'OWNER' ? '(OWNER)' : ''}`).join(' '));
const k = await get('/api/runtime/kiro');
console.log(`  kiro=${k.status.health} credits=${k.status.creditsToday.toFixed(2)} busy=${k.status.runningJobs}/${k.status.workers.length} queued=${k.status.queuedJobs}`);
