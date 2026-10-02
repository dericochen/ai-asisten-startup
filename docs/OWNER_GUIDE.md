# Owner guide

## Starting the company

1. `kiro-cli login` (once).
2. `npm start` in the repository, then open http://localhost:3000.
3. The first run opens the setup wizard: company, your Owner account, Kiro detection, deployment and fallback policies, launch.

## Giving direction

Use **Ask CEO** on the Overview or CEO Office page:

- "CEO, build a booking website for barbershops. Research the market, design it, build it, test it, deploy it, and only contact me for major decisions."
- "How far is PRJ-003?" / "Why is it blocked?"
- "Pause PRJ-002." / "Approve APR-007." / "Reject the design and tell them to make it simpler."
- "Remember: all products must support dark mode." (stored as a standing directive)

The CEO answers from live company data and acts only through validated actions (create, pause or resume a project, decide an approval on your explicit instruction, record a directive). It cannot skip stages or change your policies.

## What reaches you

You are notified only for: approvals that require the Owner, escalations after loop limits, Kiro limits and fallback requests, production incidents, and project completion. Everything else is in the project timeline, audit log and Live Office.

## Approvals

The Approval Center shows each request with reason, evidence (links to artifacts), impact, risks, alternatives, cost and recommendation. **Approve**, **Request revision** (with guidance) or **Reject**. You can also decide CEO/CTO gates yourself; your authority (100) overrides theirs. Every decision is recorded.

Approvals that wait for you by default:

- **Production deploy** (deployment policy OWNER APPROVAL)
- **Fallback usage** (fallback mode ASK OWNER)
- **Escalations** (a gate after review rounds are exhausted, or a fix loop that failed repeatedly)

## Knowing where a project is

The project page shows overall progress, the current phase, the progress of every stage with an explanation, the next gate's requirements (met or not), who is working now, blockers with downstream impact, health signals, releases with per-gate results, and production probes.

## Policies (Settings and AI Runtime)

Deployment mode, loop limits, parallel researchers, monitoring interval, Kiro pool size, daily Kiro credit budget, fallback on/off and mode, and fallback connections (keys stored encrypted and shown masked).

## Generated apps

Each project's code lives in `data/workspaces/<PRJ>/repo` (git, with `main`, `develop` and `agent/*` branches). Staging runs at `http://localhost:43NN` and production at `http://localhost:45NN` (NN = project number) while the company OS is running.
