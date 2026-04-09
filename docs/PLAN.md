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

## Gap resolution plan

### BG-12: Remove `/api/sessions/new` — backend action needed
- **Owner:** backend agent (separate session in `../ariaflow`).
- **Step 1:** Commit the BG-12 entry already written in
  `../ariaflow/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md`.
- **Step 2:** Backend removes route, handler, OpenAPI entry, discovery
  entry, and tests for `/api/sessions/new`.
- **Step 3:** Frontend removes `DELIBERATELY_UNUSED` workaround in
  `tests/test_api_params.py`.
- **Priority:** low. No functional impact.

### BG-13 (to file): WSL download-dir detection
- **Owner:** backend.
- **Problem:** On WSL, aria2 downloads to the Linux filesystem by default.
  Files are slow to access from Windows Explorer (`\\wsl$\...`).
- **Desired:** Backend detects WSL (`/proc/version` contains "microsoft")
  and defaults download dir to `/mnt/c/Users/$USER/Downloads` so files
  land on the Windows filesystem and are accessible from both sides.
- **Frontend impact:** None — download dir is a backend config. Dashboard
  could show a hint ("WSL detected — downloads go to Windows filesystem")
  but that's cosmetic.
- **Blocks local gap:** (none).
- **Priority:** medium — quality-of-life for WSL users.

### BG-14 (to file): Expose archivable count or criteria
- **Owner:** backend.
- **Problem:** Frontend enables the Archive button when `sumDone > 0 ||
  sumError > 0`, but backend `cleanup()` applies extra rules
  (`max_done_age_days: 7`, `max_done_count: 100`). User clicks Archive,
  gets "0 archived" — confusing.
- **Desired:** Either:
  (a) Backend exposes an `archivable_count` field on `/api/status` so the
  frontend can disable the button when nothing is actually archivable, or
  (b) Backend documents the cleanup criteria in the OpenAPI spec so the
  frontend can replicate the logic locally.
- **Blocks local gap:** FE-20.
- **Priority:** low.

### FE-20 (to file): Archive button enabled with nothing archivable
- **Owner:** frontend.
- **Problem:** `canArchive` (app.js) only checks `sumDone > 0 || sumError > 0`
  — doesn't know about the 7-day age threshold the backend enforces.
- **Blocked by:** BG-14 (need the backend to expose archivable count or
  document criteria).
- **Workaround available:** After a cleanup returns "0 archived", disable
  the button until the next status refresh changes the counts. Not ideal
  but prevents repeated clicks.
- **Priority:** low.

### FE-17: No CI enforcement for BGS compliance
- **Owner:** frontend.
- **Resolution path:** Accept local-only enforcement as a permanent
  limitation. The validator depends on `../BGSPrivate` which is private
  and can't be cloned in CI without exposing credentials. Document this
  in `BGS.md` as a known limitation. Close FE-17 as "won't fix — by
  design" and remove it from the open section.
- **Priority:** low — no regression risk, pre-commit catches it locally.

### FE-18: No schema/test oracle for `/api/events` (SSE)
- **Owner:** frontend.
- **Resolution path:** Add a lightweight SSE integration test that
  connects to `/api/events`, receives at least one `status` event, and
  validates the JSON payload against `docs/schemas/api-status.schema.json`.
  Requires a running backend (mark test `@pytest.mark.slow`).
  Alternatively, defer permanently if SSE payloads haven't caused
  regressions.
- **Priority:** low — no regressions reported yet.

### FE-19: Manual BGS SHA maintenance
- **Owner:** frontend.
- **Resolution path:** The drift test (`test_bgs_sha_drift.py`) already
  warns. Promote it to a hard failure only when actively working on BGS
  updates; otherwise keep the warning. No code change needed — this is
  a workflow decision, not a bug. Close as "accepted — warning is
  sufficient" and move to resolved.
- **Priority:** low.

### Action summary

| Gap | Next action | Who | Effort |
|---|---|---|---|
| BG-12 | Commit gap file, then backend removes endpoint | backend session | low |
| BG-13 | File gap, backend implements WSL detection | file now, backend later | medium |
| BG-14 | File gap, backend exposes archivable count | file now, backend later | low |
| FE-20 | File gap, blocked by BG-14 | file now, implement after BG-14 | low |
| FE-17 | Close as won't-fix, document limitation | frontend now | trivial |
| FE-18 | Defer or add SSE smoke test | frontend later | low |
| FE-19 | Close as accepted | frontend now | trivial |

## Rename: ariaflow-web → ariaflow-dashboard

Full rebrand of package, module, CLI, UI, and all references.

### Package & build
- `pyproject.toml` — name, entry point, package-data key
- Rename directory `src/ariaflow_web/` → `src/ariaflow_dashboard/`

### CLI
- `cli.py` — `prog=` and version string

### UI
- `static/index.html` — `<title>`
- `static/_fragments/header.html` — `<h1>`

### Source code
- `action_log.py` — env var `ARIAFLOW_WEB_LOG` → `ARIAFLOW_DASHBOARD_LOG`,
  default filename, `"source"` field
- `webapp.py` — `"source"` field

### JSON schemas (24 files)
- `docs/schemas/*.schema.json` — all `$id` URLs: `bonomani/ariaflow-web` →
  `bonomani/ariaflow-dashboard`
- `docs/schemas/ucc-declarations.schema.json` — title and description

### Documentation
- `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `ACTIONS.md`,
  `CLAUDE.md`, `BGS.md`, `RELEASE.md`, `docs/PLAN.md`,
  `docs/bgs-decision.yaml`, `docs/ucc-declarations.yaml`

### GitHub workflows
- `.github/workflows/release.yml` — commit messages, formula paths,
  artifact names

### Scripts
- `scripts/homebrew_formula.py` — URL and name references
- `scripts/publish.py` — `REPO` constant and path references
- `scripts/gen_spec.py` — source paths and title

### Tests (all imports and path references)
- `test_cli.py`, `test_web.py`, `test_buttons.py`, `conftest.py`,
  `test_static_serving.py`, `test_download_lifecycle.py`,
  `test_api_params.py`, `test_coverage_check.py`, `test_quality.py`,
  `test_homebrew_formula.py`

### Homebrew tap (bonomani/homebrew-ariaflow)
- `Formula/ariaflow-web.rb` → `Formula/ariaflow-dashboard.rb`
- Update all references in formula and workflow

### Notes
- Module rename `ariaflow_web` → `ariaflow_dashboard` is the most invasive
  change — every import in every file.
- Env var `ARIAFLOW_WEB_LOG` → `ARIAFLOW_DASHBOARD_LOG` may break existing
  deployments — document the migration.
- Coordinate with the Homebrew tap for the formula rename.
- PyPI: a new package name means a fresh PyPI project (`ariaflow-dashboard`).
  The old `ariaflow-web` package can be yanked or left with a final version
  that depends on `ariaflow-dashboard` as a redirect.

## Deferred

- **Mock fixtures (DEFAULT_STATUS etc.) → YAML.** Not worth the churn.
- **Generated `BGS.md`.** Too small to justify generation.
- **BGS Grade-2 style profiles/policies.** No clear value for this repo.
