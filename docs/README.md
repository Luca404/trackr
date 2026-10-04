# Trackr documentation

Reviewed on 2026-10-04 for main release 1.0.41. Multicurrency remains deferred on the separate development branch.

| Document | Purpose |
| --- | --- |
| [Project README](../README.md) | Features, Node 22 setup, environment variables, checks and deployment |
| [Developer notes](../CLAUDE.md) | Current architecture, roles, session/cache behavior and financial RPC conventions |
| [Shared database workflow](../supabase/README.md) | Applied migration history, local/remote distinction, isolated tests and future grants |
| [Security fixes and release verification](security-fixes-2026-10-04.md) | Published commits, applied SQL, CI and production checks |
| [Known issues](known-issues.md) | Remaining issues and items requiring reproduction |
| [Improvements backlog](future-improvements.md) | Remaining product/integration work and completed milestones |
| [Change log](code-changes.md) | Changes by date, including the 1.0.41 security release |

[The original security audit](security-audit-2026-10-04.md) records the state before the fixes. Files in `superpowers/specs/` and `superpowers/plans/` are historical proposals, not instructions to replay SQL or deploy missing multicurrency features. Current schema and permissions are defined by the versioned applied migrations.
