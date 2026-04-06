# Frontend Gaps

## Open

### FE-14: Skip self-discoveries needs robust hostname match

Phase 2 of the discovery cleanup plan filters discovered backends that point
to this same machine. Current approach: parse the `.local` hostname from
`dns-sd -L` or `avahi-browse` output and compare against `platform.node()`.

**Problem:** Case sensitivity, format drift between macOS/Linux, and fragile
regex parsing make this unreliable in edge cases.

**Blocked by:** BG-6 (backend should publish its short hostname as a TXT record).
With that, the frontend can compare TXT `hostname` values directly —
reliable and portable.

**Workaround:** implement the parsing-based match anyway (best-effort); it
works for the common case. Replace with TXT-based match once BG-6 is resolved.

---

## Resolved

*(cleaned 2026-04-06 — see git log for FE-3 through FE-13 history)*
