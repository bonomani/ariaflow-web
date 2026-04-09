.PHONY: test lint format check check-drift verify ci install clean help

help: ## Show this help
	@grep -E '^[a-z_-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*## "}; {printf "  %-15s %s\n", $$1, $$2}'

test: ## Run all tests
	python -m pytest tests/ -x -q

lint: ## Run ruff linter
	ruff check src/ tests/

format: ## Format code with ruff
	ruff format src/ tests/

check: ## Run all checks (tests + lint)
	python -m pytest tests/ -x -q
	ruff check src/ tests/
	@echo "All checks passed."

check-drift: ## Check for BGS and evidence drift
	python scripts/check_bgs_drift.py

verify: check-drift test ## Full verification: check-drift + tests
	@echo "All verification checks passed."

ci: verify lint ## Pre-push gate: verify + lint + format check
	ruff format --check src/ tests/
	@echo "All CI checks passed."

install: ## Install in development mode
	pip install -e .

clean: ## Remove build artifacts and caches
	rm -rf build/ dist/ *.egg-info UNKNOWN.egg-info .pytest_cache .mypy_cache .ruff_cache __pycache__
	find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	rm -rf .claude/worktrees/
