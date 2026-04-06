# BGS Entry

project_name: ariaflow-web
bgs_slice: BGS-Verified
decision_id: ariaflow-web-bgs-001
decision_reason: "Frontend has explicit boundary classification (ACTIONS.md), declaration/observation/result test patterns (EXPECTED_ENDPOINTS, EXPECTED_FIELDS), and oracle-based verification (COVERAGE_MAP, field coverage)"
applies_to_scope: "frontend API boundary and UI coverage verification"
bgs_version_ref: bgs@e459816
members_used:
  - BISS
  - UCC
  - TIC
overlays_used: []
member_version_refs:
  ucc: ucc@370c1f7
  tic: tic@7cfba80
external_controls:
  IAM and authorization: not applicable
  sandboxing or runtime isolation: not applicable
  secret and token lifecycle: not applicable
  rate limiting and budget control: not applicable
  privacy and data-boundary control: not applicable
evidence_refs:
  - ./ACTIONS.md
  - ./FRONTEND_GAPS.md
  - ../ariaflow/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md
  - ./ARCHITECTURE.md
  - ./tests/test_api_params.py
  - ./tests/test_coverage_check.py
last_reviewed: 2026-04-05
read_next:
  - "./ACTIONS.md"
  - "./tests/test_api_params.py"
  - "./tests/test_coverage_check.py"
  - "../ariaflow/BGS.md"

## Evidence

### BISS — Boundary interaction classification
- `ACTIONS.md` — complete interaction inventory (34 endpoints, all handlers)
- `FRONTEND_GAPS.md` (local) + `../ariaflow/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md` (authoritative) — boundary gap classification
- `ARCHITECTURE.md` — page-to-endpoint mapping

### UCC — Declaration/observation/result patterns
- `EXPECTED_ENDPOINTS` — declares which backend endpoints the frontend must call
- `EXPECTED_PREFERENCES` — declares which backend preferences must have UI controls
- `EXPECTED_FIELDS` — declares which backend response fields must be consumed
- `KNOWN_UNUSED` — explicit record of intentionally unconsumed fields with reasons
- `ENDPOINT_COVERAGE` — declares which test covers each endpoint

### TIC — Oracle-based verification
- `COVERAGE_MAP` — oracle: every UI action must map to a test
- `test_all_backend_fields_consumed` — oracle: every backend field must be referenced
- `test_every_api_endpoint_is_called` — oracle: every endpoint must appear in app.js
- `test_every_preference_has_ui_control` — oracle: every preference must have a UI input
- `test_item_actions_match_backend` — oracle: UI item actions must match backend actions
- `test_coverage_map_matches_actions` — oracle: no stale coverage entries
- `test_known_unused_count_is_stable` — oracle: track unused field count drift

### External controls rationale
All external controls are `not applicable` because ariaflow-web is a static
frontend dashboard with no authentication, no secrets, no server-side state,
and no user data processing. The backend (ariaflow) owns all security boundaries.
