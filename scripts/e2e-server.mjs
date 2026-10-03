import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-browser-'));
const env = { ...process.env, ACO_DATA_DIR: dir, ACO_PORT: '4198', ACO_HOST: '127.0.0.1', ACO_DISABLE_BACKGROUND: '1', DATABASE_URL: '', KIRO_CLI_PATH: 'kiro-not-installed-browser-test', ACO_API_URL: 'http://127.0.0.1:4198', ACO_NEXT_DIST: '.next-e2e', ACO_MASTER_KEY: Buffer.alloc(32, 9).toString('base64') };
const router = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer e2e-router-secret') { res.statusCode = 401; res.end('{}'); return; }
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'test/router-model', name: 'Test Router Model' }] })); return; }
  if (req.url === '/v1/chat/completions') {
    const input = JSON.parse(body);
    const text = input.messages.some((m) => m.content === 'Reply with OK.') ? 'OK' : '# Router ready\n\x60\x60\x60json\n{"reply":"Router ready","actions":[]}\n\x60\x60\x60';
    res.end(JSON.stringify({ choices: [{ message: { content: text } }], model: input.model, usage: { prompt_tokens: 12, completion_tokens: 3 } })); return;
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((resolve) => router.listen(4201, '127.0.0.1', resolve));
const children = [];
const api = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env, stdio: 'inherit', windowsHide: true });
children.push(api);
async function shutdown() {
  router.close();
  for (const child of children) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  // Only delete the fresh, test-owned directory created above.
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('aco-browser-')) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  process.exit(0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
let ready = false;
for (let n = 0; n < 100; n++) {
  try { if ((await fetch('http://127.0.0.1:4198/api/health')).ok) { ready = true; break; } } catch {}
  if (api.exitCode !== null) throw new Error('Test API failed to start');
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) { await shutdown(); throw new Error('Test API did not become ready'); }
children.push(spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'web', '-p', '3199', '--hostname', '127.0.0.1'], { env, stdio: 'inherit', windowsHide: true }));
