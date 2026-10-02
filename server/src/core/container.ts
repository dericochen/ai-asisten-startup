import type { DB } from '../db/client.js';
import { AuditService, EventBus } from './events.js';
import { OrganizationService } from '../org/service.js';
import { ApprovalService } from '../services/approvals.js';
import { WorkflowGuard } from '../workflow/guard.js';
import { TaskService } from '../services/tasks.js';
import { ProjectService } from '../services/projects.js';
import { GitService } from '../services/git.js';
import { ArtifactService, DecisionService, MeetingService, MemoryService, MessageService, NotificationService } from '../services/records.js';
import { KiroRuntimeManager } from '../kiro/runtime.js';
import { FallbackConnections, SecretStore } from '../fallback/connections.js';
import { AgentExecutor } from '../services/executor.js';
import { CheckRecorder } from '../services/quality.js';
import { DeploymentService, IncidentService, MonitoringService } from '../services/deploy.js';
import { company, type CompanyPolicies } from '../db/schema.js';
import { DEFAULT_POLICIES } from '../org/definition.js';
import { config } from '../config.js';

export interface Services {
  db: DB; bus: EventBus; audit: AuditService; org: OrganizationService; approvals: ApprovalService; guard: WorkflowGuard;
  tasks: TaskService; projects: ProjectService; git: GitService; artifacts: ArtifactService; decisions: DecisionService;
  meetings: MeetingService; messages: MessageService; memory: MemoryService; notify: NotificationService;
  kiro: KiroRuntimeManager; secrets: SecretStore; fallback: FallbackConnections; executor: AgentExecutor;
  checks: CheckRecorder; deploy: DeploymentService; incidents: IncidentService; monitoring: MonitoringService;
  policies: () => CompanyPolicies; reloadPolicies: () => Promise<CompanyPolicies>;
}

export async function buildServices(db: DB, opts: { kiro?: KiroRuntimeManager } = {}): Promise<Services> {
  let cached: CompanyPolicies = DEFAULT_POLICIES;
  const reloadPolicies = async () => {
    const c = (await db.select().from(company).limit(1))[0];
    cached = c ? { ...DEFAULT_POLICIES, ...c.policies, limits: { ...DEFAULT_POLICIES.limits, ...c.policies.limits }, kiro: { ...DEFAULT_POLICIES.kiro, ...c.policies.kiro } } : DEFAULT_POLICIES;
    return cached;
  };
  await reloadPolicies();
  const bus = new EventBus(db);
  const audit = new AuditService(db);
  const org = new OrganizationService(db);
  const notify = new NotificationService(db, bus);
  const approvals = new ApprovalService(db, bus, audit, org, notify);
  const guard = new WorkflowGuard(db, approvals);
  const tasks = new TaskService(db, bus, audit, org, guard);
  const git = new GitService();
  const memory = new MemoryService(db);
  const projects = new ProjectService(db, bus, audit, org, git, guard, approvals, tasks, memory);
  const kiro = opts.kiro ?? new KiroRuntimeManager({ cliPath: config.kiroCliPath, kiroHome: config.kiroHome, runtimeCwd: config.kiroRuntimeCwd, settings: () => cached.kiro });
  const secrets = new SecretStore(db);
  const fallback = new FallbackConnections(db, secrets);
  const executor = new AgentExecutor(db, bus, audit, kiro, fallback, org, approvals);
  const incidents = new IncidentService(db, bus, notify);
  return {
    db, bus, audit, org, approvals, guard, tasks, projects, git, memory, notify, kiro, secrets, fallback, executor, incidents,
    artifacts: new ArtifactService(db, bus), decisions: new DecisionService(db, bus), meetings: new MeetingService(db, bus), messages: new MessageService(db),
    checks: new CheckRecorder(db, bus), deploy: new DeploymentService(db, bus, audit, git, notify), monitoring: new MonitoringService(db, bus, incidents),
    policies: () => cached, reloadPolicies,
  };
}
