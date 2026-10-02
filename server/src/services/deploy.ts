import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { deployments, incidents, monitorSamples, releases, type ReleaseStatus } from '../db/schema.js';
import { nextCode, type AuditService, type EventBus } from '../core/events.js';
import type { GitService } from './git.js';
import type { Project } from './projects.js';
import type { NotificationService } from './records.js';
import { npmInstall, npmScript, startApp, type RunningApp } from './quality.js';
import { config } from '../config.js';
import { tail } from '../lib/proc.js';

export type Deployment = typeof deployments.$inferSelect;
export type Release = typeof releases.$inferSelect;
type Env = 'STAGING' | 'PRODUCTION';

/**
 * Deployment adapters. LOCAL_PROCESS hosts the app on this machine (real processes, real ports) and is
 * fully verifiable offline. COMMAND runs Owner-configured deploy commands (Vercel, Docker, VPS scripts...)
 * and verifies the resulting URL with the same health checks. Providers are never trusted blindly:
 * the release is only HEALTHY after our own checks pass.
 */
export class DeploymentService {
  private running = new Map<string, RunningApp>();

  constructor(private db: DB, private bus: EventBus, private audit: AuditService, private git: GitService, private notify: NotificationService) {}

  async createRelease(project: Project, notes: string): Promise<Release> {
    const prev = (await this.db.select().from(releases).where(eq(releases.projectId, project.id)).orderBy(desc(releases.createdAt)).limit(1))[0];
    const version = bumpMinor(prev?.version);
    const commit = await this.git.release(project.workspacePath!, version, notes);
    const [row] = await this.db.insert(releases).values({ projectId: project.id, version, commit, notes, status: 'CANDIDATE', gates: {} }).returning();
    await this.bus.emit('RELEASE_CREATED', `Release ${version} candidate created at ${commit.slice(0, 8)}`, { projectId: project.id, data: { releaseId: row.id } });
    return row;
  }

  async setReleaseStatus(id: string, status: ReleaseStatus, gate?: [string, string]): Promise<Release> {
    const rel = (await this.db.select().from(releases).where(eq(releases.id, id)))[0];
    const [row] = await this.db.update(releases).set({ status, updatedAt: new Date(), gates: gate ? { ...rel.gates, [gate[0]]: gate[1] } : rel.gates }).where(eq(releases.id, id)).returning();
    return row;
  }

  async latestRelease(projectId: string): Promise<Release | undefined> {
    return (await this.db.select().from(releases).where(eq(releases.projectId, projectId)).orderBy(desc(releases.createdAt)).limit(1))[0];
  }

  async active(projectId: string, env: Env): Promise<Deployment | undefined> {
    return (await this.db.select().from(deployments).where(and(eq(deployments.projectId, projectId), eq(deployments.environment, env), eq(deployments.active, true))).orderBy(desc(deployments.startedAt)).limit(1))[0];
  }

  /** Deploy a release to an environment and verify it actually starts and answers health checks. */
  async deploy(project: Project, release: Release, env: Env, opts: { rollbackOfId?: string } = {}): Promise<Deployment> {
    const cfg = project.deployment;
    const [dep] = await this.db.insert(deployments).values({ projectId: project.id, releaseId: release.id, environment: env, provider: cfg.provider, status: 'BUILDING', commit: release.commit, rollbackOfId: opts.rollbackOfId ?? null }).returning();
    await this.audit.log({ type: 'AGENT', name: env === 'PRODUCTION' ? 'Release Manager' : 'DevOps Lead' }, `deploy.${env.toLowerCase()}`, `${project.code} v${release.version}`, { commit: release.commit, provider: cfg.provider });
    let replaced: Deployment | undefined;
    let log = '';
    const append = async (s: string) => { log += s + '\n'; await this.db.update(deployments).set({ log: tail(log, 30_000) }).where(eq(deployments.id, dep.id)); };
    try {
      if (cfg.provider === 'COMMAND') return await this.deployCommand(project, release, env, dep, append);
      const dir = path.join(config.deployDir, project.code, env.toLowerCase(), `v${release.version}`);
      await append(`Checking out ${release.commit.slice(0, 8)} into ${dir}`);
      await this.git.addDetachedWorktree(project.workspacePath!, dir, release.commit);
      const install = await npmInstall(dir);
      await append(`[install] ${install.status}\n${tail(install.details, 1500)}`);
      if (install.status === 'FAIL') throw new Error('Dependency installation failed');
      const build = await npmScript(dir, cfg.buildScript ?? 'build', false);
      await append(`[build] ${build.status}\n${tail(build.details, 1500)}`);
      if (build.status === 'FAIL') throw new Error('Build failed');
      const port = env === 'PRODUCTION' ? cfg.productionPort! : cfg.stagingPort!;
      // Stop whatever currently serves this environment (local adapter shares one port per env).
      const current = await this.active(project.id, env);
      if (current) { await this.stopDeployment(current.id, 'STOPPED'); replaced = current; }
      const dataDir = path.join(config.deployDir, project.code, `${env.toLowerCase()}-data`);
      fs.mkdirSync(dataDir, { recursive: true });
      await append(`Starting app on port ${port} (NODE_ENV=production)`);
      const app = await startApp(dir, port, cfg.healthPath, { NODE_ENV: 'production', DATA_DIR: dataDir });
      this.running.set(dep.id, app);
      app.child.on('exit', (code) => { void this.onProcessExit(dep.id, code); });
      const url = `http://localhost:${port}`;
      const [row] = await this.db.update(deployments).set({ status: 'RUNNING', url, path: dir, port, active: true, finishedAt: new Date(), log: tail(log + `App healthy at ${url}${cfg.healthPath}\n`, 30_000) }).where(eq(deployments.id, dep.id)).returning();
      await this.db.update(deployments).set({ active: false }).where(and(eq(deployments.projectId, project.id), eq(deployments.environment, env), eq(deployments.active, true), ne(deployments.id, dep.id)));
      await this.bus.emit(env === 'STAGING' ? 'STAGING_DEPLOYED' : 'PRODUCTION_DEPLOYED', `${project.code} v${release.version} deployed to ${env.toLowerCase()} at ${url}`, { projectId: project.id, data: { deploymentId: dep.id, url } });
      return row;
    } catch (e) {
      const msg = String((e as Error).message);
      const [row] = await this.db.update(deployments).set({ status: 'FAILED', finishedAt: new Date(), log: tail(log + `FAILED: ${msg}\n`, 30_000) }).where(eq(deployments.id, dep.id)).returning();
      await this.bus.emit(env === 'STAGING' ? 'STAGING_FAILED' : 'PRODUCTION_HEALTH_FAILED', `${project.code} v${release.version} ${env.toLowerCase()} deployment failed: ${msg.slice(0, 200)}`, { projectId: project.id, data: { deploymentId: dep.id } });
      if (replaced && !opts.rollbackOfId) await this.rollback(project, row);
      return row;
    }
  }

  private async deployCommand(project: Project, release: Release, env: Env, dep: Deployment, append: (s: string) => Promise<void>): Promise<Deployment> {
    const cmd = env === 'PRODUCTION' ? project.deployment.commandDeploy?.production : project.deployment.commandDeploy?.staging;
    const url = env === 'PRODUCTION' ? project.deployment.commandDeploy?.productionUrl : project.deployment.commandDeploy?.stagingUrl;
    if (!cmd || !url) throw new Error(`COMMAND adapter requires ${env.toLowerCase()} command and URL in project deployment settings`);
    const dir = path.join(config.deployDir, project.code, env.toLowerCase(), `v${release.version}`);
    await this.git.addDetachedWorktree(project.workspacePath!, dir, release.commit);
    await append(`Running Owner-configured ${env.toLowerCase()} deploy command in ${dir}`);
    // Owner-configured command: executed through the shell by design (configured in Settings by the Owner only).
    const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
      let out = '';
      const child = spawn(cmd, { cwd: dir, shell: true, windowsHide: true, env: { ...process.env, RELEASE_VERSION: release.version, RELEASE_COMMIT: release.commit } });
      child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
      const t = setTimeout(() => child.kill(), 30 * 60_000);
      child.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    });
    await append(tail(result.out, 4000));
    if (result.code !== 0) throw new Error(`Deploy command exited with ${result.code}`);
    const [row] = await this.db.update(deployments).set({ status: 'RUNNING', url, path: dir, active: true, finishedAt: new Date() }).where(eq(deployments.id, dep.id)).returning();
    await this.db.update(deployments).set({ active: false }).where(and(eq(deployments.projectId, project.id), eq(deployments.environment, env), eq(deployments.active, true), ne(deployments.id, dep.id)));
    return row;
  }

  async markHealth(depId: string, healthy: boolean): Promise<void> {
    await this.db.update(deployments).set({ status: healthy ? 'HEALTHY' : 'UNHEALTHY' }).where(eq(deployments.id, depId));
  }

  async stopDeployment(depId: string, status: 'STOPPED' | 'ROLLED_BACK'): Promise<void> {
    const app = this.running.get(depId);
    this.running.delete(depId);
    await this.db.update(deployments).set({ active: false, status }).where(eq(deployments.id, depId));
    if (app) await app.stop();
  }

  private async onProcessExit(depId: string, code: number | null): Promise<void> {
    if (!this.running.has(depId)) return; // intentional stop
    this.running.delete(depId);
    await this.db.update(deployments).set({ status: 'FAILED', log: `Process exited unexpectedly with code ${code}` }).where(eq(deployments.id, depId));
  }

  /** Roll back production to the previous healthy release, if one exists. Never loops. */
  async rollback(project: Project, failed: Deployment): Promise<Deployment | null> {
    const previous = await this.db.select({ deployment: deployments }).from(deployments)
      .innerJoin(releases, eq(releases.id, deployments.releaseId))
      .where(and(eq(deployments.projectId, project.id), eq(deployments.environment, failed.environment), eq(releases.status, 'HEALTHY'), ne(deployments.releaseId, failed.releaseId)))
      .orderBy(desc(deployments.startedAt)).limit(1);
    const prev = previous[0]?.deployment;
    await this.stopDeployment(failed.id, 'ROLLED_BACK');
    if (!prev) return null;
    const rel = (await this.db.select().from(releases).where(eq(releases.id, prev.releaseId)))[0];
    const dep = await this.deploy(project, rel, failed.environment, { rollbackOfId: failed.id });
    if (dep.status !== 'RUNNING') return null;
    await this.bus.emit('ROLLBACK', `${project.code} production rolled back to v${rel.version}`, { projectId: project.id, data: { deploymentId: dep.id } });
    return dep;
  }

  /** Re-launch active local deployments after a restart of the company OS. */
  async restore(projectsById: Map<string, Project>): Promise<void> {
    const active = await this.db.select().from(deployments).where(eq(deployments.active, true));
    for (const d of active) {
      const p = projectsById.get(d.projectId);
      if (!p || d.provider !== 'LOCAL_PROCESS' || !d.path || !d.port || !fs.existsSync(d.path)) continue;
      try {
        const env = d.environment.toLowerCase();
        const app = await startApp(d.path, d.port, p.deployment.healthPath, { NODE_ENV: 'production', DATA_DIR: path.join(config.deployDir, p.code, `${env}-data`) });
        this.running.set(d.id, app);
        app.child.on('exit', (code) => { void this.onProcessExit(d.id, code); });
      } catch (e) {
        await this.db.update(deployments).set({ status: 'FAILED', log: `Restore failed: ${String((e as Error).message).slice(0, 500)}` }).where(eq(deployments.id, d.id));
      }
    }
  }

  async list(projectId?: string) {
    return this.db.select().from(deployments).where(projectId ? eq(deployments.projectId, projectId) : undefined).orderBy(desc(deployments.startedAt)).limit(100);
  }
  async releases(projectId?: string) {
    return this.db.select().from(releases).where(projectId ? eq(releases.projectId, projectId) : undefined).orderBy(desc(releases.createdAt)).limit(100);
  }

  shutdown(): void { for (const app of this.running.values()) void app.stop(); this.running.clear(); }
}

export class IncidentService {
  constructor(private db: DB, private bus: EventBus, private notify: NotificationService) {}
  async open(i: { projectId: string | null; severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'; title: string; description: string }) {
    const code = await nextCode(this.db, 'INC');
    const [row] = await this.db.insert(incidents).values({ code, ...i, timeline: [{ at: new Date().toISOString(), note: 'Incident opened by monitoring/validation' }] }).returning();
    await this.bus.emit('INCIDENT_CREATED', `${code} (${i.severity}): ${i.title}`, { projectId: i.projectId, data: { incidentId: row.id } });
    await this.notify.notifyOwner({ projectId: i.projectId, category: 'INCIDENT', severity: i.severity === 'SEV1' || i.severity === 'SEV2' ? 'CRITICAL' : 'WARNING', title: `${code}: ${i.title}`, body: i.description });
    return row;
  }
  async note(id: string, note: string, status?: 'OPEN' | 'MITIGATING' | 'RESOLVED', postmortem?: string) {
    const row = (await this.db.select().from(incidents).where(eq(incidents.id, id)))[0];
    if (!row) return;
    await this.db.update(incidents).set({ timeline: [...row.timeline, { at: new Date().toISOString(), note }], ...(status ? { status } : {}), ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}), ...(postmortem ? { postmortem } : {}) }).where(eq(incidents.id, id));
    if (status === 'RESOLVED') await this.bus.emit('INCIDENT_RESOLVED', `${row.code} resolved: ${note.slice(0, 120)}`, { projectId: row.projectId });
  }
  async openFor(projectId: string) { return this.db.select().from(incidents).where(and(eq(incidents.projectId, projectId), ne(incidents.status, 'RESOLVED'))); }
  async list() { return this.db.select().from(incidents).orderBy(desc(incidents.createdAt)).limit(200); }
}

export class MonitoringService {
  private failures = new Map<string, number>();
  constructor(private db: DB, private bus: EventBus, private incidents: IncidentService) {}

  /** One real HTTP probe against an environment's health endpoint. */
  async sample(project: Project, env: Env, url: string): Promise<boolean> {
    const t = Date.now();
    let ok = false; let status: number | null = null; let error: string | null = null;
    try {
      const res = await fetch(url + project.deployment.healthPath, { signal: AbortSignal.timeout(10_000) });
      status = res.status; ok = res.status === 200;
    } catch (e) { error = String((e as Error).message).slice(0, 300); }
    await this.db.insert(monitorSamples).values({ projectId: project.id, environment: env, url, ok, httpStatus: status, latencyMs: Date.now() - t, error });
    const key = `${project.id}:${env}`;
    const n = ok ? 0 : (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, n);
    if (env === 'PRODUCTION' && n === 3) {
      const open = await this.incidents.openFor(project.id);
      if (!open.some((i) => i.title.startsWith('Production health check failing'))) {
        await this.incidents.open({ projectId: project.id, severity: 'SEV2', title: `Production health check failing for ${project.name}`, description: `3 consecutive failed probes of ${url}${project.deployment.healthPath}. Last error: ${error ?? `HTTP ${status}`}` });
      }
    }
    return ok;
  }

  async recent(projectId: string, limit = 60) {
    return this.db.select().from(monitorSamples).where(eq(monitorSamples.projectId, projectId)).orderBy(desc(monitorSamples.id)).limit(limit);
  }
}

function bumpMinor(v?: string): string {
  if (!v) return '0.1.0';
  const [maj, min] = v.split('.').map(Number);
  return `${maj}.${min + 1}.0`;
}
