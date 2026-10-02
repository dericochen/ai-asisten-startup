// Phase 0 probe: speak JSON-RPC 2.0 to `kiro-cli acp` over stdio and log every message.
// Usage: node scripts/acp-probe.mjs "prompt text" [agentName]
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const prompt = process.argv[2] ?? 'Reply with exactly the word PONG and nothing else.';
const agent = process.argv[3];
const args = ['acp'];
if (agent) args.push('--agent', agent);

const child = spawn('kiro-cli', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
const rl = readline.createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(JSON.stringify(msg) + '\n');
  console.log('>>', JSON.stringify(msg).slice(0, 400));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { console.log('RAW', line); return; }
  console.log('<<', JSON.stringify(msg).slice(0, 600));
  if (msg.id !== undefined && pending.has(msg.id) && (msg.result !== undefined || msg.error)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(msg.error) : p.resolve(msg.result);
  } else if (msg.id !== undefined && msg.method) {
    // Agent -> client request (e.g. session/request_permission). Reject everything in the probe.
    const opts = msg.params?.options ?? [];
    const reject = opts.find((o) => String(o.kind).startsWith('reject')) ?? opts[0];
    const reply = { jsonrpc: '2.0', id: msg.id, result: { outcome: reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' } } };
    child.stdin.write(JSON.stringify(reply) + '\n');
    console.log('>> (perm reply)', JSON.stringify(reply));
  }
});
child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d));
child.on('exit', (c) => console.log('child exit', c));

const t0 = Date.now();
try {
  const init = await send('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  });
  console.log('INIT RESULT', JSON.stringify(init, null, 2));
  const sess = await send('session/new', { cwd: process.cwd(), mcpServers: [] });
  console.log('SESSION', JSON.stringify(sess).slice(0, 1500));
  const res = await send('session/prompt', { sessionId: sess.sessionId, prompt: [{ type: 'text', text: prompt }] });
  console.log('PROMPT RESULT', JSON.stringify(res), 'ms', Date.now() - t0);
} catch (e) {
  console.log('ERROR', JSON.stringify(e));
}
child.kill();
process.exit(0);
