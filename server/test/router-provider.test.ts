import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { complete, listModels, providerBaseUrl, PROVIDER_DEFAULTS } from '../src/fallback/providers.js';

let server: http.Server; let base: string;
const requests: { url: string; auth?: string; body: any }[] = [];
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push({ url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'router/test-model', name: 'Router Test' }, { name: 'invalid' }] })); return; }
    if (req.url === '/v1/chat/completions') {
      const input = JSON.parse(raw);
      if (input.model === 'error') { res.statusCode = 401; res.end(JSON.stringify({ error: req.headers.authorization })); return; }
      if (input.model === 'empty') { res.end(JSON.stringify({ choices: [] })); return; }
      res.end(JSON.stringify({ choices: [{ message: { content: 'Router ready' } }], model: input.model, usage: { prompt_tokens: 12, completion_tokens: 3 } })); return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe('9Router and OpenRouter HTTP compatibility', () => {
  it('defines the documented 9Router endpoint', () => { expect(PROVIDER_DEFAULTS.NINE_ROUTER.baseUrl).toBe('http://localhost:20128/v1'); });
  it.each(['NINE_ROUTER', 'OPENROUTER'] as const)('sends authenticated non-streaming completions via %s', async (provider) => {
    const result = await complete({ provider, baseUrl: base + '/chat/completions', apiKey: 'router-test-key', model: 'router/test-model', system: 'system', prompt: 'hello' });
    expect(result).toEqual({ text: 'Router ready', model: 'router/test-model', inputTokens: 12, outputTokens: 3 });
    expect(requests.at(-1)?.url).toBe('/v1/chat/completions');
    expect(requests.at(-1)?.auth).toBe('Bearer router-test-key');
    expect(requests.at(-1)?.body.stream).toBe(false);
  });
  it('supports a local 9Router instance without required API authentication', async () => {
    expect((await complete({ provider: 'NINE_ROUTER', baseUrl: base, model: 'router/test-model', system: '', prompt: 'hello' })).text).toBe('Router ready');
    expect(requests.at(-1)?.auth).toBeUndefined();
  });
  it('loads model IDs and names', async () => { expect(await listModels({ provider: 'NINE_ROUTER', baseUrl: base, apiKey: 'router-test-key' })).toEqual([{ id: 'router/test-model', name: 'Router Test' }]); });
  it('rejects empty completion responses', async () => { await expect(complete({ provider: 'NINE_ROUTER', baseUrl: base, model: 'empty', system: '', prompt: 'x' })).rejects.toThrow('no text'); });
  it('does not leak a key echoed by an error response', async () => {
    try { await complete({ provider: 'NINE_ROUTER', baseUrl: base, apiKey: 'router-test-key', model: 'error', system: '', prompt: 'x' }); expect.fail('Expected failure'); }
    catch (e) { expect((e as Error).message).toContain('401'); expect((e as Error).message).not.toContain('router-test-key'); }
  });
  it('requires an OpenRouter key for completions', async () => { await expect(complete({ provider: 'OPENROUTER', baseUrl: base, model: 'router/test-model', system: '', prompt: 'x' })).rejects.toThrow('API key'); });
  it('normalizes root router URLs', () => { expect(providerBaseUrl('NINE_ROUTER', 'http://localhost:20128/')).toBe('http://localhost:20128/v1'); });
  it.each(['file:///tmp/file', 'https://user:secret@example.com/v1', 'https://example.com/v1?key=secret'])('rejects unsafe base URLs: %s', (url) => { expect(() => providerBaseUrl('NINE_ROUTER', url)).toThrow(); });
});
