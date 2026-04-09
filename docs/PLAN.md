# Plan

Current work in `ariaflow-web` is a contract-governance migration, not a
feature sprint. The goal is to make the frontend's backend assumptions
explicit, machine-checked, and reviewable.

## Current migration

- Move BGS decision detail out of `BGS.md` into `docs/bgs-decision.yaml`.
- Treat `docs/ucc-declarations.yaml` as the canonical declaration for:
  endpoint coverage, action coverage, expected preferences, and known-unused
  backend fields.
- Add frontend-owned JSON schemas under `docs/schemas/` for the subset of
  backend response shapes the UI actually consumes.
- Add tests that verify:
  mock fixtures match the frontend schemas,
  frontend schemas are a subset of backend OpenAPI,
  the UCC declaration artifact is well-formed,
  the BGS claim passes the local validator.

## Next steps

- Run and stabilize the new test set:
  `tests/test_api_response_shapes.py`
  `tests/test_openapi_alignment.py`
  `tests/test_ucc_declarations_schema.py`
  `tests/test_bgs_compliance.py`
  `tests/test_bgs_sha_drift.py`
  plus the existing contract tests in `tests/test_api_params.py` and
  `tests/test_coverage_check.py`.
- Verify that the new docs and tests are internally consistent:
  `BGS.md`, `docs/bgs-decision.yaml`, `docs/ucc-declarations.yaml`,
  `docs/schemas/`, `.pre-commit-config.yaml`.
- Decide whether the migration lands as one commit series now or is dropped
  entirely. The partial state is the only bad state.

## Open items

- **No CI enforcement for BGS compliance.** The validator depends on the
  private `../BGSPrivate` sibling checkout, so this currently runs only
  locally and via pre-commit.
- **No schema oracle for `/api/events` yet.** SSE uses `text/event-stream`,
  so it needs a different test strategy than the JSON endpoints.
- **Pinned BGS SHAs must be maintained manually.** `tests/test_bgs_sha_drift.py`
  warns when `docs/bgs-decision.yaml` lags behind `../BGSPrivate/bgs`.

## Header / tabs separation refactor — DONE

Completed: index.html split into `_fragments/header.html` + 7 `tab_*.html`
files. `webapp.py` expands `<!--INCLUDE:-->` markers at startup. Timer model
replaced with `LOADERS` manifest (per-tab `{fn, k}` entries, cadence = `k * R`).
`_refreshAll` / `_refreshTabOnly` handle init / navigateTo / visibility resume /
backend switch. Material-style nav tabs with per-tab badges. CSS unified to
xs/sm/md/lg/xl token scale + 7 design axes (emphasis, status, shape, state,
elevation, density, breakpoint).

## Cross-platform installation

### Target state

| Platform | Install ariaflow-web | Install ariaflow (backend) | aria2 dependency | Effort |
|---|---|---|---|---|
| All | `pipx install ariaflow-web` (PyPI) | `pipx install ariaflow` (PyPI) | User's job | Low |
| macOS | `brew install ariaflow-web` | `brew install ariaflow` | Handled by brew | Done |
| Windows | `pipx install ariaflow-web` now, winget later | `winget install aria2` + pipx | winget install aria2 | Low now, moderate later |
| Linux | `pipx install ariaflow-web` | `pipx install ariaflow` | `apt install aria2` / `dnf install aria2` | Low |

### Current state

- **ariaflow (backend)**: ✅ already on PyPI, has `ariaflow` console script,
  brew formula, and twine upload in CI.
- **ariaflow-web (frontend)**: ⚠️ has `ariaflow-web` console script and brew
  formula, but **no PyPI publishing** in the release workflow.

### Steps

1. **Add PyPI publishing to `ariaflow-web` release workflow.**
   The backend's `.github/workflows/release.yml` already has a working
   `twine upload` step with `PYPI_TOKEN`. Mirror that pattern:
   - `python -m build --sdist`
   - `python -m twine upload dist/*`
   - Requires `PYPI_TOKEN` secret configured on the GitHub repo.

2. **Add `ariaflow` as a Python dependency in `pyproject.toml`.**
   The Homebrew formula already declares `depends_on "ariaflow"` but
   `pyproject.toml` has an empty `dependencies = []`. Adding
   `dependencies = ["ariaflow"]` means `pipx install ariaflow-web`
   automatically pulls the backend too — matching the brew behavior.
   If the backend is optional (user might point at a remote backend),
   make it an extra: `[project.optional-dependencies] local = ["ariaflow"]`.

3. **Verify `pipx install ariaflow-web` works end-to-end.**
   After step 1 ships, test on a clean venv:
   - `pipx install ariaflow-web`
   - `ariaflow-web` starts the dashboard
   - Dashboard connects to a local or remote ariaflow backend
   - All tabs render, timers run, SSE connects.

4. **Document platform-specific aria2 installation.**
   aria2 is a system dependency, not a Python package. The user must install
   it separately. Add a section to README.md:
   - macOS: `brew install aria2` (or handled by `brew install ariaflow`)
   - Linux: `apt install aria2` / `dnf install aria2` / `pacman -S aria2`
   - Windows: download from https://aria2.github.io or `winget install aria2`

5. **(Future) winget package for Windows.**
   Create a winget manifest for ariaflow-web. This requires a `.exe` or
   `.msi` installer, which means either:
   - PyInstaller / Nuitka single-file build in CI, or
   - An MSI wrapper around the Python package.
   Low priority — `pipx install` works on Windows today.

6. **(Future) Verify `brew install ariaflow-web` on Linux.**
   Homebrew/Linuxbrew works on Linux. The existing formula may work
   out of the box. Test and document if it does.

## Deferred

- **Mock fixtures (DEFAULT_STATUS etc.) → YAML.** Not worth the churn.
- **Generated `BGS.md`.** Too small to justify generation.
- **BGS Grade-2 style profiles/policies.** No clear value for this repo.
