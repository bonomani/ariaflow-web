# Plan

## Done (history in git)

- Contract-governance migration (BGS, UCC, schemas, alignment tests).
- Header / tabs separation refactor (fragment includes, LOADERS manifest, CSS tokens).

## Cross-platform installation — DONE

PyPI publishing, optional `[local]` dependency, and per-platform aria2 docs
are all in place. Remaining future items:

- **(Future) winget package for Windows.** Low priority — `pipx install` works today.
- **(Future) Verify `brew install ariaflow-dashboard` on Linux.** Homebrew/Linuxbrew may work out of the box.

## Open gaps

| Gap | Status | Notes |
|---|---|---|
| FE-18 | Deferred | SSE smoke test — add when/if payload drift causes a regression |

Resolved gaps (BG-12–14, FE-15–20) — see git history and `FRONTEND_GAPS.md`.

## Rename: ariaflow-web → ariaflow-dashboard — DONE

All code, docs, URLs, schemas, and scripts renamed. Remaining external steps:

- `gh repo rename ariaflow-dashboard -R bonomani/ariaflow-web`
- `git remote set-url origin https://github.com/bonomani/ariaflow-dashboard.git`
- Homebrew tap: `Formula/ariaflow-web.rb` → `Formula/ariaflow-dashboard.rb`
- PyPI: register `ariaflow-dashboard`; yank or redirect old `ariaflow-web`

## Deferred

- **Mock fixtures (DEFAULT_STATUS etc.) → YAML.** Not worth the churn.
- **Generated `BGS.md`.** Too small to justify generation.
- **BGS Grade-2 style profiles/policies.** No clear value for this repo.
