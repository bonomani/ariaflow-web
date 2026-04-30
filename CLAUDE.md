# Directives Claude Code - ariaflow-dashboard (frontend)

Read `AGENTS.md` at session start for full agent instructions (boundaries,
gap reporting rules, testing policy, BGS governance).

## Quick reference
- **This repo:** `ariaflow-dashboard` (frontend)
- **Paired repo:** `../ariaflow-server` (backend) — read-only except gaps file
- **Gaps:** `FRONTEND_GAPS.md` (local) + `../ariaflow-server/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md` (paired)
- **Verify:** `make verify` (drift + tests) — run before committing
- **CI gate:** `make ci` (verify + lint + format) — run before pushing
