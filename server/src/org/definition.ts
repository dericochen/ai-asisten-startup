import type { CompanyPolicies, RoleCapabilities, RoleLevel } from '../db/schema.js';

export const AUTHORITY: Record<RoleLevel, number> = {
  OWNER: 100, CEO: 90, CSUITE: 80, DIRECTOR: 70, MANAGER: 60, LEAD: 50, SENIOR: 40, SPECIALIST: 30, JUNIOR: 20, TEMP: 10,
};

export const DEPARTMENTS = [
  { key: 'executive', name: 'Executive Office', floor: 'Executive Floor', description: 'CEO, C-suite and Chief of Staff. Sets direction, approves stage gates, protects the Owner from operational noise.' },
  { key: 'research', name: 'Research', floor: 'Research Floor', description: 'User, market, competitor and technology research with independent critique and fact checking.' },
  { key: 'product', name: 'Product', floor: 'Product Floor', description: 'Problem definition, MVP scope, requirements, acceptance criteria and prioritisation.' },
  { key: 'design', name: 'Design', floor: 'Design Studio', description: 'UX flows, UI system, responsive behaviour and accessibility. Design precedes implementation.' },
  { key: 'architecture', name: 'Architecture', floor: 'Engineering Floor', description: 'System, data and cloud architecture with ADRs and independent architecture review.' },
  { key: 'engineering', name: 'Engineering', floor: 'Engineering Floor', description: 'Frontend, backend, database, integration, AI and platform engineering plus code review.' },
  { key: 'qa', name: 'Quality Assurance', floor: 'QA Lab', description: 'Functional, API, UI, regression and edge-case testing against acceptance criteria.' },
  { key: 'security', name: 'Security', floor: 'Security Operations', description: 'Application security review, dependency audit, secret scanning and red-team review.' },
  { key: 'devops', name: 'DevOps & SRE', floor: 'Operations Center', description: 'Builds, releases, staging and production deployment, monitoring and incident response.' },
  { key: 'audit', name: 'Internal Audit', floor: 'Executive Floor', description: 'Independent audit of projects, code and security posture.' },
] as const;

const READ: RoleCapabilities = { tools: ['read', 'glob', 'grep'], canWriteCode: false, canShell: false, canWeb: false };
const RESEARCH: RoleCapabilities = { tools: ['read', 'glob', 'grep', 'web_search', 'web_fetch'], canWriteCode: false, canShell: false, canWeb: true };
const REVIEW: RoleCapabilities = { tools: ['read', 'glob', 'grep', 'code'], canWriteCode: false, canShell: false, canWeb: false };
const ENGINEER: RoleCapabilities = { tools: ['read', 'write', 'shell', 'glob', 'grep', 'code'], canWriteCode: true, canShell: true, canWeb: false };
const TESTER: RoleCapabilities = { tools: ['read', 'glob', 'grep', 'code', 'shell'], canWriteCode: false, canShell: true, canWeb: false };

export interface RoleDef {
  key: string; title: string; level: RoleLevel; dept: string; reportsTo: string | null; count: number;
  responsibilities: string; caps: RoleCapabilities;
}

export const ROLES: RoleDef[] = [
  // Executive
  { key: 'ceo', title: 'Chief Executive Officer', level: 'CEO', dept: 'executive', reportsTo: null, count: 1, caps: READ, responsibilities: 'Interprets Owner goals, creates projects, delegates to departments, reviews major outputs against evidence, approves stage gates, escalates to the Owner only when required, and reports progress.' },
  { key: 'chief-of-staff', title: 'Chief of Staff', level: 'CSUITE', dept: 'executive', reportsTo: 'ceo', count: 1, caps: READ, responsibilities: 'Coordinates executive priorities, prepares summaries and tracks cross-department commitments.' },
  { key: 'coo', title: 'Chief Operating Officer', level: 'CSUITE', dept: 'executive', reportsTo: 'ceo', count: 1, caps: READ, responsibilities: 'Owns delivery operations, schedules and resourcing across projects.' },
  { key: 'cto', title: 'Chief Technology Officer', level: 'CSUITE', dept: 'executive', reportsTo: 'ceo', count: 1, caps: REVIEW, responsibilities: 'Owns technical direction; approves architecture; final escalation point for engineering failures.' },
  { key: 'cpo', title: 'Chief Product Officer', level: 'CSUITE', dept: 'executive', reportsTo: 'ceo', count: 1, caps: READ, responsibilities: 'Owns product strategy and scope decisions.' },
  { key: 'cdo', title: 'Chief Design Officer', level: 'CSUITE', dept: 'executive', reportsTo: 'ceo', count: 1, caps: READ, responsibilities: 'Owns design quality and the design system.' },
  { key: 'ciso', title: 'Chief Information Security Officer', level: 'CSUITE', dept: 'executive', reportsTo: 'ceo', count: 1, caps: REVIEW, responsibilities: 'Owns security posture and production security sign-off.' },
  { key: 'cqo', title: 'Chief Quality Officer', level: 'CSUITE', dept: 'executive', reportsTo: 'ceo', count: 1, caps: READ, responsibilities: 'Owns quality standards and release quality bar.' },
  // Research
  { key: 'research-director', title: 'Research Director', level: 'DIRECTOR', dept: 'research', reportsTo: 'ceo', count: 1, caps: RESEARCH, responsibilities: 'Frames research questions, assigns researchers and signs off research quality.' },
  { key: 'user-researcher', title: 'User Researcher', level: 'SENIOR', dept: 'research', reportsTo: 'research-director', count: 2, caps: RESEARCH, responsibilities: 'Researches target users, their jobs-to-be-done, pain points and behaviours.' },
  { key: 'market-researcher', title: 'Market Researcher', level: 'SENIOR', dept: 'research', reportsTo: 'research-director', count: 1, caps: RESEARCH, responsibilities: 'Researches market size, segments, pricing and business models.' },
  { key: 'competitor-researcher', title: 'Competitor Researcher', level: 'SENIOR', dept: 'research', reportsTo: 'research-director', count: 2, caps: RESEARCH, responsibilities: 'Analyses competing products, features, positioning and gaps.' },
  { key: 'technical-researcher', title: 'Technology Researcher', level: 'SENIOR', dept: 'research', reportsTo: 'research-director', count: 1, caps: RESEARCH, responsibilities: 'Researches technical approaches, platforms and feasibility.' },
  { key: 'data-researcher', title: 'Data Researcher', level: 'SPECIALIST', dept: 'research', reportsTo: 'research-director', count: 1, caps: RESEARCH, responsibilities: 'Finds and validates quantitative data supporting research claims.' },
  { key: 'fact-checker', title: 'Fact Checker', level: 'SPECIALIST', dept: 'research', reportsTo: 'research-director', count: 1, caps: RESEARCH, responsibilities: 'Verifies claims and sources in research findings; never fact-checks own work.' },
  { key: 'research-critic', title: 'Research Critic', level: 'SENIOR', dept: 'research', reportsTo: 'research-director', count: 1, caps: RESEARCH, responsibilities: 'Challenges assumptions, weak evidence and gaps in research findings.' },
  { key: 'devils-advocate', title: "Devil's Advocate", level: 'SPECIALIST', dept: 'research', reportsTo: 'research-director', count: 1, caps: READ, responsibilities: 'Argues the strongest case against the emerging conclusion.' },
  { key: 'research-synthesizer', title: 'Research Synthesizer', level: 'SENIOR', dept: 'research', reportsTo: 'research-director', count: 1, caps: READ, responsibilities: 'Synthesises findings and critique into a decision-ready research report.' },
  // Product
  { key: 'product-director', title: 'Product Director', level: 'DIRECTOR', dept: 'product', reportsTo: 'cpo', count: 1, caps: READ, responsibilities: 'Leads product planning across projects.' },
  { key: 'product-manager', title: 'Product Manager', level: 'MANAGER', dept: 'product', reportsTo: 'product-director', count: 2, caps: READ, responsibilities: 'Defines problem, users, MVP scope, features, requirements and acceptance criteria.' },
  { key: 'business-analyst', title: 'Business Analyst', level: 'SENIOR', dept: 'product', reportsTo: 'product-director', count: 1, caps: READ, responsibilities: 'Defines business rules, data entities and process flows.' },
  { key: 'requirements-analyst', title: 'Requirements Analyst', level: 'SPECIALIST', dept: 'product', reportsTo: 'product-director', count: 1, caps: READ, responsibilities: 'Turns features into testable requirements.' },
  { key: 'feature-strategist', title: 'Feature Strategist', level: 'SPECIALIST', dept: 'product', reportsTo: 'product-director', count: 1, caps: READ, responsibilities: 'Prioritises features by value and effort.' },
  { key: 'user-journey-analyst', title: 'User Journey Analyst', level: 'SPECIALIST', dept: 'product', reportsTo: 'product-director', count: 1, caps: READ, responsibilities: 'Maps end-to-end user journeys.' },
  { key: 'product-critic', title: 'Product Critic', level: 'SENIOR', dept: 'product', reportsTo: 'product-director', count: 1, caps: READ, responsibilities: 'Challenges scope, value and feasibility of the PRD.' },
  { key: 'mvp-analyst', title: 'MVP Analyst', level: 'SPECIALIST', dept: 'product', reportsTo: 'product-director', count: 1, caps: READ, responsibilities: 'Cuts scope to the smallest valuable release.' },
  { key: 'product-reviewer', title: 'Product Reviewer', level: 'LEAD', dept: 'product', reportsTo: 'product-director', count: 1, caps: READ, responsibilities: 'Reviews product deliverables for completeness.' },
  // Design
  { key: 'design-director', title: 'Design Director', level: 'DIRECTOR', dept: 'design', reportsTo: 'cdo', count: 1, caps: READ, responsibilities: 'Leads design delivery and design reviews.' },
  { key: 'ux-lead', title: 'UX Lead', level: 'LEAD', dept: 'design', reportsTo: 'design-director', count: 1, caps: READ, responsibilities: 'Leads UX architecture and flows.' },
  { key: 'ux-designer', title: 'UX Designer', level: 'SENIOR', dept: 'design', reportsTo: 'ux-lead', count: 2, caps: READ, responsibilities: 'Designs information architecture, flows, screens, states and interactions.' },
  { key: 'ui-lead', title: 'UI Lead', level: 'LEAD', dept: 'design', reportsTo: 'design-director', count: 1, caps: READ, responsibilities: 'Leads visual design and components.' },
  { key: 'ui-designer', title: 'UI Designer', level: 'SENIOR', dept: 'design', reportsTo: 'ui-lead', count: 2, caps: READ, responsibilities: 'Defines visual language, design tokens and component specs.' },
  { key: 'interaction-designer', title: 'Interaction Designer', level: 'SPECIALIST', dept: 'design', reportsTo: 'ux-lead', count: 1, caps: READ, responsibilities: 'Specifies interaction patterns and micro-interactions.' },
  { key: 'responsive-specialist', title: 'Responsive Specialist', level: 'SPECIALIST', dept: 'design', reportsTo: 'ui-lead', count: 1, caps: READ, responsibilities: 'Specifies responsive layouts for mobile, tablet and desktop.' },
  { key: 'accessibility-specialist', title: 'Accessibility Specialist', level: 'SPECIALIST', dept: 'design', reportsTo: 'design-director', count: 1, caps: READ, responsibilities: 'Ensures WCAG 2.2 AA compliance in designs.' },
  { key: 'design-system-specialist', title: 'Design System Specialist', level: 'SPECIALIST', dept: 'design', reportsTo: 'ui-lead', count: 1, caps: READ, responsibilities: 'Maintains the design system.' },
  { key: 'design-critic', title: 'Design Critic', level: 'SENIOR', dept: 'design', reportsTo: 'design-director', count: 1, caps: READ, responsibilities: 'Independently critiques designs for usability, consistency and accessibility.' },
  { key: 'design-qa', title: 'Design QA', level: 'SPECIALIST', dept: 'design', reportsTo: 'design-director', count: 1, caps: READ, responsibilities: 'Verifies implementation matches design.' },
  // Architecture
  { key: 'software-architect', title: 'Software Architect', level: 'LEAD', dept: 'architecture', reportsTo: 'cto', count: 2, caps: REVIEW, responsibilities: 'Designs system architecture, chooses the stack, writes ADRs and the engineering work breakdown.' },
  { key: 'backend-architect', title: 'Backend Architect', level: 'LEAD', dept: 'architecture', reportsTo: 'cto', count: 1, caps: REVIEW, responsibilities: 'Designs APIs and service boundaries.' },
  { key: 'data-architect', title: 'Data Architect', level: 'LEAD', dept: 'architecture', reportsTo: 'cto', count: 1, caps: REVIEW, responsibilities: 'Designs data models and storage.' },
  { key: 'cloud-architect', title: 'Cloud Architect', level: 'LEAD', dept: 'architecture', reportsTo: 'cto', count: 1, caps: REVIEW, responsibilities: 'Designs deployment topology and environments.' },
  { key: 'architecture-reviewer', title: 'Architecture Critic', level: 'LEAD', dept: 'architecture', reportsTo: 'cto', count: 1, caps: REVIEW, responsibilities: 'Independently reviews architecture for risk, complexity and security; never reviews own design.' },
  // Engineering
  { key: 'vp-engineering', title: 'VP Engineering', level: 'DIRECTOR', dept: 'engineering', reportsTo: 'cto', count: 1, caps: REVIEW, responsibilities: 'Leads engineering delivery.' },
  { key: 'engineering-manager', title: 'Engineering Manager', level: 'MANAGER', dept: 'engineering', reportsTo: 'vp-engineering', count: 1, caps: REVIEW, responsibilities: 'Plans and tracks engineering work; receives escalations from leads.' },
  { key: 'frontend-lead', title: 'Frontend Lead', level: 'LEAD', dept: 'engineering', reportsTo: 'engineering-manager', count: 1, caps: ENGINEER, responsibilities: 'Leads frontend implementation; first escalation for frontend failures.' },
  { key: 'frontend-engineer', title: 'Frontend Engineer', level: 'SENIOR', dept: 'engineering', reportsTo: 'frontend-lead', count: 4, caps: ENGINEER, responsibilities: 'Implements responsive, accessible UI according to the approved design.' },
  { key: 'backend-lead', title: 'Backend Lead', level: 'LEAD', dept: 'engineering', reportsTo: 'engineering-manager', count: 1, caps: ENGINEER, responsibilities: 'Leads backend implementation; scaffolds repositories; first escalation for backend failures.' },
  { key: 'backend-engineer', title: 'Backend Engineer', level: 'SENIOR', dept: 'engineering', reportsTo: 'backend-lead', count: 4, caps: ENGINEER, responsibilities: 'Implements APIs, business logic, persistence and tests.' },
  { key: 'database-lead', title: 'Database Lead', level: 'LEAD', dept: 'engineering', reportsTo: 'engineering-manager', count: 1, caps: ENGINEER, responsibilities: 'Leads schema and migration work.' },
  { key: 'database-engineer', title: 'Database Engineer', level: 'SENIOR', dept: 'engineering', reportsTo: 'database-lead', count: 2, caps: ENGINEER, responsibilities: 'Implements schemas, migrations and queries.' },
  { key: 'integration-engineer', title: 'Integration Engineer', level: 'SENIOR', dept: 'engineering', reportsTo: 'engineering-manager', count: 2, caps: ENGINEER, responsibilities: 'Integrates frontend and backend; resolves merge and integration failures.' },
  { key: 'ai-engineer', title: 'AI Engineer', level: 'SENIOR', dept: 'engineering', reportsTo: 'engineering-manager', count: 2, caps: ENGINEER, responsibilities: 'Implements AI-enabled features.' },
  { key: 'platform-engineer', title: 'Platform Engineer', level: 'SENIOR', dept: 'engineering', reportsTo: 'engineering-manager', count: 2, caps: ENGINEER, responsibilities: 'Builds tooling, scripts and build pipelines.' },
  { key: 'performance-engineer', title: 'Performance Engineer', level: 'SPECIALIST', dept: 'engineering', reportsTo: 'engineering-manager', count: 1, caps: ENGINEER, responsibilities: 'Profiles and optimises performance.' },
  { key: 'code-reviewer', title: 'Code Reviewer', level: 'LEAD', dept: 'engineering', reportsTo: 'engineering-manager', count: 2, caps: REVIEW, responsibilities: 'Independently reviews diffs for correctness, security and maintainability; never reviews own code.' },
  { key: 'junior-engineer', title: 'Junior Engineer', level: 'JUNIOR', dept: 'engineering', reportsTo: 'engineering-manager', count: 2, caps: ENGINEER, responsibilities: 'Implements small, well-specified changes.' },
  { key: 'temp-contractor', title: 'Temporary Contractor', level: 'TEMP', dept: 'engineering', reportsTo: 'engineering-manager', count: 2, caps: ENGINEER, responsibilities: 'Handles overflow tasks under supervision.' },
  // QA
  { key: 'qa-director', title: 'QA Director', level: 'DIRECTOR', dept: 'qa', reportsTo: 'cqo', count: 1, caps: TESTER, responsibilities: 'Owns QA strategy and sign-off.' },
  { key: 'qa-lead', title: 'QA Lead', level: 'LEAD', dept: 'qa', reportsTo: 'qa-director', count: 1, caps: TESTER, responsibilities: 'Plans test coverage against acceptance criteria and writes the QA report.' },
  { key: 'functional-qa', title: 'Functional QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 2, caps: TESTER, responsibilities: 'Tests features against acceptance criteria.' },
  { key: 'ui-qa', title: 'UI QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Tests UI behaviour and states.' },
  { key: 'responsive-qa', title: 'Responsive QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Tests mobile and desktop layouts.' },
  { key: 'api-qa', title: 'API QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 2, caps: TESTER, responsibilities: 'Tests API contracts, status codes and error handling.' },
  { key: 'database-qa', title: 'Database QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Tests migrations and data integrity.' },
  { key: 'integration-qa', title: 'Integration QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Tests end-to-end integration.' },
  { key: 'regression-qa', title: 'Regression QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Guards against regressions.' },
  { key: 'browser-qa', title: 'Browser QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Runs browser-level smoke tests.' },
  { key: 'accessibility-qa', title: 'Accessibility QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Tests accessibility.' },
  { key: 'edge-case-tester', title: 'Edge Case Tester', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Probes boundary conditions and invalid input.' },
  { key: 'performance-qa', title: 'Performance QA Engineer', level: 'SPECIALIST', dept: 'qa', reportsTo: 'qa-lead', count: 1, caps: TESTER, responsibilities: 'Measures response times.' },
  // Security
  { key: 'security-lead', title: 'Security Lead', level: 'LEAD', dept: 'security', reportsTo: 'ciso', count: 1, caps: REVIEW, responsibilities: 'Leads security reviews and signs off security gates.' },
  { key: 'appsec-engineer', title: 'Application Security Engineer', level: 'SENIOR', dept: 'security', reportsTo: 'security-lead', count: 2, caps: REVIEW, responsibilities: 'Reviews code for OWASP Top 10 issues: access control, injection, XSS, CSRF, secrets, headers.' },
  { key: 'dependency-auditor', title: 'Dependency Auditor', level: 'SPECIALIST', dept: 'security', reportsTo: 'security-lead', count: 1, caps: REVIEW, responsibilities: 'Audits third-party dependencies.' },
  { key: 'red-team', title: 'Red Team Engineer', level: 'SENIOR', dept: 'security', reportsTo: 'security-lead', count: 2, caps: TESTER, responsibilities: 'Attempts to break the application; independent of implementers.' },
  { key: 'security-auditor', title: 'Security Auditor', level: 'SENIOR', dept: 'audit', reportsTo: 'ciso', count: 1, caps: REVIEW, responsibilities: 'Audits security posture independently.' },
  // DevOps
  { key: 'devops-director', title: 'DevOps Director', level: 'DIRECTOR', dept: 'devops', reportsTo: 'cto', count: 1, caps: READ, responsibilities: 'Owns build, release and production operations.' },
  { key: 'devops-lead', title: 'DevOps Lead', level: 'LEAD', dept: 'devops', reportsTo: 'devops-director', count: 1, caps: READ, responsibilities: 'Leads deployment automation.' },
  { key: 'cicd-engineer', title: 'CI/CD Engineer', level: 'SENIOR', dept: 'devops', reportsTo: 'devops-lead', count: 1, caps: READ, responsibilities: 'Maintains build pipelines.' },
  { key: 'cloud-engineer', title: 'Cloud Engineer', level: 'SENIOR', dept: 'devops', reportsTo: 'devops-lead', count: 2, caps: READ, responsibilities: 'Operates hosting environments.' },
  { key: 'release-manager', title: 'Release Manager', level: 'MANAGER', dept: 'devops', reportsTo: 'devops-director', count: 1, caps: READ, responsibilities: 'Creates release candidates, chairs the release board and writes release notes.' },
  { key: 'monitoring-engineer', title: 'Monitoring Engineer', level: 'SPECIALIST', dept: 'devops', reportsTo: 'devops-lead', count: 1, caps: READ, responsibilities: 'Operates uptime and error monitoring.' },
  { key: 'sre', title: 'Site Reliability Engineer', level: 'SENIOR', dept: 'devops', reportsTo: 'devops-director', count: 2, caps: READ, responsibilities: 'Owns production reliability, rollback and incident mitigation.' },
  { key: 'incident-manager', title: 'Incident Manager', level: 'LEAD', dept: 'devops', reportsTo: 'devops-director', count: 1, caps: READ, responsibilities: 'Coordinates incident response and postmortems.' },
  // Audit
  { key: 'project-auditor', title: 'Project Auditor', level: 'SENIOR', dept: 'audit', reportsTo: 'ceo', count: 1, caps: READ, responsibilities: 'Audits project process compliance.' },
  { key: 'code-auditor', title: 'Code Auditor', level: 'SENIOR', dept: 'audit', reportsTo: 'cto', count: 1, caps: REVIEW, responsibilities: 'Audits code quality independently.' },
];

export const DEFAULT_POLICIES: CompanyPolicies = {
  gateApprover: 'OWNER',
  deploymentMode: 'OWNER_APPROVAL',
  fallbackMode: 'ASK_OWNER',
  fallbackEnabled: false,
  limits: { maxResearchRounds: 2, maxReviewRounds: 2, maxAgentRetries: 2, maxTaskRevisions: 2, maxFixAttempts: 2 },
  kiro: { poolSize: 4, turnTimeoutMs: 25 * 60 * 1000, dailyCreditSoftLimit: 0, nearLimitRatio: 0.8, limitCooldownMs: 15 * 60 * 1000 },
  research: { researcherCount: 3 },
  monitoring: { intervalMs: 30_000, samplesBeforeComplete: 3 },
  requireOwnerAcceptance: false,
};

export function agentProfileName(roleKey: string): string {
  return `aco-${roleKey}`;
}
