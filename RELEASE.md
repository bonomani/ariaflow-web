# Release

`ariaflow-dashboard` uses a stable tag-push release pattern. Every push to `main`
triggers a GitHub Actions workflow that auto-releases.

## Version Sources

Keep these two files aligned:

- `pyproject.toml`
- `src/ariaflow_dashboard/__init__.py`

The existing repo tags use the stable pattern `vX.Y.Z`, for example `v0.1.71`.
Do not publish alpha tags or prereleases from this repo.

## Automatic Flow (preferred)

Push to `main`. The workflow (`.github/workflows/release.yml`) will:

1. Bump the patch version automatically
2. Run `pip install -e .` + test suite (`tests.test_web tests.test_cli`)
3. Build the source distribution
4. Commit the version bump and push the tag
5. Update `bonomani/homebrew-ariaflow/Formula/ariaflow-dashboard.rb`
6. Verify the published tap formula matches
7. Create a GitHub release with the sdist artifact

## Helper Script

For explicit version control:

```bash
python3 scripts/publish.py plan                    # preview
python3 scripts/publish.py push                    # push to main (auto-release)
python3 scripts/publish.py release --version 0.1.75  # dispatch explicit version
```

Useful flags:

- `plan`: print release plan without changing files
- `--no-tests`: skip local tests
- `plan --allow-dirty`: bypass clean-tree check for preview

## Manual Flow

1. Start from a clean checkout on `main`.
2. Run local checks:

```bash
pip install -e .
python -m unittest tests.test_web tests.test_cli -v
```

3. Commit and push to `main`.
4. GitHub Actions handles the rest.

For a specific version:

```bash
python3 scripts/publish.py release --version 0.1.75
```

## Verification

After release:

- confirm the new tag exists in the repo
- confirm the GitHub release is published
- confirm the Homebrew tap formula updated

```bash
brew tap bonomani/ariaflow
brew upgrade ariaflow-dashboard
ariaflow-dashboard --version
```

## GitHub Secret

Set `ARIAFLOW_TAP_TOKEN` in this repo with write access to
`bonomani/homebrew-ariaflow`. The release workflow uses it to commit the
formula update.
