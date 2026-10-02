import { asc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { providerConnections, secrets, type FallbackProvider } from '../db/schema.js';
import { decrypt, encrypt, maskSecret } from '../lib/crypto.js';
import { complete, PROVIDER_DEFAULTS } from './providers.js';

export class SecretStore {
  constructor(private db: DB) {}
  async put(name: string, kind: string, value: string): Promise<{ id: string; masked: string }> {
    const enc = encrypt(value);
    const masked = maskSecret(value);
    const [row] = await this.db.insert(secrets).values({ name, kind, ...enc, masked }).returning({ id: secrets.id });
    return { id: row.id, masked };
  }
  async reveal(id: string): Promise<string | null> {
    const row = (await this.db.select().from(secrets).where(eq(secrets.id, id)))[0];
    return row ? decrypt(row) : null;
  }
  async masked(id: string): Promise<string | null> {
    const row = (await this.db.select({ masked: secrets.masked }).from(secrets).where(eq(secrets.id, id)))[0];
    return row?.masked ?? null;
  }
  async remove(id: string): Promise<void> { await this.db.delete(secrets).where(eq(secrets.id, id)); }
  async list() { return this.db.select({ id: secrets.id, name: secrets.name, kind: secrets.kind, masked: secrets.masked, createdAt: secrets.createdAt }).from(secrets); }
}

export interface ConnectionInput {
  name: string; provider: FallbackProvider; apiKey?: string; baseUrl?: string | null; model: string; enabled?: boolean; priority?: number;
  costInputPerMTok?: number | null; costOutputPerMTok?: number | null;
}

export class FallbackConnections {
  constructor(private db: DB, private store: SecretStore) {}

  async list() {
    const rows = await this.db.select().from(providerConnections).orderBy(asc(providerConnections.priority), asc(providerConnections.createdAt));
    return Promise.all(rows.map(async (r) => ({ ...r, secretId: undefined, maskedKey: r.secretId ? await this.store.masked(r.secretId) : null })));
  }

  async create(input: ConnectionInput) {
    let secretId: string | null = null;
    if (input.apiKey) secretId = (await this.store.put(`${input.name} API key`, 'FALLBACK_API_KEY', input.apiKey)).id;
    const [row] = await this.db.insert(providerConnections).values({
      name: input.name, provider: input.provider, secretId, baseUrl: input.baseUrl || null, model: input.model,
      enabled: input.enabled ?? true, priority: input.priority ?? 1, costInputPerMTok: input.costInputPerMTok ?? null, costOutputPerMTok: input.costOutputPerMTok ?? null,
    }).returning();
    return row.id;
  }

  async update(id: string, input: Partial<ConnectionInput>) {
    const row = (await this.db.select().from(providerConnections).where(eq(providerConnections.id, id)))[0];
    if (!row) throw new Error('Connection not found');
    let secretId = row.secretId;
    if (input.apiKey) {
      if (secretId) await this.store.remove(secretId);
      secretId = (await this.store.put(`${input.name ?? row.name} API key`, 'FALLBACK_API_KEY', input.apiKey)).id;
    }
    await this.db.update(providerConnections).set({
      name: input.name ?? row.name, baseUrl: input.baseUrl === undefined ? row.baseUrl : input.baseUrl || null, model: input.model ?? row.model,
      enabled: input.enabled ?? row.enabled, priority: input.priority ?? row.priority, secretId,
      costInputPerMTok: input.costInputPerMTok === undefined ? row.costInputPerMTok : input.costInputPerMTok,
      costOutputPerMTok: input.costOutputPerMTok === undefined ? row.costOutputPerMTok : input.costOutputPerMTok,
    }).where(eq(providerConnections.id, id));
  }

  async remove(id: string) {
    const row = (await this.db.select().from(providerConnections).where(eq(providerConnections.id, id)))[0];
    if (row?.secretId) await this.store.remove(row.secretId);
    await this.db.delete(providerConnections).where(eq(providerConnections.id, id));
  }

  /** Enabled connections in priority order (primary fallback first, then secondary). */
  async usable() {
    const rows = await this.db.select().from(providerConnections).where(eq(providerConnections.enabled, true)).orderBy(asc(providerConnections.priority));
    return rows.filter((r) => !PROVIDER_DEFAULTS[r.provider].needsKey || r.secretId);
  }

  async credentials(id: string) {
    const row = (await this.db.select().from(providerConnections).where(eq(providerConnections.id, id)))[0];
    if (!row) throw new Error('Connection not found');
    return { row, apiKey: row.secretId ? await this.store.reveal(row.secretId) : null };
  }

  /** Real round-trip health test (tiny prompt). */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    const { row, apiKey } = await this.credentials(id);
    try {
      const r = await complete({ provider: row.provider, baseUrl: row.baseUrl, apiKey, model: row.model, system: 'Health check.', prompt: 'Reply with OK.', timeoutMs: 30_000, maxTokens: 16 });
      const ok = r.text.trim().length > 0;
      await this.db.update(providerConnections).set({ health: ok ? 'HEALTHY' : 'DEGRADED', healthMessage: ok ? `Responded (${r.model})` : 'Empty response', lastCheckedAt: new Date() }).where(eq(providerConnections.id, id));
      return { ok, message: ok ? `Responded: ${r.text.trim().slice(0, 40)}` : 'Empty response' };
    } catch (e) {
      const message = String((e as Error).message).slice(0, 300);
      await this.db.update(providerConnections).set({ health: 'UNHEALTHY', healthMessage: message, lastCheckedAt: new Date() }).where(eq(providerConnections.id, id));
      return { ok: false, message };
    }
  }
}
