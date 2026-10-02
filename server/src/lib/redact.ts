/**
 * Redacts likely secrets from strings/objects before they are written to audit logs, events,
 * tool-call records, or shown in the UI. Defense in depth — secrets should never reach here.
 */
const PATTERNS: RegExp[] = [
  /sk-(?:or-|ant-|proj-)?[A-Za-z0-9_\-]{16,}/g,          // OpenAI / OpenRouter / Anthropic style keys
  /AIza[0-9A-Za-z_\-]{30,}/g,                             // Google API keys
  /gh[pousr]_[A-Za-z0-9]{30,}/g,                          // GitHub tokens
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,                         // Slack tokens
  /AKIA[0-9A-Z]{16}/g,                                    // AWS access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(Bearer\s+)[A-Za-z0-9._\-]{16,}/gi,
  /((?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["']?)[^\s"',}]{6,}/gi,
];

const SENSITIVE_KEYS = /^(password|passwd|secret|apiKey|api_key|token|authorization|credential|privateKey)$/i;

export function redactString(s: string): string {
  let out = s;
  for (const p of PATTERNS) {
    out = out.replace(p, (m, g1) => (typeof g1 === 'string' && m.startsWith(g1) ? `${g1}[REDACTED]` : '[REDACTED]'));
  }
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
