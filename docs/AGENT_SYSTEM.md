# Agent system

## Organization

`org/definition.ts` defines 10 departments, 85 roles and 111 employees (the number of employees per role is configurable in code). Authority comes from the role level and can only be changed by editing the definition (the Owner). Agents have no API to change roles or authority.

| Level | Authority | Examples |
|---|---|---|
| Owner | 100 | the human |
| CEO | 90 | CEO |
| C-suite | 80 | CTO, CPO, COO, CDO, CISO, CQO, Chief of Staff |
| Director | 70 | Research Director, Design Director, VP Engineering, QA Director, DevOps Director |
| Manager | 60 | Product Manager, Engineering Manager, Release Manager |
| Team lead | 50 | Frontend/Backend Lead, Software Architect, Code Reviewer, QA Lead, Security Lead |
| Senior | 40 | Researchers, designers, engineers, AppSec, SRE |
| Specialist | 30 | Fact Checker, QA engineers, Dependency Auditor |
| Junior / Temp | 20 / 10 | Junior Engineer, Temporary Contractor |

## Employees → Kiro agents

Each role maps to a Kiro custom agent profile `aco-<role>` (`kiro/agents.ts`) with a role description, working standards and a tool list:

| Capability set | Tools | Example roles |
|---|---|---|
| Read | read, glob, grep | CEO, product, design, DevOps |
| Research | + web_search, web_fetch | research department |
| Review | + code | CTO, architects, code reviewers, AppSec |
| Tester | + shell (policy-checked) | QA, red team |
| Engineer | read, write, shell, glob, grep, code | engineering roles |

Employees are not processes. A task picks an employee (`OrganizationService.pick`: idle first, then least recently active, honouring exclusions), and the executor runs that employee's profile on a pooled Kiro worker with the task's workspace as `cwd`.

## Independence

- Research critic and fact checker exclude all research authors; the synthesizer excludes them too.
- Product, design and architecture critics exclude the author; gate reviewers exclude the author.
- The code reviewer, QA lead and AppSec reviewer exclude every employee who authored engineering work on the project.
- `ApprovalService` refuses a decision by the requester.

## Structured communication

Agents never mutate state. Each stage prompt ends with a strict output contract (Markdown deliverable plus one fenced JSON block). The platform parses the JSON (with one repair turn in the same Kiro session if it is missing) and records artifacts (versioned), check runs, approval decisions, meetings and decisions. Agent-to-agent messages are typed (`REPORT`, `TASK`, `BLOCKER`, `ESCALATION`, `INCIDENT`, …) and stored in `messages`.

## Memory

`MemoryService` stores Owner directives, company rules, decisions, architecture and lessons learned. Retrieval uses Postgres full-text search scoped to the company plus the current project. Only the top matches (6 by default) are injected into a prompt, never the whole memory.
