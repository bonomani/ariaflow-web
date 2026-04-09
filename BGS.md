# ariaflow-dashboard BGS Entry

project_name: ariaflow-dashboard
bgs_slice: BGS-Verified
decision_reason: "Frontend has explicit boundary classification (ACTIONS.md), declaration/observation/result test patterns (EXPECTED_ENDPOINTS, EXPECTED_FIELDS), and oracle-based verification (COVERAGE_MAP, field coverage)"
applies_to_scope: "frontend API boundary and UI coverage verification"
decision_record_path: ./docs/bgs-decision.yaml
last_reviewed: 2026-04-07
read_next:
  - "./docs/bgs-decision.yaml"
  - "./ACTIONS.md"
  - "./tests/test_api_params.py"
  - "./tests/test_coverage_check.py"
  - "../ariaflow-server/BGS.md"
