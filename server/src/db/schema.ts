/**
 * PostgreSQL schema — the authoritative source of truth for company state.
 * Kiro conversations are never treated as state; every state change lands here
 * through a service that validates authority and workflow rules.
 */
import {
  pgTable, text, integer, uuid, timestamp, jsonb, boolean, doublePrecision, bigserial, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ───────────────────────────── Company & Owner ─────────────────────────────

export const company = pgTable('company', {
  id: id(),
  name: text('name').notNull(),
  mission: text('mission').notNull().default(''),
  /** Owner policies: deployment mode, fallback mode, loop limits, Kiro pool, notification policy. */
  policies: jsonb('policies').$type<CompanyPolicies>().notNull(),
  setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const owners = pgTable('owners', {
  id: id(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const ownerSessions = pgTable('owner_sessions', {
  id: text('id').primaryKey(), // sha256 of the session token; raw token only lives in the cookie
  ownerId: uuid('owner_id').notNull().references(() => owners.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// ───────────────────────────── Organization ─────────────────────────────

export const departments = pgTable('departments', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  floor: text('floor').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  title: text('title').notNull(),
  level: text('level').$type<RoleLevel>().notNull(),
  /** Authority is derived from level and can only be changed by the Owner. */
  authority: integer('authority').notNull(),
  departmentKey: text('department_key').notNull().references(() => departments.key),
  reportsTo: text('reports_to'),
  kiroAgent: text('kiro_agent').notNull(),
  responsibilities: text('responsibilities').notNull().default(''),
  capabilities: jsonb('capabilities').$type<RoleCapabilities>().notNull(),
});

export const employees = pgTable('employees', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  roleKey: text('role_key').notNull().references(() => roles.key),
  departmentKey: text('department_key').notNull().references(() => departments.key),
  managerId: uuid('manager_id'),
  status: text('status').$type<EmployeeStatus>().notNull().default('IDLE'),
  currentTaskId: uuid('current_task_id'),
  currentActivity: text('current_activity'),
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('employees_role_idx').on(t.roleKey), index('employees_status_idx').on(t.status)]);

// ───────────────────────────── Projects & Tasks ─────────────────────────────

export const projects = pgTable('projects', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  objective: text('objective').notNull(),
  description: text('description').notNull().default(''),
  type: text('type').notNull().default('FULL_STACK_APP'),
  status: text('status').$type<ProjectStatus>().notNull().default('ACTIVE'),
  phase: text('phase').$type<Phase>().notNull().default('INTAKE'),
  priority: text('priority').$type<Priority>().notNull().default('MEDIUM'),
  scope: text('scope').notNull().default(''),
  budget: text('budget'),
  deadline: timestamp('deadline', { withTimezone: true }),
  risk: text('risk').$type<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>().notNull().default('LOW'),
  progress: integer('progress').notNull().default(0),
  ceoSponsorId: uuid('ceo_sponsor_id'),
  projectManagerId: uuid('project_manager_id'),
  departments: jsonb('departments').$type<string[]>().notNull().default([]),
  workspacePath: text('workspace_path'),
  repositoryUrl: text('repository_url'),
  defaultBranch: text('default_branch').notNull().default('main'),
  deployment: jsonb('deployment').$type<ProjectDeploymentConfig>().notNull(),
  productionUrl: text('production_url'),
  stagingUrl: text('staging_url'),
  /** Per-project loop counters (research rounds, review rounds, ...) — enforced by the workflow engine. */
  counters: jsonb('counters').$type<Record<string, number>>().notNull().default({}),
  ownerRequest: text('owner_request').notNull().default(''),
  isDemo: boolean('is_demo').notNull().default(false),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tasks = pgTable('tasks', {
  id: id(),
  code: text('code').notNull().unique(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  phase: text('phase').$type<Phase>(),
  stage: text('stage').notNull(), // workflow stage key, e.g. research.investigate
  departmentKey: text('department_key').notNull(),
  roleKey: text('role_key').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<TaskStatus>().notNull().default('BACKLOG'),
  priority: text('priority').$type<Priority>().notNull().default('MEDIUM'),
  assigneeId: uuid('assignee_id'),
  reviewerId: uuid('reviewer_id'),
  dependsOn: jsonb('depends_on').$type<string[]>().notNull().default([]),
  steps: jsonb('steps').$type<TaskStep[]>().notNull().default([]),
  progress: integer('progress').notNull().default(0),
  round: integer('round').notNull().default(1),
  attempts: integer('attempts').notNull().default(0),
  blockedReason: text('blocked_reason'),
  runtime: text('runtime').$type<'KIRO' | 'FALLBACK' | 'SYSTEM' | null>(),
  costCredits: doublePrecision('cost_credits').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  branch: text('branch'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
  result: jsonb('result').$type<Record<string, unknown>>(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('tasks_project_idx').on(t.projectId), index('tasks_status_idx').on(t.status)]);

// ───────────────────────────── Runtime (Kiro + fallback) ─────────────────────────────

export const agentRuns = pgTable('agent_runs', {
  id: id(),
  taskId: uuid('task_id'),
  projectId: uuid('project_id'),
  employeeId: uuid('employee_id'),
  runtime: text('runtime').$type<'KIRO' | 'FALLBACK'>().notNull(),
  provider: text('provider').notNull(), // 'kiro-cli' or connection name
  model: text('model'),
  agentProfile: text('agent_profile'),
  kiroSessionId: text('kiro_session_id'),
  workerId: integer('worker_id'),
  status: text('status').$type<RunStatus>().notNull().default('QUEUED'),
  errorClass: text('error_class'),
  errorMessage: text('error_message'),
  fallbackReason: text('fallback_reason'),
  prompt: text('prompt').notNull(),
  output: text('output').notNull().default(''),
  toolCalls: integer('tool_calls').notNull().default(0),
  credits: doublePrecision('credits').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  costEstimated: boolean('cost_estimated').notNull().default(true),
  durationMs: integer('duration_ms'),
  attempt: integer('attempt').notNull().default(1),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('runs_task_idx').on(t.taskId), index('runs_status_idx').on(t.status), index('runs_created_idx').on(t.createdAt)]);

export const toolCalls = pgTable('tool_calls', {
  id: id(),
  runId: uuid('run_id').notNull(),
  toolCallId: text('tool_call_id').notNull(),
  toolName: text('tool_name').notNull(),
  title: text('title').notNull().default(''),
  status: text('status').notNull().default('pending'),
  decision: text('decision').$type<'ALLOWED' | 'DENIED' | 'AUTO'>().notNull().default('AUTO'),
  reason: text('reason'),
  input: jsonb('input'),
  createdAt: createdAt(),
}, (t) => [index('tool_calls_run_idx').on(t.runId)]);

export const providerConnections = pgTable('provider_connections', {
  id: id(),
  name: text('name').notNull(),
  provider: text('provider').$type<FallbackProvider>().notNull(),
  secretId: uuid('secret_id'),
  baseUrl: text('base_url'),
  model: text('model').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  priority: integer('priority').notNull().default(1),
  health: text('health').notNull().default('UNKNOWN'),
  healthMessage: text('health_message'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  models: jsonb('models').$type<string[]>().notNull().default([]),
  costInputPerMTok: doublePrecision('cost_input_per_mtok'),
  costOutputPerMTok: doublePrecision('cost_output_per_mtok'),
  createdAt: createdAt(),
});

export const secrets = pgTable('secrets', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  masked: text('masked').notNull(),
  createdAt: createdAt(),
});

// ───────────────────────────── Governance ─────────────────────────────

export const approvals = pgTable('approvals', {
  id: id(),
  code: text('code').notNull().unique(),
  projectId: uuid('project_id'),
  taskId: uuid('task_id'),
  gate: text('gate').$type<Gate>().notNull(),
  title: text('title').notNull(),
  requestedById: uuid('requested_by_id'),
  approverRole: text('approver_role').notNull(), // OWNER | ceo | cto ...
  requiredAuthority: integer('required_authority').notNull(),
  status: text('status').$type<ApprovalStatus>().notNull().default('PENDING'),
  reason: text('reason').notNull().default(''),
  evidence: jsonb('evidence').$type<Evidence[]>().notNull().default([]),
  alternatives: text('alternatives').notNull().default(''),
  risks: text('risks').notNull().default(''),
  impact: text('impact').notNull().default(''),
  cost: text('cost').notNull().default(''),
  recommendation: text('recommendation').notNull().default(''),
  decidedBy: text('decided_by'),
  decidedByName: text('decided_by_name'),
  decidedByAuthority: integer('decided_by_authority'),
  decisionNote: text('decision_note'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index('approvals_project_idx').on(t.projectId), index('approvals_status_idx').on(t.status)]);

export const artifacts = pgTable('artifacts', {
  id: id(),
  projectId: uuid('project_id'),
  taskId: uuid('task_id'),
  kind: text('kind').$type<ArtifactKind>().notNull(),
  title: text('title').notNull(),
  version: integer('version').notNull().default(1),
  format: text('format').notNull().default('markdown'),
  content: text('content').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>(),
  authorId: uuid('author_id'),
  createdAt: createdAt(),
}, (t) => [index('artifacts_project_idx').on(t.projectId), uniqueIndex('artifacts_version_uq').on(t.projectId, t.kind, t.title, t.version)]);

export const decisions = pgTable('decisions', {
  id: id(),
  code: text('code').notNull().unique(),
  projectId: uuid('project_id'),
  title: text('title').notNull(),
  decision: text('decision').notNull(),
  reason: text('reason').notNull().default(''),
  proposedBy: text('proposed_by').notNull(),
  reviewedBy: jsonb('reviewed_by').$type<string[]>().notNull().default([]),
  approvedBy: text('approved_by'),
  status: text('status').notNull().default('ACCEPTED'),
  createdAt: createdAt(),
});

export const meetings = pgTable('meetings', {
  id: id(),
  projectId: uuid('project_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  participants: jsonb('participants').$type<string[]>().notNull().default([]),
  agenda: jsonb('agenda').$type<string[]>().notNull().default([]),
  positions: jsonb('positions').$type<{ who: string; position: string }[]>().notNull().default([]),
  evidence: jsonb('evidence').$type<string[]>().notNull().default([]),
  objections: jsonb('objections').$type<string[]>().notNull().default([]),
  decision: text('decision').notNull().default(''),
  actionItems: jsonb('action_items').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const messages = pgTable('messages', {
  id: id(),
  projectId: uuid('project_id'),
  fromEmployeeId: uuid('from_employee_id'),
  toEmployeeId: uuid('to_employee_id'),
  type: text('type').$type<MessageType>().notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull().default(''),
  taskId: uuid('task_id'),
  createdAt: createdAt(),
}, (t) => [index('messages_project_idx').on(t.projectId)]);

export const ceoMessages = pgTable('ceo_messages', {
  id: id(),
  role: text('role').$type<'OWNER' | 'CEO'>().notNull(),
  content: text('content').notNull(),
  status: text('status').$type<'PENDING' | 'DONE' | 'FAILED'>().notNull().default('DONE'),
  actions: jsonb('actions').$type<Record<string, unknown>[]>().notNull().default([]),
  runId: uuid('run_id'),
  createdAt: createdAt(),
});

export const memories = pgTable('memories', {
  id: id(),
  scope: text('scope').$type<'COMPANY' | 'PROJECT' | 'EMPLOYEE'>().notNull(),
  projectId: uuid('project_id'),
  employeeId: uuid('employee_id'),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
}, (t) => [index('memories_project_idx').on(t.projectId)]);

export const notifications = pgTable('notifications', {
  id: id(),
  projectId: uuid('project_id'),
  category: text('category').notNull(),
  severity: text('severity').$type<'INFO' | 'WARNING' | 'CRITICAL'>().notNull().default('INFO'),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ───────────────────────────── Quality, Release, Production ─────────────────────────────

export const checkRuns = pgTable('check_runs', {
  id: id(),
  projectId: uuid('project_id').notNull(),
  taskId: uuid('task_id'),
  releaseId: uuid('release_id'),
  suite: text('suite').notNull(), // QA | SECURITY | PERFORMANCE | STAGING | PRODUCTION
  name: text('name').notNull(),
  status: text('status').$type<CheckStatus>().notNull(),
  details: text('details').notNull().default(''),
  durationMs: integer('duration_ms'),
  createdAt: createdAt(),
}, (t) => [index('checks_project_idx').on(t.projectId)]);

export const releases = pgTable('releases', {
  id: id(),
  projectId: uuid('project_id').notNull(),
  version: text('version').notNull(),
  commit: text('commit').notNull(),
  status: text('status').$type<ReleaseStatus>().notNull().default('CANDIDATE'),
  notes: text('notes').notNull().default(''),
  gates: jsonb('gates').$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const deployments = pgTable('deployments', {
  id: id(),
  projectId: uuid('project_id').notNull(),
  releaseId: uuid('release_id').notNull(),
  environment: text('environment').$type<'STAGING' | 'PRODUCTION'>().notNull(),
  provider: text('provider').notNull(),
  status: text('status').$type<DeploymentStatus>().notNull().default('PENDING'),
  url: text('url'),
  commit: text('commit').notNull(),
  path: text('path'),
  port: integer('port'),
  log: text('log').notNull().default(''),
  rollbackOfId: uuid('rollback_of_id'),
  active: boolean('active').notNull().default(false),
  startedAt: createdAt(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const monitorSamples = pgTable('monitor_samples', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  projectId: uuid('project_id').notNull(),
  environment: text('environment').notNull(),
  url: text('url').notNull(),
  ok: boolean('ok').notNull(),
  httpStatus: integer('http_status'),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [index('monitor_project_idx').on(t.projectId, t.createdAt)]);

export const incidents = pgTable('incidents', {
  id: id(),
  code: text('code').notNull().unique(),
  projectId: uuid('project_id'),
  severity: text('severity').$type<'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'>().notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<'OPEN' | 'MITIGATING' | 'RESOLVED'>().notNull().default('OPEN'),
  timeline: jsonb('timeline').$type<{ at: string; note: string }[]>().notNull().default([]),
  postmortem: text('postmortem'),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

// ───────────────────────────── Events & Audit ─────────────────────────────

export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),
  projectId: uuid('project_id'),
  taskId: uuid('task_id'),
  employeeId: uuid('employee_id'),
  message: text('message').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index('events_project_idx').on(t.projectId, t.id)]);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorType: text('actor_type').$type<'OWNER' | 'AGENT' | 'SYSTEM'>().notNull(),
  actorId: text('actor_id'),
  actorName: text('actor_name'),
  action: text('action').notNull(),
  target: text('target'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index('audit_created_idx').on(t.createdAt)]);

export const counters = pgTable('counters', {
  key: text('key').primaryKey(),
  value: integer('value').notNull().default(0),
});

// ───────────────────────────── Shared types ─────────────────────────────

export type RoleLevel = 'OWNER' | 'CEO' | 'CSUITE' | 'DIRECTOR' | 'MANAGER' | 'LEAD' | 'SENIOR' | 'SPECIALIST' | 'JUNIOR' | 'TEMP';
export type EmployeeStatus = 'IDLE' | 'WORKING' | 'WAITING' | 'REVIEWING' | 'BLOCKED' | 'OFFLINE';
export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TaskStatus = 'BACKLOG' | 'READY' | 'WORKING' | 'REVIEW' | 'QA' | 'BLOCKED' | 'DONE' | 'FAILED' | 'CANCELLED';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'AWAITING_FALLBACK_APPROVAL' | 'PAUSED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUESTED' | 'CANCELLED';
export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
export type ReleaseStatus = 'CANDIDATE' | 'STAGING' | 'STAGING_PASSED' | 'STAGING_FAILED' | 'APPROVED' | 'DEPLOYING' | 'HEALTHY' | 'DEGRADED' | 'ROLLED_BACK' | 'FAILED';
export type DeploymentStatus = 'PENDING' | 'BUILDING' | 'RUNNING' | 'HEALTHY' | 'UNHEALTHY' | 'FAILED' | 'STOPPED' | 'ROLLED_BACK';
export type FallbackProvider = 'OPENROUTER' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OPENAI_COMPATIBLE' | 'OLLAMA';
export type MessageType = 'REPORT' | 'TASK' | 'QUESTION' | 'REVIEW_REQUEST' | 'APPROVAL_REQUEST' | 'BLOCKER' | 'ESCALATION' | 'DECISION' | 'INCIDENT';
export type ArtifactKind = 'RESEARCH_BRIEF' | 'RESEARCH_FINDINGS' | 'RESEARCH_CRITIQUE' | 'RESEARCH_REPORT' | 'PRD' | 'PRODUCT_REVIEW' | 'DESIGN_DOC' | 'DESIGN_REVIEW' | 'ARCHITECTURE_DOC' | 'ARCHITECTURE_REVIEW' | 'ADR' | 'CODE_REVIEW' | 'QA_REPORT' | 'SECURITY_REPORT' | 'RELEASE_NOTES' | 'RELEASE_REPORT' | 'COMPLETION_REPORT' | 'POSTMORTEM' | 'EXECUTIVE_REVIEW' | 'ENGINEERING_REPORT';
export type Gate = 'RESEARCH' | 'PRODUCT' | 'DESIGN' | 'ARCHITECTURE' | 'RELEASE' | 'PRODUCTION_DEPLOY' | 'FALLBACK_USAGE' | 'DESTRUCTIVE_ACTION' | 'ESCALATION';
export type Phase =
  | 'INTAKE' | 'DISCOVERY' | 'RESEARCH' | 'PRODUCT_PLANNING' | 'FEATURE_DEFINITION' | 'DESIGN' | 'ARCHITECTURE'
  | 'DEVELOPMENT' | 'INTEGRATION' | 'CODE_REVIEW' | 'QA' | 'SECURITY' | 'PERFORMANCE_TEST' | 'DEPLOYMENT_PREPARATION'
  | 'STAGING' | 'STAGING_VALIDATION' | 'RELEASE_REVIEW' | 'OWNER_APPROVAL' | 'PRODUCTION_DEPLOYMENT'
  | 'PRODUCTION_VALIDATION' | 'MONITORING' | 'MAINTENANCE' | 'COMPLETED';

export interface TaskStep { key: string; label: string; status: 'PENDING' | 'ACTIVE' | 'DONE' | 'FAILED' | 'SKIPPED' }
export interface Evidence { label: string; kind: 'artifact' | 'check' | 'task' | 'text' | 'url'; ref?: string; status?: string }

export interface RoleCapabilities {
  tools: string[];          // Kiro tools available to the agent profile
  canWriteCode: boolean;    // may write files inside its assigned workspace
  canShell: boolean;        // may run (policy-checked) shell commands inside its workspace
  canWeb: boolean;          // may use web_search / web_fetch
}

export type DeploymentMode = 'MANUAL' | 'CEO_APPROVAL' | 'OWNER_APPROVAL' | 'AUTO_AFTER_CHECKS';
export type FallbackMode = 'AUTO' | 'ASK_OWNER' | 'DISABLED';

export interface CompanyPolicies {
  /** Who decides stage gates (research, product, design, architecture, release): the Owner directly, or CEO/CTO agents. */
  gateApprover: 'OWNER' | 'EXECUTIVES';
  deploymentMode: DeploymentMode;
  fallbackMode: FallbackMode;
  fallbackEnabled: boolean;
  limits: { maxResearchRounds: number; maxReviewRounds: number; maxAgentRetries: number; maxTaskRevisions: number; maxFixAttempts: number };
  kiro: { poolSize: number; turnTimeoutMs: number; dailyCreditSoftLimit: number; nearLimitRatio: number; limitCooldownMs: number };
  research: { researcherCount: number };
  monitoring: { intervalMs: number; samplesBeforeComplete: number };
  requireOwnerAcceptance: boolean;
}

export interface ProjectDeploymentConfig {
  provider: 'LOCAL_PROCESS' | 'COMMAND';
  stagingPort?: number;
  productionPort?: number;
  buildScript?: string;
  startScript?: string;
  healthPath: string;
  routes: string[];
  apiChecks?: { method: string; path: string; body?: unknown; expectStatus: number; name?: string }[];
  commandDeploy?: { staging?: string; production?: string; stagingUrl?: string; productionUrl?: string; rollback?: string };
  envSecretIds?: Record<string, string>;
}
