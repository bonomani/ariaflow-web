# Frontend API contract schemas

JSON Schema documents in this directory describe the **frontend's expectation**
of backend API response shapes. They are the canonical record of what
ariaflow-dashboard depends on at the API boundary.

## Role in BGS-Verified

These schemas are TIC oracles for the BGS-Verified claim authored in
`../../BGS.md`. They are referenced by `../bgs-decision.yaml` `evidence_refs`
and exercised by tests under `../../tests/`:

- `test_api_response_shapes.py` — validates `tests/conftest.py` mock fixtures
  against the schemas. Catches drift between the test fixtures and the
  documented contract.
- `test_openapi_alignment.py` — cross-checks each frontend schema against the
  backend's `openapi.yaml`. Catches drift between the frontend contract and
  the backend's published OpenAPI spec.

## Editing rules

1. The backend's `openapi.yaml` is the source of truth for what the backend
   *can* return. These schemas are the source of truth for what the frontend
   *requires*. They must be a subset.
2. When you add or remove a `required` field, run `pytest tests/test_api_response_shapes.py
   tests/test_openapi_alignment.py` to confirm both invariants still hold.
3. Use Draft 2020-12 for new schemas.
