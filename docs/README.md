# Trackr documentation

Updated on 2026-10-08 for version 1.0.43, which adds early investment loading and a mobile portfolio overview. The release was pushed to main and the user confirmed the new view works. Render keepalive has been implemented through an independent Supabase cron; see its runbook for operational verification. Backend computation/caching remain follow-ups; multicurrency remains deferred on the separate development branch.

| Document | Purpose |
| --- | --- |
| [Project README](../README.md) | Features, Node 22 setup, environment variables, checks and deployment |
| [Developer notes](../CLAUDE.md) | Current architecture, roles, session/cache behavior and financial RPC conventions |
| [Shared database workflow](../supabase/README.md) | Applied migration history, local/remote distinction, isolated tests and future grants |
| [Security fixes and release verification](security-fixes-2026-10-04.md) | Published commits, applied SQL, CI and production checks |
| [Investment loading and portfolio overview](investments-1.0.43.md) | Published release, recap/detail loading order, cache/refresh behavior, checks and remaining latency |
| [Render keepalive](render-keepalive.md) | Scheduled health ping, deployment/HTTP verification and pause/remove commands |
| [Known issues](known-issues.md) | Remaining issues and items requiring reproduction |
| [Improvements backlog](future-improvements.md) | Backend recap/cache follow-up, remaining product/integration work and completed milestones |
| [Change log](code-changes.md) | Changes by date, including the 1.0.43 investment update, 1.0.42 Render correction and 1.0.41 security release |

[The original security audit](security-audit-2026-10-04.md) records the state before the fixes. Files in `superpowers/specs/` and `superpowers/plans/` are historical proposals, not instructions to replay SQL or deploy missing multicurrency features. Current schema and permissions are defined by the versioned applied migrations.
