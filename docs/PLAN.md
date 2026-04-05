# Plan

## Phase 1: Wire unused backend fields (FE-12)

22 backend response fields are returned but not consumed by the frontend.
See `test_api_params.py::KNOWN_UNUSED` for the full list.

Highest value items:
- `allowed_actions` — dynamically show/hide action buttons per item
- `items_total/done/error` in sessions — show stats in session history
- `down_cap_mbps/up_cap_mbps` — show separate up/down bandwidth caps
- `responsiveness_rpm` — display network quality metric
