import type { FallbackProvider } from '../db/schema.js';

export interface CompletionRequest { provider: FallbackProvider; baseUrl?: string | null; apiKey?: string | null; model: string; system: string; prompt: string; timeoutMs?: number; maxTokens?: number }
export interface CompletionResult { text: string; inputTokens: number; outputTokens: number; model: string }

export const PROVIDER_DEFAULTS: Record<FallbackProvider, { baseUrl: string; needsKey: boolean; label: string }> = {
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
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(res.status, `HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

/** All provider calls happen server-side; API keys never reach the browser. */
export async function complete(req: CompletionRequest, fetchImpl: typeof post = post): Promise<CompletionResult> {
  const base = (req.baseUrl || PROVIDER_DEFAULTS[req.provider].baseUrl).replace(/\/+$/, '');
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
        model: req.model, max_tokens: maxTokens, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }],
      }, timeout) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
      return { text: r.choices?.[0]?.message?.content ?? '', inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0, model: r.model ?? req.model };
    }
  }
}

export function estimateCost(inputTokens: number, outputTokens: number, inPerM?: number | null, outPerM?: number | null): { usd: number; estimated: boolean } {
  if (inPerM == null || outPerM == null) return { usd: 0, estimated: true };
  return { usd: (inputTokens / 1e6) * inPerM + (outputTokens / 1e6) * outPerM, estimated: false };
}
