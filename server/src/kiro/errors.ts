export type KiroErrorClass =
  | 'RATE_LIMITED' | 'USAGE_LIMIT' | 'AUTH' | 'UNAVAILABLE' | 'PROCESS_ERROR' | 'TIMEOUT' | 'NOT_INSTALLED'
  | 'AGENT_PROFILE' | 'PROTOCOL' | 'REFUSED' | 'CANCELLED' | 'UNKNOWN';

export class KiroError extends Error {
  constructor(public readonly kind: KiroErrorClass, message: string, public readonly detail?: unknown) {
    super(message);
    this.name = 'KiroError';
  }
}

const RULES: [KiroErrorClass, RegExp][] = [
  ['USAGE_LIMIT', /usage limit|quota|insufficient (credits|balance)|limit (has been |was )?reached|monthly limit|out of credits|exceeded (your|the) (plan|limit|quota)|subscription limit|overage/i],
  ['RATE_LIMITED', /throttl|rate.?limit|too many requests|\b429\b|slow down/i],
  ['AUTH', /not logged in|unauthori[sz]ed|token (has )?expired|expired token|login required|\b401\b|\b403\b|please (re-)?authenticate|kiro-cli login/i],
  ['UNAVAILABLE', /service unavailable|\b50[234]\b|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network error|connection (refused|reset|closed)|internal server error|temporarily unavailable|dispatch failure/i],
];

/** Classify an error message (JSON-RPC error text, stderr tail, exception text). */
export function classifyKiroError(text: string): KiroErrorClass {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return 'UNKNOWN';
}

/** Errors worth retrying on Kiro before considering fallback. */
export function isRetryable(kind: KiroErrorClass): boolean {
  return kind === 'RATE_LIMITED' || kind === 'UNAVAILABLE' || kind === 'TIMEOUT' || kind === 'PROCESS_ERROR' || kind === 'UNKNOWN';
}

/**
 * Maps a Kiro failure to an allowed fallback trigger. Returns null when fallback must NOT be used
 * (e.g. the model refused, a protocol/profile bug, or cancellation) — fallback is never used for convenience.
 */
export function fallbackTrigger(kind: KiroErrorClass): string | null {
  switch (kind) {
    case 'RATE_LIMITED': return 'KIRO_RATE_LIMITED';
    case 'USAGE_LIMIT': return 'KIRO_USAGE_LIMIT_REACHED';
    case 'UNAVAILABLE': case 'AUTH': case 'NOT_INSTALLED': return 'KIRO_TEMPORARILY_UNAVAILABLE';
    case 'PROCESS_ERROR': return 'KIRO_PROCESS_ERROR';
    case 'TIMEOUT': return 'KIRO_TIMEOUT_AFTER_RETRIES';
    default: return null;
  }
}
