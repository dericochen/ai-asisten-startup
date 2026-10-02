import type { Gate, Phase } from '../db/schema.js';

export const PHASES: { key: Phase; label: string; group: string }[] = [
  { key: 'INTAKE', label: 'Intake', group: 'Planning' },
  { key: 'DISCOVERY', label: 'Discovery', group: 'Research' },
  { key: 'RESEARCH', label: 'Research', group: 'Research' },
  { key: 'PRODUCT_PLANNING', label: 'Product Planning', group: 'Product Planning' },
  { key: 'FEATURE_DEFINITION', label: 'Feature Definition', group: 'Product Planning' },
  { key: 'DESIGN', label: 'Design', group: 'Design' },
  { key: 'ARCHITECTURE', label: 'Architecture', group: 'Architecture' },
  { key: 'DEVELOPMENT', label: 'Development', group: 'Engineering' },
  { key: 'INTEGRATION', label: 'Integration', group: 'Engineering' },
  { key: 'CODE_REVIEW', label: 'Code Review', group: 'Code Review' },
  { key: 'QA', label: 'QA', group: 'QA' },
  { key: 'SECURITY', label: 'Security', group: 'Security' },
  { key: 'PERFORMANCE_TEST', label: 'Performance Test', group: 'QA' },
  { key: 'DEPLOYMENT_PREPARATION', label: 'Deployment Preparation', group: 'Deployment' },
  { key: 'STAGING', label: 'Staging', group: 'Deployment' },
  { key: 'STAGING_VALIDATION', label: 'Staging Validation', group: 'Deployment' },
  { key: 'RELEASE_REVIEW', label: 'Release Review', group: 'Deployment' },
  { key: 'OWNER_APPROVAL', label: 'Owner Approval', group: 'Deployment' },
  { key: 'PRODUCTION_DEPLOYMENT', label: 'Production Deployment', group: 'Production' },
  { key: 'PRODUCTION_VALIDATION', label: 'Production Validation', group: 'Production' },
  { key: 'MONITORING', label: 'Monitoring', group: 'Production' },
  { key: 'MAINTENANCE', label: 'Maintenance', group: 'Production' },
  { key: 'COMPLETED', label: 'Completed', group: 'Production' },
];

export const PHASE_INDEX: Record<Phase, number> = Object.fromEntries(PHASES.map((p, i) => [p.key, i])) as Record<Phase, number>;

export function phaseAtLeast(current: Phase, target: Phase): boolean { return PHASE_INDEX[current] >= PHASE_INDEX[target]; }

/** Progress groups shown on the project dashboard with weights for the overall percentage. */
export const PROGRESS_GROUPS: { key: string; label: string; weight: number; phases: Phase[]; gate?: Gate }[] = [
  { key: 'research', label: 'Research', weight: 10, phases: ['INTAKE', 'DISCOVERY', 'RESEARCH'], gate: 'RESEARCH' },
  { key: 'product', label: 'Product Planning', weight: 8, phases: ['PRODUCT_PLANNING', 'FEATURE_DEFINITION'], gate: 'PRODUCT' },
  { key: 'design', label: 'Design', weight: 10, phases: ['DESIGN'], gate: 'DESIGN' },
  { key: 'architecture', label: 'Architecture', weight: 8, phases: ['ARCHITECTURE'], gate: 'ARCHITECTURE' },
  { key: 'engineering', label: 'Engineering', weight: 28, phases: ['DEVELOPMENT', 'INTEGRATION'] },
  { key: 'review', label: 'Code Review', weight: 5, phases: ['CODE_REVIEW'] },
  { key: 'qa', label: 'QA', weight: 9, phases: ['QA', 'PERFORMANCE_TEST'] },
  { key: 'security', label: 'Security', weight: 6, phases: ['SECURITY'] },
  { key: 'deployment', label: 'Deployment', weight: 9, phases: ['DEPLOYMENT_PREPARATION', 'STAGING', 'STAGING_VALIDATION', 'RELEASE_REVIEW', 'OWNER_APPROVAL'] },
  { key: 'production', label: 'Production', weight: 7, phases: ['PRODUCTION_DEPLOYMENT', 'PRODUCTION_VALIDATION', 'MONITORING', 'MAINTENANCE', 'COMPLETED'] },
];

/**
 * Gate requirements to ENTER a phase. Evaluated by WorkflowGuard against real DB state
 * (approvals, check results, releases). The workflow engine cannot advance a project otherwise.
 */
export type Requirement =
  | { kind: 'approval'; gate: Gate; label: string }
  | { kind: 'checks'; suite: string; label: string }
  | { kind: 'release'; status: string[]; label: string }
  | { kind: 'deployPolicy'; label: string };

export const ENTRY_REQUIREMENTS: Partial<Record<Phase, Requirement[]>> = {
  PRODUCT_PLANNING: [{ kind: 'approval', gate: 'RESEARCH', label: 'Research approved by CEO' }],
  DESIGN: [{ kind: 'approval', gate: 'RESEARCH', label: 'Research approved' }, { kind: 'approval', gate: 'PRODUCT', label: 'Product scope approved by CEO' }],
  ARCHITECTURE: [{ kind: 'approval', gate: 'DESIGN', label: 'Design approved by CEO' }],
  DEVELOPMENT: [
    { kind: 'approval', gate: 'RESEARCH', label: 'Research approved' },
    { kind: 'approval', gate: 'PRODUCT', label: 'Product approved' },
    { kind: 'approval', gate: 'DESIGN', label: 'Design approved by CEO' },
    { kind: 'approval', gate: 'ARCHITECTURE', label: 'Architecture approved by CTO' },
  ],
  QA: [{ kind: 'checks', suite: 'CODE_REVIEW', label: 'Independent code review passed' }],
  SECURITY: [{ kind: 'checks', suite: 'QA', label: 'QA suite passed' }],
  PERFORMANCE_TEST: [{ kind: 'checks', suite: 'SECURITY', label: 'Security review passed' }],
  DEPLOYMENT_PREPARATION: [{ kind: 'checks', suite: 'QA', label: 'QA passed' }, { kind: 'checks', suite: 'SECURITY', label: 'Security passed' }],
  STAGING_VALIDATION: [{ kind: 'release', status: ['STAGING', 'STAGING_PASSED'], label: 'Release deployed to staging' }],
  RELEASE_REVIEW: [{ kind: 'release', status: ['STAGING_PASSED', 'APPROVED'], label: 'Staging validation passed' }],
  OWNER_APPROVAL: [{ kind: 'approval', gate: 'RELEASE', label: 'Release board + CEO approved release' }],
  PRODUCTION_DEPLOYMENT: [
    { kind: 'approval', gate: 'RELEASE', label: 'CEO approved release' },
    { kind: 'release', status: ['STAGING_PASSED', 'APPROVED'], label: 'Staging validation passed' },
    { kind: 'deployPolicy', label: 'Deployment policy satisfied (Owner approval when required)' },
  ],
  COMPLETED: [{ kind: 'checks', suite: 'PRODUCTION', label: 'Production health verified' }],
};

/** Engineering implementation is locked until research, product, design and architecture gates pass. */
export const ENGINEERING_STAGES_PREFIX = 'engineering.';
