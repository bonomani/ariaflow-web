# Release

`ariaflow-web` does not currently include a checked-in release helper script or
GitHub release workflow. The release process here is therefore manual.

## Version Sources

Keep these two files aligned:

- `pyproject.toml`
- `src/ariaflow_web/__init__.py`

The existing repo tags use the stable pattern `vX.Y.Z`, for example `v0.1.13`.
Do not publish alpha tags or prereleases from this repo.

## Manual Release Checklist

1. Start from a clean checkout on the branch you release from.
2. Run the local checks:

```bash
python3 -m unittest tests.test_web tests.test_cli
python3 -m py_compile src/aria_queue/webapp.py src/aria_queue/cli.py src/ariaflow_web/cli.py
```

3. Bump `pyproject.toml` and `src/ariaflow_web/__init__.py` to the same version.
4. Commit the version bump.
5. Create the matching tag, for example `v0.1.14`.
6. Push the branch and tag.

## Publish Step

No publish automation is checked into this repo today. After the tag push, use
the release mechanism you maintain for this repository on the hosting side, and
publish it as a normal release.

## Verification

After release:

- confirm the new tag exists in the repo
- confirm `ariaflow-web --version` reports the released version
- if you install from a package or tap managed elsewhere, verify that package separately
