import type { FallbackProvider } from '../db/schema.js';
import { redactString } from '../lib/redact.js';

export interface CompletionRequest { provider: FallbackProvider; baseUrl?: string | null; apiKey?: string | null; model: string; system: string; prompt: string; timeoutMs?: number; maxTokens?: number }
export interface CompletionResult { text: string; inputTokens: number; outputTokens: number; model: string }

export const PROVIDER_DEFAULTS: Record<FallbackProvider, { baseUrl: string; needsKey: boolean; label: string }> = {
  NINE_ROUTER: { baseUrl: 'http://localhost:20128/v1', needsKey: false, label: '9Router' },
  OPENROUTER: { baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, label: 'OpenRouter' },
  OPENAI: { baseUrl: 'https://api.openai.com/v1', needsKey: true, label: 'OpenAI' },
  ANTHROPIC: { baseUrl: 'https://api.anthropic.com/v1', needsKey: true, label: 'Anthropic' },
  GEMINI: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', needsKey: true, label: 'Google Gemini' },
  OPENAI_COMPATIBLE: { baseUrl: 'http://localhost:8000/v1', needsKey: false, label: 'OpenAI-compatible' },
  OLLAMA: { baseUrl: 'http://localhost:11434/v1', needsKey: false, label: 'Ollama (local)' },
};

export class ProviderError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'ProviderError'; }
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal, redirect: 'error' });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      for (const key of Object.values(headers)) if (key.length >= 8) detail = detail.split(key.replace(/^Bearer /, '')).join('[REDACTED]');
      throw new ProviderError(res.status, `HTTP ${res.status}: ${redactString(detail).slice(0, 300)}`);
    }
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

/** All provider calls happen server-side; API keys never reach the browser. */
export async function complete(req: CompletionRequest, fetchImpl: typeof post = post): Promise<CompletionResult> {
  const base = providerBaseUrl(req.provider, req.baseUrl);
  if (PROVIDER_DEFAULTS[req.provider].needsKey && !req.apiKey) throw new ProviderError(401, 'This provider requires an API key.');
  const timeout = req.timeoutMs ?? 10 * 60_000;
  const maxTokens = req.maxTokens ?? 8192;
  switch (req.provider) {
    case 'ANTHROPIC': {
      const r = await fetchImpl(`${base}/messages`, { 'x-api-key': req.apiKey ?? '', 'anthropic-version': '2023-06-01' }, {
        model: req.model, max_tokens: maxTokens, system: req.system, messages: [{ role: 'user', content: req.prompt }],
      }, timeout) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
      return { text: (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''), inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0, model: r.model ?? req.model };
    }
    case 'GEMINI': {
      const r = await fetchImpl(`${base}/models/${encodeURIComponent(req.model)}:generateContent`, { 'x-goog-api-key': req.apiKey ?? '' }, {
        systemInstruction: { parts: [{ text: req.system }] }, contents: [{ role: 'user', parts: [{ text: req.prompt }] }], generationConfig: { maxOutputTokens: maxTokens },
      }, timeout) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      return { text: (r.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''), inputTokens: r.usageMetadata?.promptTokenCount ?? 0, outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0, model: req.model };
    }
    default: {
      const headers: Record<string, string> = {};
      if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;
      if (req.provider === 'OPENROUTER') { headers['x-title'] = 'AI Startup Company OS'; }
      const r = await fetchImpl(`${base}/chat/completions`, headers, {
        model: req.model, max_tokens: maxTokens, stream: false, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }],
      }, timeout) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
      const content = r.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new ProviderError(502, 'Provider returned no text. Check model availability and token limits.');
      return { text: content, inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0, model: r.model ?? req.model };
    }
  }
}

export function estimateCost(inputTokens: number, outputTokens: number, inPerM?: number | null, outPerM?: number | null): { usd: number; estimated: boolean } {
  if (inPerM == null || outPerM == null) return { usd: 0, estimated: true };
  return { usd: (inputTokens / 1e6) * inPerM + (outputTokens / 1e6) * outPerM, estimated: false };
}

export function providerBaseUrl(provider: FallbackProvider, baseUrl?: string | null): string {
  const url = new URL(baseUrl || PROVIDER_DEFAULTS[provider].baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ProviderError(400, 'Use an HTTP(S) API base URL without credentials, query or fragment.');
  let pathname = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
  if (!pathname && provider === 'NINE_ROUTER') pathname = '/v1';
  if (!pathname && provider === 'OPENROUTER') pathname = '/api/v1';
  url.pathname = pathname;
  return url.toString().replace(/\/+$/, '');
}

export async function listModels(req: Pick<CompletionRequest, 'provider' | 'baseUrl' | 'apiKey'>): Promise<{ id: string; name: string }[]> {
  if (req.provider === 'ANTHROPIC' || req.provider === 'GEMINI') throw new ProviderError(400, 'Enter the model ID manually for this provider.');
  const headers: Record<string, string> = {};
  if (req.apiKey) headers.authorization = 'Bearer ' + req.apiKey;
  const response = await fetch(providerBaseUrl(req.provider, req.baseUrl) + '/models', { headers, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new ProviderError(response.status, 'Model list returned HTTP ' + response.status + '. Check the base URL and API key.');
  const body = await response.json() as { data?: { id?: unknown; name?: unknown }[] };
  if (!Array.isArray(body.data)) throw new ProviderError(502, 'Provider returned an invalid model list.');
  return body.data.filter((m) => typeof m.id === 'string' && m.id.length > 0).slice(0, 2000).map((m) => ({ id: m.id as string, name: typeof m.name === 'string' ? m.name : m.id as string }));
}
