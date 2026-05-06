# Post-Download Lifecycle — Roadmap

> Status: planning. No code yet. Builds on BG-55 (filesystem-first
> verification) once that lands.

ariaflow today does one thing: download. The vision below extends that
to a full *download → manage → redistribute* pipeline, in three
independent phases.

```
   Download   →   Manage    →   Redistribute
   ────────       ──────         ──────────────
   ariaflow       Phase 1        Phase 2 / 3
   today          rename, move   torrent seed
                  delete, clean  HTTP/HTTPS serve
```

Each phase is shippable on its own, useful on its own, and
independently revertable if the operator finds it doesn't fit.

---

## Phase 0 — Naming & UI scaffold (small, ship first)

**Goal:** make the existing surface honest before adding new things.

- Rename **Archive tab → Downloaded tab**.
  - Operators reading "Archive" think backup / long-term storage.
    Reality: it's a list of items that left the active queue
    (complete / removed). "Downloaded" matches the operator's mental
    model.
  - URL: `/archive` → `/downloaded` (with `/archive` redirect for one
    release).
  - Filter / sort behaviour unchanged.
- BG-55 lands first; the Downloaded tab becomes the natural home for
  the filesystem-first data BG-55 produces:
  - row state: **on disk + in history** / **on disk + no history** /
    **not on disk + in history**
  - "Open folder" action (FE-only, OS-native reveal)
  - "Forget" action (deletes queue history row, leaves disk alone)

**Reserved gap IDs:** none yet — pure rename, no backend change.

**Effort:** half a day.

---

## Phase 1 — Folder operations (rename / move / delete / clean)

**Goal:** let the operator manipulate the **ariaflow-managed download
folder** (and only that folder) from the dashboard.

**Scope guardrails — non-negotiable:**

- Every path is validated to be inside `<download_dir>` (resolve
  symlinks, reject `..` traversal, reject absolute paths outside).
- ariaflow never touches the wider filesystem.
- `<download_dir>` is read from declaration prefs; changing it doesn't
  pull old files along.
- No recursive delete on a directory bigger than N items without an
  explicit confirm flag.

**New backend endpoints:**

```
POST   /api/files/rename     { path, new_name }            → 200 / 409
POST   /api/files/move       { path, new_subdir }          → 200 / 409
DELETE /api/files            { path }                      → 204
POST   /api/files/clean      { older_than_days?, status? } → 200 + summary
```

All four:
- Require the path to resolve inside `download_dir`
- Sync the queue history row (`output_path` updated; if the file is
  deleted, history row stays but a flag marks it "missing on disk")
- Land an action-log entry (`outcome: "renamed" | "moved" | "deleted" | "cleaned"`)

**Concrete cleanup recipes the FE can call:**

- "Delete files older than 30 days where status=complete"
- "Delete files where status=error" (failed retries piling up)
- "Delete history rows where file is missing on disk" (reconcile)

**FE work:**

- Per-row actions on the Downloaded tab: Rename, Move (small subdir
  picker), Delete (with confirm)
- Bulk action bar: Clean… → modal with the recipes above
- Disk-usage chip in the tab header: total, by status

**Reserved gap IDs:**

- **BG-56** — folder operations API (rename/move/delete/clean)
- **FE-46** — Downloaded tab actions UI

**Effort:** ~3–5 days. Most cost is in path-safety + tests.

**Why ship this before Phase 2/3:** these are the operations the
operator already does manually with Finder. Bringing them into the
dashboard is convenience. Phases 2/3 are *new capabilities* that need
operator buy-in first.

---

## Phase 2 — Seed as torrent

**Goal:** turn a downloaded file into a torrent the operator can share.

**Why aria2 can do this:** aria2 has BitTorrent built in. Once it has
a `.torrent` metainfo file, it can seed the corresponding files.

**Two sub-problems:**

1. **Create the `.torrent` metainfo** — needs piece hashing + tracker
   URLs.
   - Option A: shell out to `mktorrent` (system binary — clean, fast,
     but one more dependency for the operator to install).
   - Option B: bundle a Node lib (`create-torrent` / `parse-torrent`)
     — zero install, slower hashing for huge files (minutes).
   - Decision: **A** for now, with a clear error message if `mktorrent`
     isn't found and a deferred "would you like ariaflow to do it
     in-process?" path.

2. **Tell aria2 to seed** — `aria2.addTorrent(base64_metainfo,
   [files], { 'bt-seed-unverified': 'true', 'follow-torrent': 'mem' })`.
   `bt-seed-unverified` skips re-hashing the original files since
   ariaflow generated them.

**Trackers** are the open question:

- **Public tracker**: easy URL paste, but the operator probably doesn't
  want to advertise their stuff to the public DHT.
- **Private tracker**: operator runs their own (`bittorrent-tracker`,
  `opentracker`, etc.) — small Node service, ~5 minutes to set up.
- **Trackerless (DHT-only)**: works, but discoverability is poor.

**Recommendation: private tracker.** ariaflow-server bundles a small
optional `bittorrent-tracker` mount under `/tracker/announce` (gated
on a `serve_torrent_tracker: false` pref, default off). Operators who
want public sharing point to whatever tracker they like.

**New queue surface:** seeding items get a new queue status `seeding`
(extends BG-30's vocabulary by one). Or — alternative — they live as
a new top-level entity (`shares` table) so they don't pollute the
download queue. Decision deferred until we have the API design.

**New backend:**

```
POST /api/files/share/torrent
  { path, trackers[], piece_length_bytes? }
  → 200 { share_id, magnet, info_hash }

GET  /api/shares                        → list active seeds
POST /api/shares/:id/stop               → unseed
DELETE /api/shares/:id                  → unseed + delete .torrent
```

**FE work:**

- "Share as torrent" action on Downloaded rows
- New "Sharing" tab with the active seeds, peer counts, upload speed
- Tracker config pane in Options

**Reserved gap IDs:**

- **BG-57** — torrent creation + seeding API
- **BG-58** — optional private tracker mount (separate, gated)
- **FE-47** — share-as-torrent UI + Sharing tab

**Effort:** ~1–2 weeks. Most cost is in the operator-facing decisions
(tracker model, share lifecycle, peer/swarm visualisations).

**Open questions before starting:**

- Does the operator want to seed forever, or a duration / ratio?
- What happens when the source file is renamed/moved/deleted while
  seeding? (aria2 would error.)
- Multi-file torrents (a folder)?

---

## Phase 3 — HTTP/HTTPS serve

**Goal:** expose the download folder over HTTP so other devices /
people can fetch files directly.

**Architecture choice — what NOT to do:**

- Don't make ariaflow-server run a TLS termination layer with cert
  rotation, ACME, etc. That's a different product.

**Recommendation: ariaflow serves plain HTTP locally; HTTPS / public
exposure is a reverse-proxy concern (caddy / nginx / Cloudflare
Tunnel).** The operator already has those tools if they need internet
exposure; baking them into ariaflow doubles the failure surface.

**New backend:**

```
GET /files/<rel_path_in_download_dir>
  → 200 + Content-Disposition: attachment
  + Range support (for seeking / resume)
  + Content-Type from extension or mime sniff
  + 304 on If-None-Match / If-Modified-Since
```

Gated on a declaration pref `serve_downloads_http: false` (default
off). Auth via the existing API token mechanism (header / cookie /
query param) so accidental exposure isn't trivial.

**Operator workflow:**

```
1. Toggle 'serve_downloads_http: true'
2. (Optional) put caddy in front of port 8000 with a cert
3. Share http(s)://yourhost/files/<filename> with whoever needs it
```

**No FE work** beyond surfacing the URL on each Downloaded row when
serving is enabled. Small chip: "share link" → copies URL.

**Reserved gap IDs:**

- **BG-59** — static file serve under /files/* (with auth + range)
- **FE-48** — copy-share-link chip on Downloaded rows

**Effort:** ~3 days. Most cost is range-request correctness +
auth/CORS surface.

**Open questions before starting:**

- Auth granularity: one shared token vs per-file expiring tokens?
- Logging: every download = action-log entry?
- Bandwidth accounting: should serving traffic eat the same cap as
  ariaflow's downloads, or be unlimited?

---

## Sequencing

```
Phase 0 ──► Phase 1 ──► (decision point) ──► Phase 2 OR Phase 3
                            │
                            └── stop here is fine
```

- **Phase 0** is cheap, ship anytime.
- **Phase 1** is bounded scope, useful even alone, doesn't constrain
  Phase 2/3.
- Between Phase 1 and Phase 2/3 is the right time to reassess: is
  ariaflow turning into the right shape, or has it grown beyond the
  operator's actual needs?
- Phase 2 and Phase 3 are *parallel* — ship whichever has a real
  operator demand first; the other can wait.

## What to NOT build

- General-purpose file manager (rename arbitrary files outside
  download_dir, navigate parent folders, edit text files, etc.).
  Operators have Finder / nautilus.
- Media library features (poster art, transcoding, subtitle download).
  That's Plex / Jellyfin territory.
- Multi-user permissions / per-user folder views. Single-operator
  self-host is the design target.

## Decision needed

Pick one of:

1. **Ship Phase 0 only** — small, immediate; revisit later.
2. **Ship Phase 0 + commit to Phase 1** — file BG-56, FE-46.
3. **All three phases on the roadmap** — file BG-56/57/58/59 + FE-46/47/48
   as planning gaps (status: planned, not started).

Default recommendation: **option 2** unless there's a concrete operator
need for sharing today.
