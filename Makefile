.PHONY: test lint format check check-drift verify ci install clean help build-frontend typecheck-frontend lint-frontend format-check-frontend test-frontend

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

build-frontend: ## Build the TypeScript frontend bundle
	npm run build

typecheck-frontend: ## Type-check the TypeScript frontend
	npm run typecheck

test-frontend: ## Run TypeScript unit tests (node:test + tsx)
	npm test

lint-frontend: ## Lint the TypeScript frontend (eslint)
	npm run lint

format-check-frontend: ## Check frontend formatting (prettier)
	npm run format:check

verify: check-drift build-frontend test-frontend test ## Full verification: check-drift + frontend build + frontend tests + python tests
	@echo "All verification checks passed."

ci: verify typecheck-frontend lint-frontend format-check-frontend lint ## Pre-push gate: verify + tsc + eslint + prettier + ruff lint + format check
	ruff format --check src/ tests/
	@echo "All CI checks passed."

install: ## Install in development mode
	pip install -e .

clean: ## Remove build artifacts and caches
	rm -rf build/ dist/ *.egg-info UNKNOWN.egg-info .pytest_cache .mypy_cache .ruff_cache __pycache__
	rm -rf src/ariaflow_dashboard/static/dist/
	find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	rm -rf .claude/worktrees/
