import { eq } from 'drizzle-orm';
import { deployments } from '../db/schema.js';
import type { Services } from '../core/container.js';
import { EngineCore } from './core.js';
import { planningPhase } from './planning.js';
import { deliveryPhase } from './delivery.js';

export class WorkflowEngine extends EngineCore {
  private monitorTimer: NodeJS.Timeout | null = null;

  constructor(s: Services) {
    super(s);
    this.phaseHandler = async (p) => {
      if (await planningPhase(this, p)) return;
      await deliveryPhase(this, p);
    };
  }

  /** Real HTTP probes of every active production deployment, including completed projects. */
  startMonitoring(): void {
    const loop = async () => {
      try {
        const active = await this.s.db.select().from(deployments).where(eq(deployments.active, true));
        for (const d of active.filter((x) => x.environment === 'PRODUCTION' && x.url)) {
          const p = await this.s.projects.get(d.projectId);
          if (p) await this.s.monitoring.sample(p, 'PRODUCTION', d.url!);
        }
      } catch (e) { console.error('[monitoring]', e); }
      this.monitorTimer = setTimeout(loop, this.s.policies().monitoring.intervalMs);
    };
    this.monitorTimer = setTimeout(loop, 5_000);
  }

  stopAll(): void { this.stop(); if (this.monitorTimer) clearTimeout(this.monitorTimer); }
}
