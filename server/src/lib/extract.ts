/**
 * Agents return a Markdown deliverable followed by one fenced ```json block with the structured result.
 * We take the LAST json block (agents sometimes quote examples earlier) and treat everything before it
 * as the human-readable deliverable.
 */
export interface Extracted<T = Record<string, unknown>> { body: string; data: T | null; error?: string }

export function extractResult<T = Record<string, unknown>>(text: string): Extracted<T> {
  const re = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let last: { index: number; raw: string; len: number } | null = null;
  while ((match = re.exec(text)) !== null) last = { index: match.index, raw: match[1], len: match[0].length };
  if (!last) {
    // Fallback: a bare JSON object at the end of the message.
    const brace = text.lastIndexOf('\n{');
    if (brace >= 0) {
      const candidate = text.slice(brace + 1).trim();
      try { return { body: text.slice(0, brace).trim(), data: JSON.parse(candidate) as T }; } catch { /* fallthrough */ }
    }
    return { body: text.trim(), data: null, error: 'No ```json result block found in agent output' };
  }
  try {
    const data = JSON.parse(last.raw.trim()) as T;
    const body = cleanBody(text.slice(0, last.index) + text.slice(last.index + last.len));
    return { body, data };
  } catch (e) {
    return { body: text.trim(), data: null, error: `Result block is not valid JSON: ${(e as Error).message}` };
  }
}

/** Drops short tool-use narration ("Let me check…") that precedes the first Markdown heading. */
export function cleanBody(s: string): string {
  const t = s.trim();
  const h = t.search(/^#{1,3} /m);
  return h > 0 && h < 800 ? t.slice(h).trim() : t;
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? fallback : JSON.stringify(v);
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
}
