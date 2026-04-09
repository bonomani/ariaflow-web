#!/usr/bin/env python3
"""Generate docs/SPEC.md from the current state of the codebase.

Sources:
  - pyproject.toml
  - src/ariaflow_dashboard/webapp.py
  - src/ariaflow_dashboard/static/{app.js,index.html}
  - docs/ucc-declarations.yaml
  - docs/schemas/api-*.schema.json
  - ACTIONS.md, ARCHITECTURE.md (first paragraph each)
  - docs/governance/BGS.md, docs/governance/bgs-decision.yaml

Usage:
    python3 scripts/gen_spec.py

The "Project goal" section between the BEGIN/END markers in docs/SPEC.md
is preserved across regenerations. Edit it once; never overwritten.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    import tomllib  # py311+
except ModuleNotFoundError:
    import tomli as tomllib  # type: ignore[no-redef]

import yaml

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "ariaflow_dashboard"
STATIC = SRC / "static"
SCHEMAS = ROOT / "docs" / "schemas"
SPEC_OUT = ROOT / "docs" / "SPEC.md"

GOAL_BEGIN = "<!-- BEGIN: project-goal (editable, preserved across regenerations) -->"
GOAL_END = "<!-- END: project-goal -->"
DEFAULT_GOAL = (
    "_TODO: write 1–3 sentences describing what this project is for and who uses it. "
    "This block is preserved across regenerations of `SPEC.md`._"
)


# ---------------------------------------------------------------------------
# Source extractors
# ---------------------------------------------------------------------------


def load_pyproject() -> dict:
    with (ROOT / "pyproject.toml").open("rb") as f:
        return tomllib.load(f)


def extract_frontend_routes() -> tuple[set[str], list[str]]:
    """Return (page paths served by webapp.py, other GET routes)."""
    src = (SRC / "webapp.py").read_text(encoding="utf-8")
    pages: set[str] = set()
    pages_match = re.search(r"path in \{([^}]+)\}", src)
    if pages_match:
        pages = {p.strip().strip('"').strip("'") for p in pages_match.group(1).split(",")}
    routes = sorted(re.findall(r'path == "(/api/[^"]+)"', src))
    return pages, sorted(set(routes))


def extract_fetch_paths() -> list[str]:
    """Every backend endpoint the frontend calls via _fetch()."""
    js = (STATIC / "app.js").read_text(encoding="utf-8")
    paths: set[str] = set()
    for m in re.finditer(r"_fetch\(.*?['\"`](/api[^'\"`$]*)['\"`]", js):
        path = re.sub(r"\$\{[^}]+\}", "{param}", m.group(1)).split("?")[0]
        paths.add(path)
    return sorted(paths)


def extract_action_handlers() -> set[str]:
    """JS function names invoked from inline @click/@change/@input handlers."""
    actions: set[str] = set()
    pattern = re.compile(r'@(?:click|change|input)(?:\.[a-z0-9.]+)?="([^"(]+)\(')
    paths = [STATIC / "index.html", STATIC / "app.js"]
    paths.extend(sorted((STATIC / "_fragments").glob("*.html")))
    for path in paths:
        for m in pattern.finditer(path.read_text(encoding="utf-8")):
            fn = m.group(1).strip()
            if "${" not in fn:
                actions.add(fn)
    return actions


def extract_pages_from_html() -> list[tuple[str, str, str]]:
    """Return [(label, key, url)] for top-level navigation links."""
    html = (STATIC / "_fragments" / "header.html").read_text(encoding="utf-8")
    out: list[tuple[str, str, str]] = []
    pattern = re.compile(
        r'<a\s+href="([^"]+)"[^>]*navigateTo\(\'([^\']+)\'\)[^>]*>([^<]+)</a>'
    )
    for m in pattern.finditer(html):
        url, key, label = m.group(1), m.group(2), m.group(3).strip()
        out.append((label, key, url))
    return out


def load_ucc_declarations() -> dict:
    return yaml.safe_load((ROOT / "docs" / "ucc-declarations.yaml").read_text(encoding="utf-8"))


def load_schemas() -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for p in sorted(SCHEMAS.glob("api-*.schema.json")):
        out.append((p.name, json.loads(p.read_text(encoding="utf-8"))))
    return out


def load_bgs_decision() -> dict:
    return yaml.safe_load((ROOT / "docs" / "governance" / "bgs-decision.yaml").read_text(encoding="utf-8"))


def first_paragraph(path: Path) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")
    lines: list[str] = []
    for line in text.splitlines():
        if line.startswith("#"):
            continue
        if not line.strip() and lines:
            break
        if line.strip():
            lines.append(line.strip())
    return " ".join(lines).strip()


def preserve_goal(existing: str | None) -> str:
    if not existing:
        return DEFAULT_GOAL
    m = re.search(
        re.escape(GOAL_BEGIN) + r"(.*?)" + re.escape(GOAL_END), existing, re.DOTALL
    )
    if not m:
        return DEFAULT_GOAL
    body = m.group(1).strip()
    return body or DEFAULT_GOAL


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------


def render() -> str:
    py = load_pyproject()["project"]
    pages_served, frontend_routes = extract_frontend_routes()
    fetch_paths = extract_fetch_paths()
    handlers = extract_action_handlers()
    nav_pages = extract_pages_from_html()
    ucc = load_ucc_declarations()
    schemas = load_schemas()
    decision = load_bgs_decision()
    actions_md = first_paragraph(ROOT / "ACTIONS.md")
    architecture_md = first_paragraph(ROOT / "ARCHITECTURE.md")

    existing = SPEC_OUT.read_text(encoding="utf-8") if SPEC_OUT.exists() else None
    goal = preserve_goal(existing)

    out: list[str] = []
    add = out.append

    add("# Project Specification — ariaflow-dashboard")
    add("")
    add(
        "_Generated by `scripts/gen_spec.py` from the current state of the "
        "codebase. Do not edit by hand outside the marked sections — run the "
        "script again instead._"
    )
    add("")

    # ---- 1. Identity ----
    add("## 1. Identity")
    add("")
    add(f"- **Name:** `{py['name']}`")
    add(f"- **Version:** `{py['version']}`")
    add(f"- **Description (pyproject):** {py.get('description', '_(none)_')}")
    add(f"- **Python:** `{py.get('requires-python', '_unspecified_')}`")
    if py.get("dependencies"):
        deps = ", ".join(f"`{d}`" for d in py["dependencies"])
        add(f"- **Runtime dependencies:** {deps}")
    else:
        add("- **Runtime dependencies:** _none_ (pure stdlib + bundled static assets)")
    if py.get("scripts"):
        for name, target in py["scripts"].items():
            add(f"- **CLI entry point:** `{name}` → `{target}`")
    add("")

    # ---- 2. Project goal (preserved) ----
    add("## 2. Project goal")
    add("")
    add(GOAL_BEGIN)
    add("")
    add(goal)
    add("")
    add(GOAL_END)
    add("")

    # ---- 3. Architecture ----
    add("## 3. Architecture")
    add("")
    if architecture_md:
        add(architecture_md)
        add("")
    add("**Frontend serves these routes itself** (everything else is proxied to the backend):")
    add("")
    for p in sorted(pages_served):
        add(f"- `GET {p}` — serves `index.html`")
    for r in frontend_routes:
        add(f"- `GET {r}` — frontend-only")
    add("- `GET /static/*` — bundled JS/CSS/icons")
    add("")
    if actions_md:
        add(f"**Interaction model (from ACTIONS.md):** {actions_md}")
        add("")

    # ---- 4. Pages ----
    add("## 4. Pages")
    add("")
    if nav_pages:
        add("| Label | URL | Internal key |")
        add("|---|---|---|")
        for label, key, url in nav_pages:
            add(f"| {label} | `{url}` | `{key}` |")
        add("")
    else:
        add("_No navigation links detected._")
        add("")

    # ---- 5. Backend API consumption ----
    add("## 5. Backend API consumption")
    add("")
    add(
        f"The frontend calls **{len(fetch_paths)} distinct backend endpoint paths** "
        "(parameterized routes collapsed to `{param}`). Each path appears in "
        "`src/ariaflow_dashboard/static/app.js`."
    )
    add("")
    # Extract exact endpoint from each schema's title (e.g. "GET /api/status response (frontend contract)").
    schemas_by_endpoint: dict[str, str] = {}
    title_re = re.compile(r"^(?:GET|POST)\s+(\S+)")
    for fname, schema in schemas:
        m = title_re.match(schema.get("title", ""))
        if m:
            schemas_by_endpoint[m.group(1)] = fname
    coverage = ucc.get("endpoint_coverage", {})
    add("| Endpoint | Schema | Test coverage |")
    add("|---|---|---|")
    for path in fetch_paths:
        schema_name = schemas_by_endpoint.get(path, "")
        # find coverage entry
        cov = ""
        for verb in ("GET", "POST"):
            key = f"{verb} {path}"
            if key in coverage:
                cov = coverage[key]
                break
            # parameterized
            for ck, cv in coverage.items():
                if ck.endswith("{id}/{action}") and "/api/downloads/" in path and "{param}" in path:
                    cov = cv
                    break
                if ck.endswith("{target}/{action}") and "/api/lifecycle/" in path and "{param}" in path:
                    cov = cv
                    break
            if cov:
                break
        schema_cell = f"`{schema_name}`" if schema_name else "—"
        cov_cell = cov if cov else "—"
        add(f"| `{path}` | {schema_cell} | {cov_cell} |")
    add("")

    # ---- 6. Backend response shapes ----
    add("## 6. Backend response shapes (frontend contracts)")
    add("")
    add(
        f"`docs/schemas/` contains **{len(schemas)} JSON Schema documents** describing "
        "the response shapes the frontend depends on. Each schema is validated "
        "against the corresponding mock fixture in `tests/conftest.py` "
        "(`tests/test_api_response_shapes.py`) and cross-checked against the "
        "backend's `openapi.yaml` (`tests/test_openapi_alignment.py`, hard "
        "assertion mode)."
    )
    add("")
    add("| Schema | Endpoint | Top-level required fields |")
    add("|---|---|---|")
    for name, schema in schemas:
        endpoint = schema.get("title", "").split(" response")[0].replace("GET ", "").replace("POST ", "")
        required = ", ".join(f"`{r}`" for r in schema.get("required", [])) or "—"
        add(f"| `{name}` | `{endpoint}` | {required} |")
    add("")

    # ---- 7. UI actions ----
    add("## 7. UI actions")
    add("")
    coverage_map = ucc.get("coverage_map", {})
    add(
        f"`{len(handlers)} action handlers` are wired to inline event listeners "
        f"in `index.html` / `app.js`. The canonical action→test mapping lives in "
        f"`docs/ucc-declarations.yaml` (`coverage_map`, `{len(coverage_map)}` entries) "
        "and is enforced by `tests/test_coverage_check.py` "
        "(`test_all_actions_have_tests`, `test_coverage_map_matches_actions`)."
    )
    add("")
    add("| Handler | Test coverage |")
    add("|---|---|")
    for h in sorted(handlers):
        cov = coverage_map.get(h, "—")
        add(f"| `{h}()` | {cov} |")
    add("")

    # ---- 8. Preferences ----
    add("## 8. User preferences")
    add("")
    prefs = ucc.get("expected_preferences", [])
    add(
        f"The frontend exposes **{len(prefs)} preference controls**, each backed "
        "by a backend declaration field. Verified end-to-end by "
        "`test_every_preference_has_ui_control` in `tests/test_api_params.py`."
    )
    add("")
    for p in prefs:
        add(f"- `{p}`")
    add("")
    known_unused = ucc.get("known_unused", {})
    if known_unused:
        add(
            f"**Backend fields intentionally not consumed** ({len(known_unused)}, "
            "stability-pinned by `test_known_unused_count_is_stable`):"
        )
        add("")
        for field, reason in known_unused.items():
            add(f"- `{field}` — {reason}")
        add("")

    # ---- 9. Governance ----
    add("## 9. Governance — BGS-Verified")
    add("")
    add(
        f"This project claims the **`{decision.get('bgs_slice', '?')}`** slice of "
        "the Boundary Governance Suite. Decision record: "
        "`docs/governance/bgs-decision.yaml`. Validator: "
        "`../BGSPrivate/bgs/tools/check-bgs-compliance.py`."
    )
    add("")
    add(f"- **Pinned BGS ref:** `{decision.get('bgs_version_ref', '?')}`")
    add(f"- **Members used:** {', '.join(decision.get('members_used', [])) or '—'}")
    add(f"- **Last reviewed:** {decision.get('date', decision.get('last_reviewed', '?'))}")
    if decision.get("limitations"):
        add("")
        add("**Limitations:**")
        for lim in decision["limitations"]:
            add(f"- {lim}")
    add("")

    # ---- 10. Test suite ----
    add("## 10. Test suite (entry points)")
    add("")
    test_files = sorted((ROOT / "tests").glob("test_*.py"))
    add(f"`tests/` contains **{len(test_files)} test modules**:")
    add("")
    for t in test_files:
        add(f"- `{t.name}`")
    add("")

    # ---- Footer ----
    add("---")
    add("")
    add(
        "_To regenerate this file: `python3 scripts/gen_spec.py`. "
        "All sections above are derived from the codebase except section 2 "
        "(Project goal), which is preserved verbatim across regenerations._"
    )
    add("")

    return "\n".join(out)


def main() -> int:
    SPEC_OUT.parent.mkdir(exist_ok=True)
    SPEC_OUT.write_text(render(), encoding="utf-8")
    print(f"Wrote {SPEC_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
