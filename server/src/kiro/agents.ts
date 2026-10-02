import fs from 'node:fs';
import path from 'node:path';
import { ROLES, agentProfileName, DEPARTMENTS } from '../org/definition.js';

/**
 * Each company role is a Kiro custom agent profile written to <KIRO_HOME>/agents/aco-<role>.json.
 * The company runs Kiro with KIRO_HOME pointed at data/kiro-home, so these profiles never mix
 * with the Owner's personal agents.
 *
 * Notes from protocol probing (docs/KIRO_RUNTIME.md):
 *  - `allowedTools` is left empty on purpose: every non-trivial tool call is surfaced to the company
 *    backend as session/request_permission and decided by the least-privilege policy engine, then audited.
 *  - Prompts are role descriptions (responsibilities + standards). Per-task output contracts are placed
 *    in the task prompt, which the model follows reliably.
 */
const COMPANY_STANDARDS = [
  'You work inside a software company operating system on behalf of its human Owner.',
  'Company state (projects, approvals, gates) lives in the company database and is updated by the platform, not by you; report your results in the requested format and the platform records them.',
  'Work only inside the current working directory. Never access credentials, secrets, or files outside the workspace.',
  'Be evidence-based: cite sources for factual claims, state uncertainty, and never claim tests or checks passed unless you ran them and saw the output.',
  'Keep deliverables concise, specific and decision-ready. Prefer concrete numbers, examples and acceptance criteria over generic advice.',
].join('\n- ');

export function buildAgentProfile(roleKey: string) {
  const role = ROLES.find((r) => r.key === roleKey);
  if (!role) throw new Error(`Unknown role ${roleKey}`);
  const dept = DEPARTMENTS.find((d) => d.key === role.dept);
  return {
    name: agentProfileName(role.key),
    description: `${role.title} — ${dept?.name ?? role.dept}`,
    prompt: [
      `Role: ${role.title} (${dept?.name ?? role.dept} department).`,
      `Responsibilities: ${role.responsibilities}`,
      '',
      'Working standards:',
      `- ${COMPANY_STANDARDS}`,
      role.caps.canWriteCode ? '- When implementing, write production-quality code with tests, keep changes scoped to your task, and provide tests. Direct shell access is disabled; the platform runs build and tests in Docker after your work. Do not claim they ran until platform evidence is provided.' : '- You do not modify application code; you analyse, review and report.',
    ].join('\n'),
    tools: role.caps.tools.filter((tool) => !/shell|execute/i.test(tool)),
    allowedTools: [] as string[],
  };
}

export function writeAgentProfiles(kiroHome: string): { written: number; dir: string } {
  const dir = path.join(kiroHome, 'agents');
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const r of ROLES) {
    const file = path.join(dir, `${agentProfileName(r.key)}.json`);
    const content = JSON.stringify(buildAgentProfile(r.key), null, 2);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) { fs.writeFileSync(file, content); written++; }
  }
  return { written, dir };
}
