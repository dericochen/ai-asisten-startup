import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aco-browser-'));
const env = { ...process.env, ACO_DATA_DIR: dir, ACO_PORT: '4198', ACO_HOST: '127.0.0.1', ACO_DISABLE_BACKGROUND: '1', DATABASE_URL: '', KIRO_CLI_PATH: 'kiro-not-installed-browser-test', ACO_API_URL: 'http://127.0.0.1:4198', ACO_NEXT_DIST: '.next-e2e', ACO_MASTER_KEY: Buffer.alloc(32, 9).toString('base64') };
const children = [];
const api = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env, stdio: 'inherit', windowsHide: true });
children.push(api);
async function shutdown() {
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
