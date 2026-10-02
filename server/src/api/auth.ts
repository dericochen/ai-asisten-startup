import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {} from '@fastify/cookie';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { company, owners, ownerSessions } from '../db/schema.js';
import type { Services } from '../core/container.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { DEFAULT_POLICIES } from '../org/definition.js';
import { writeAgentProfiles } from '../kiro/agents.js';
import { config } from '../config.js';

export const SESSION_COOKIE = 'aco_session';
export interface OwnerIdentity { id: string; username: string; displayName: string }

declare module 'fastify' { interface FastifyRequest { owner?: OwnerIdentity } }

const failures = new Map<string, { n: number; until: number }>();

export async function needsSetup(s: Services): Promise<boolean> {
  const r = await s.db.select({ n: sql<number>`count(*)::int` }).from(owners);
  return (r[0]?.n ?? 0) === 0;
}

async function createSession(s: Services, reply: FastifyReply, ownerId: string) {
  const token = randomToken();
  await s.db.insert(ownerSessions).values({ id: sha256(token), ownerId, expiresAt: new Date(Date.now() + config.sessionTtlMs) });
  await s.db.delete(ownerSessions).where(lt(ownerSessions.expiresAt, new Date()));
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/', secure: false, maxAge: Math.floor(config.sessionTtlMs / 1000) });
}

export async function resolveOwner(s: Services, req: FastifyRequest): Promise<OwnerIdentity | undefined> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return undefined;
  const rows = await s.db.select({ id: owners.id, username: owners.username, displayName: owners.displayName }).from(ownerSessions)
    .innerJoin(owners, eq(owners.id, ownerSessions.ownerId)).where(and(eq(ownerSessions.id, sha256(token)), gt(ownerSessions.expiresAt, new Date())));
  return rows[0];
}

const setupSchema = z.object({
  companyName: z.string().trim().min(2).max(80),
  mission: z.string().trim().max(500).default(''),
  ownerName: z.string().trim().min(1).max(80),
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(10).max(200),
  deploymentMode: z.enum(['MANUAL', 'CEO_APPROVAL', 'OWNER_APPROVAL', 'AUTO_AFTER_CHECKS']).default('OWNER_APPROVAL'),
  fallbackMode: z.enum(['AUTO', 'ASK_OWNER', 'DISABLED']).default('ASK_OWNER'),
});

export function registerAuth(app: FastifyInstance, s: Services) {
  // CSRF defence: state-changing requests must carry a custom header (not settable cross-site without CORS, which is disabled).
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/') && req.headers['x-aco-csrf'] !== '1') {
      return reply.code(403).send({ error: 'Missing CSRF header' });
    }
  });

  app.get('/api/setup/status', async () => ({ needsSetup: await needsSetup(s), kiro: s.kiro.detection }));

  app.post('/api/setup/detect-kiro', async () => {
    if (!(await needsSetup(s))) return { detection: s.kiro.detection };
    return { detection: await s.kiro.detect() };
  });

  app.post('/api/setup', async (req, reply) => {
    if (!(await needsSetup(s))) return reply.code(409).send({ error: 'Company already set up' });
    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid setup data', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const d = parsed.data;
    const policies = { ...DEFAULT_POLICIES, deploymentMode: d.deploymentMode, fallbackMode: d.fallbackMode };
    await s.db.insert(company).values({ name: d.companyName, mission: d.mission, policies, setupCompletedAt: new Date() });
    const [owner] = await s.db.insert(owners).values({ username: d.username, displayName: d.ownerName, passwordHash: hashPassword(d.password) }).returning();
    const org = await s.org.install();
    const profiles = writeAgentProfiles(config.kiroHome);
    await s.reloadPolicies();
    await s.audit.log({ type: 'OWNER', id: owner.id, name: owner.displayName }, 'company.setup', d.companyName, { org, profiles: profiles.written });
    await s.memory.remember({ scope: 'COMPANY', kind: 'RULE', content: `Company ${d.companyName} founded. Deployment policy ${d.deploymentMode}; fallback policy ${d.fallbackMode}.` });
    await createSession(s, reply, owner.id);
    return { ok: true, org, profiles };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const key = req.ip;
    const f = failures.get(key);
    if (f && f.n >= 5 && f.until > Date.now()) return reply.code(429).send({ error: 'Too many failed attempts. Try again later.' });
    const body = z.object({ username: z.string().max(40), password: z.string().max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid request' });
    const row = (await s.db.select().from(owners).where(eq(owners.username, body.data.username)))[0];
    if (!row || !verifyPassword(body.data.password, row.passwordHash)) {
      failures.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60_000 });
      await s.audit.log({ type: 'SYSTEM', name: 'Auth' }, 'auth.login_failed', body.data.username, { ip: req.ip });
      return reply.code(401).send({ error: 'Invalid username or password' });
    }
    failures.delete(key);
    await createSession(s, reply, row.id);
    await s.audit.log({ type: 'OWNER', id: row.id, name: row.displayName }, 'auth.login', null, {});
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await s.db.delete(ownerSessions).where(eq(ownerSessions.id, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const o = await resolveOwner(s, req);
    if (!o) return reply.code(401).send({ error: 'Not signed in' });
    return o;
  });

  // Every other /api route requires the Owner session.
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || url.startsWith('/api/setup') || url.startsWith('/api/auth/') || url === '/api/health') return;
    const o = await resolveOwner(s, req);
    if (!o) return reply.code(401).send({ error: 'Not signed in' });
    req.owner = o;
  });
}
