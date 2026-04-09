# Frontend Gaps

## Open

### FE-18: No schema/test oracle for `/api/events`

The schema migration now covers JSON endpoints, but the SSE stream at
`/api/events` is still outside that contract layer.

Current state:
- JSON response shapes are covered by `docs/schemas/` plus validation tests.
- `/api/events` is only checked for existence/behavior, not for event payload
  structure.

Impact:
- SSE payload drift can break the live dashboard without being caught by the
  new schema-backed tests.

Needed:
- Add an event-stream test strategy only if SSE payload stability becomes a
  recurring source of regressions. Otherwise keep this explicitly deferred.

## Resolved

- FE-20: Archive button now uses `archivable_count` from backend summary
  instead of the `sumDone + sumError` heuristic. BG-14 provided the field.
- FE-19: Manual BGS SHA maintenance — closed as accepted. The drift test
  (`test_bgs_sha_drift.py`) warns on mismatch; warning-only is sufficient
  for this repo's governance level. No code change needed.
- FE-17: No CI enforcement for BGS compliance — closed as won't-fix.
  The validator depends on the private `../BGSPrivate` sibling repo which
  cannot be cloned in CI without exposing credentials. Local-only
  enforcement (pre-commit + `test_bgs_compliance.py`) is the permanent
  design. Documented as a known limitation.
- FE-15: Log tab no longer depends on polling once backend `action_logged`
  SSE events are available.
- FE-16: Hero/health data no longer depends on a dedicated `/api/health`
  polling timer; health now comes from `/api/status.health`.
- Legacy inline contract declarations are being migrated into
  `docs/ucc-declarations.yaml` and `docs/schemas/`.
