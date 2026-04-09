# ariaflow-dashboard Plan

## Done (history in git)

- Contract-governance migration (BGS, UCC, schemas, alignment tests).
- Header / tabs separation refactor (fragment includes, LOADERS manifest, CSS tokens).
- Cross-platform installation (PyPI, optional `[local]` dep, per-platform aria2 docs).
- Rename to ariaflow-dashboard (module, package, CLI, UI, GitHub repo, Homebrew formula).

## Open gaps

| Gap | Status | Notes |
|---|---|---|
| FE-18 | Deferred | SSE smoke test — add when/if payload drift causes a regression |
| FE-21 | Resolved | Bonjour service type fixed |
| FE-22 | Blocked by BG-15 | Fallback to `/api/peers` when local mDNS unavailable (WSL, containers) |

Resolved gaps (BG-12–14, FE-15–20) — see git history and `FRONTEND_GAPS.md`.

## Done (cont.)

- Governance alignment: Makefile (`check-drift`, `verify`, `ci` targets),
  `scripts/check_bgs_drift.py`, `.github/workflows/test.yml` (CI gate),
  BGS files moved to `docs/governance/`.

## Deferred

- **Mock fixtures (DEFAULT_STATUS etc.) → YAML.** Not worth the churn.
- **Generated `BGS.md`.** Too small to justify generation.
- **BGS Grade-2 style profiles/policies.** No clear value for this repo.
