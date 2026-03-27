# Release

`ariaflow-web` uses the same stable tag-push release pattern as `ariaflow`.

## Version Sources

Keep these two files aligned:

- `pyproject.toml`
- `src/ariaflow_web/__init__.py`

The existing repo tags use the stable pattern `vX.Y.Z`, for example `v0.1.13`.
Do not publish alpha tags or prereleases from this repo.

## Preferred Flow

Run the helper from a clean checkout on `main`:

```bash
python3 scripts/publish.py plan
python3 scripts/publish.py push
```

The helper will:

- validate that `pyproject.toml` and `src/ariaflow_web/__init__.py` agree
- refuse to reuse an existing tag
- run `py_compile` and `python3 -m unittest tests.test_web tests.test_cli -v` unless `--no-tests` is used
- `push`: push `main` with a `pull --rebase` retry
- `release --version X.Y.Z`: trigger `workflow_dispatch` for an explicit stable version after the same rebase-safe sync

Useful flags:

- `plan`: print the release plan without changing files
- `release --version 0.1.18`: dispatch an explicit stable release on GitHub Actions
- `--no-tests`: skip local tests
- `plan --allow-dirty`: bypass the clean-tree check for preview only

## After Push

The GitHub workflow in `.github/workflows/release.yml` runs automatically on
`main` pushes and can also be triggered explicitly with `workflow_dispatch`. It will:

- run the test suite again on GitHub Actions
- build the source distribution
- create the GitHub release
- update `bonomani/homebrew-ariaflow/Formula/ariaflow-web.rb` directly

## Manual Flow

1. Start from a clean checkout on `main`.
2. Run the local checks:

```bash
python3 -m unittest tests.test_web tests.test_cli
python3 -m py_compile src/aria_queue/webapp.py src/aria_queue/cli.py src/ariaflow_web/cli.py
```

3. Commit the code change on `main`.
4. Push `main`.
5. Let GitHub Actions create the release commit, stable tag, GitHub release, and Homebrew update.

If you need to force a specific stable version:

```bash
python3 scripts/publish.py release --version 0.1.18
```

## Verification

After release:

- confirm the new tag exists in the repo
- confirm the GitHub release is published as a normal release
- confirm the Homebrew tap formula updated to the same version
- confirm `ariaflow-web --version` reports the released version
- on macOS, check:

```bash
brew tap bonomani/ariaflow
brew upgrade ariaflow-web
ariaflow-web --version
```

## GitHub Secret

Set `ARIAFLOW_TAP_TOKEN` in this repo with write access to
`bonomani/homebrew-ariaflow`. The release workflow uses it to commit the
formula update.
