# Multi-Device Authentication & Connectivity Design

> Design doc covering: who can talk to ariaflow, how they prove who they are,
> what they're allowed to do, how machines find each other, and how it all
> stays secure when exposed to the internet.
>
> **Status:** design — no implementation yet. This doc captures decisions
> taken during a long design discussion so we don't relitigate them every
> time we resume work.

## Table of Contents

1. [Current architecture (what we have today)](#1-current-architecture-what-we-have-today)
2. [Security audit of current state](#2-security-audit-of-current-state)
3. [Connectivity options surveyed](#3-connectivity-options-surveyed)
4. [Authentication models surveyed](#4-authentication-models-surveyed)
5. [Authorization models surveyed](#5-authorization-models-surveyed)
6. [Final chosen model](#6-final-chosen-model)
7. [Capability tokens for LLM agents](#7-capability-tokens-for-llm-agents)
8. [Impersonation (View as)](#8-impersonation-view-as)
9. [Remote desktop integration](#9-remote-desktop-integration)
10. [mDNS discovery — current state and gaps](#10-mdns-discovery--current-state-and-gaps)
11. [Pairing flow (SPAKE2)](#11-pairing-flow-spake2)
12. [Database schema](#12-database-schema)
13. [Phased roadmap](#13-phased-roadmap)
14. [Open questions](#14-open-questions)

---

## 1. Current architecture (what we have today)

Three independent components, two HTTP servers:

```
┌──────────────────────────────────┐
│   Browser (TS bundle)             │  ← only "frontend"
└──────────┬──────────────────────┘
           │ HTTP
     ┌─────┴──────┐
     ▼            ▼
┌─────────┐  ┌────────────────────┐
│ Python  │  │ ariaflow-server    │
│ host    │  │ (Node)             │
│ :8765   │  │ :8123              │
└────┬────┘  └──────┬─────────────┘
     │              │
     ▼              ▼
  brew/launchd   brew/aria2-rpc
```

**Important correction made during design:** the browser does **not** go
through a Python proxy. It calls each server directly:

- HTML + statics + `/api/web/*` → Python host (loopback)
- `/api/*` (downloads, scheduler, lifecycle, etc.) → backend Node

The Python host injects `window.__ARIAFLOW_BACKEND_URL__` into `index.html`
at render time. The browser uses this to switch between the two origins.

### Why two backends

- **Backend (Node)** runs the application logic (downloads, scheduler,
  aria2 RPC). Can run on any machine — operator's laptop, a NAS, a VPS.
- **Python host** runs only on the operator's machine. It has direct
  access to launchd / brew / local filesystem to manage the dashboard's
  own lifecycle. Browser can't run shell commands; Python is the bridge.

### Update management (current)

| Target | Update endpoint | Executor |
|---|---|---|
| ariaflow-dashboard | `POST /api/web/lifecycle/ariaflow-dashboard/update` | Python host (`install_self.dispatch_update`) |
| ariaflow-server | `POST /api/lifecycle/ariaflow-server/update` | Node backend |
| aria2 | `POST /api/lifecycle/aria2/update` | Node backend |

Smart-update: each path probes for a newer version first. If "current",
no-op. Otherwise dispatch the upgrade chain. Restart bounces without
upgrading.

---

## 2. Security audit of current state

### Risks in the current default deployment

| # | Risk | Severity |
|---|---|---|
| 1 | No authentication on either server | 🔴 critical if exposed |
| 2 | Bind on `0.0.0.0` (depends on config) — exposes LAN | 🔴 if applicable |
| 3 | DNS rebinding (no Host header check) | 🟠 high |
| 4 | CSRF (no token, no custom-header requirement) | 🟠 high |
| 5 | TOCTOU on `launchctl bootstrap $plist` | 🟡 medium (local) |
| 6 | No TLS — sniffing/MITM on untrusted networks | 🟡 medium |
| 7 | No CSP header — XSS could pivot to /update | 🟡 medium |
| 8 | Multi-backend selector trusts user-entered URLs | 🟢 low |
| 9 | SSE long-poll exposes activity continuously | 🟢 low |

### Three threat scenarios to choose from

| Scenario | Description |
|---|---|
| **A.** Single-user, machine perso, LAN trusted | Probably current default |
| **B.** Multi-user on shared LAN (NAS, office) | Need application auth |
| **C.** Internet-exposed | Full hardening required |

The chosen direction (this doc) targets **C with strong auth**, while keeping
the Python host on **loopback only**.

---

## 3. Connectivity options surveyed

Six options were considered for "how do operator's browser reach a remote
backend":

### 3.1 Reverse proxy (Caddy/nginx) in front of the backend
- ✅ Battle-tested TLS, automatic certs (Let's Encrypt), rate limiting
- ❌ Extra component to maintain
- **Verdict:** rejected by user (no Caddy/proxy wanted)

### 3.2 Native TLS in Python and Node, no proxy
- ✅ One less component
- ❌ Cert renewal logic to write
- ❌ More code paths to harden
- **Verdict:** considered, then superseded by tunnel-based approach

### 3.3 SSH tunnel
- ✅ Strong auth (Ed25519 keys), no new infra
- ✅ Already on every machine
- ❌ TCP-only, no NAT traversal
- ❌ Browser can't speak SSH directly — operator must launch tunnels manually
- **Verdict:** great for personal admin use, not enough for family/friends UX

### 3.4 SSH over UDP (Mosh, QUIC, encapsulation)
- Mosh: shell only, no port forwarding → useless for ariaflow tunneling
- QUIC SSH: experimental, not production-ready
- Encapsulation in WireGuard/Tailscale: this is what most people end up doing
- **Verdict:** what people call "SSH over UDP" in practice = SSH inside a
  WireGuard/Tailscale tunnel. Use that directly.

### 3.5 WireGuard pure
- ✅ Total ownership, kernel-level fast, zero deps
- ❌ Manual peer config doesn't scale beyond ~3 machines
- ❌ No NAT traversal (need port forward or DDNS)
- ❌ No auto-discovery, no key rotation, no ACL UI
- **Verdict:** good for 2 fixed machines; not for family with mobile devices

### 3.6 Tailscale (managed) or Headscale (self-hosted)
- ✅ WireGuard underneath (same speed, same crypto)
- ✅ Magic NAT traversal (DERP relay fallback)
- ✅ Auto-discovery, MagicDNS, ACL config
- ✅ Tailscale gratuit suffit pour ce cas (≤100 devices)
- ✅ Headscale = same client, self-hosted control plane
- 🟡 Tailscale = trusts Tailscale Inc. (US company)
- 🟡 Headscale = ~1h initial setup, a service to maintain
- **Verdict: ✅ chosen as the connectivity foundation.**

### Decision

**Tailscale gratuit** to start (zero infra, validates UX in 30 min).
**Headscale** as the migration target if/when self-hosting becomes
necessary — same Tailscale clients, just point them at a different
control URL. Migration is ~2-3h, no client changes needed.

This **dramatically simplifies** the rest of the design:
- No port forwarding needed
- No public TLS certs needed (LAN-class connectivity over the tunnel)
- No DNS rebinding risk (Tailscale IPs are private)
- ACLs at the network layer cover ~50% of the role model

---

## 4. Authentication models surveyed

For the application layer (on top of Tailscale connectivity):

### 4.1 Pre-shared bearer token in a file
Token written to `~/.ariaflow-server/bootstrap_token.txt` (mode 600).
Operator copies into dashboard manually.
- ✅ Trivial to implement (~50 lines)
- ❌ Bad UX (must access server filesystem)
- ❌ Single secret = single point of compromise
- **Verdict:** acceptable as MVP fallback

### 4.2 Token + TOTP login flow
Bearer token + TOTP one-time code → access JWT (15 min) + refresh token.
- ✅ Strong (something you know + something you have)
- ❌ TOTP setup demands QR scanning and authenticator app
- **Verdict:** considered, then superseded by SPAKE2 pairing

### 4.3 mTLS (mutual TLS with client certs)
- ✅ Phishing-resistant by construction
- ❌ Client cert distribution is painful (browsers, mobile)
- **Verdict:** rejected (UX too hostile)

### 4.4 Passkey / WebAuthn
- ✅ Modern, phishing-resistant
- ❌ Significant implementation cost
- **Verdict:** post-MVP enhancement, not MVP

### 4.5 SPAKE2 pairing with a numeric code (HomeKit/Matter style)
- ✅ Code never transmitted (PAKE protocol derives key from it)
- ✅ Phishing-resistant, MITM-resistant
- ✅ One-time, short, easy to dictate
- ✅ Once paired, device gets long-lived `device_token`
- **Verdict: ✅ chosen.** Modern UX, strong security, well-known protocol.

### Decision

**SPAKE2 pairing** to bootstrap trust between a new device and a backend.
After pairing, the dashboard stores a long-lived `device_token` per
backend in `~/.ariaflow-dashboard/peers.json` (mode 600). All subsequent
requests use this token over the Tailscale tunnel.

---

## 5. Authorization models surveyed

The user described a real-world scenario that drove this:

> *"I want to manage all my family's devices. I want my friend to be able
> to do the same with his family. Eventually I want him and me to share
> some devices with full power for both of us. I also want to share
> specific downloads with friends so they can grab files but see nothing
> else."*

Plus later:

> *"I want this model to also handle rights for an LLM searching my
> emails."*

> *"I want to be able to take the role of someone (impersonation)."*

### 5.1 Hierarchical (Owner > Admin > Operator > Viewer)
- ✅ Familiar (like AWS, like HomeKit)
- ❌ User explicitly said: "no hierarchy, everyone equal"
- **Verdict:** rejected

### 5.2 Flat — every paired device is fully privileged
- ✅ Trivial to code
- ❌ Anyone paired can revoke anyone, including you
- ❌ No way to give a friend partial access
- **Verdict:** too permissive for the friend-share use case

### 5.3 Domain-scoped permissions (downloads, lifecycle, devices, etc.)
Each functional domain has its own role per device.
- ✅ Powerful and granular
- ❌ Overkill for this scenario
- **Verdict:** rejected

### 5.4 Group/scope-based (Slack-workspaces model)
Multiple "fabrics" sharing a backend.
- ❌ Not the user's mental model
- **Verdict:** rejected

### 5.5 Per-resource ACLs (Google Drive model)
Permissions per item.
- ✅ Maps cleanly to "share specific downloads"
- ❌ Heavy if applied to the whole permission system
- **Verdict:** kept as a **targeted hatch**, not the primary model

### 5.6 Capability tokens (UCAN, macaroons)
Token-based attenuated rights.
- ✅ Perfect for LLM agents
- ❌ Wrong UX for human users (too granular)
- **Verdict:** kept as a **separate layer for agents only**

### Decision

A **layered model** that picks the right tool for each principal type:

| Principal type | Mechanism |
|---|---|
| Human users | Peer co-admin + guest + share-links (§6) |
| LLM agents | Capability tokens with scoped permissions (§7) |
| Operator debugging | Impersonation (§8) |

---

## 6. Final chosen model

### 6.1 Roles

Two primary roles, no hierarchy:

- **admin** — peer-equal full power. Can do anything, including
  inviting other admins, generating share-links, revoking other admins.
- **guest** — sees only resources explicitly shared with them via
  `share_grants` or share-links. Cannot mutate.

A third optional role for the "ma femme peut pause sans casser" case:

- **operator** — admin minus destructive actions (no lifecycle.update,
  no declaration changes, no device management).

### 6.2 Multi-backend with co-administration

```
Backend "Maman-PC"      ← Bruno (admin)
Backend "Papa-PC"       ← Bruno (admin)
Backend "Bruno-perso"   ← Bruno (admin)

Backend "Mère-Pote"     ← Pote (admin)
Backend "Père-Pote"     ← Pote (admin)
Backend "Pote-perso"    ← Pote (admin)

Backend "NAS-partagé"   ← Bruno (admin) + Pote (admin)  ← co-admin
```

Each backend has a flat list of admins. All admins are equivalent. The
dashboard maintains a list of paired backends in `peers.json`; the
selector cycles between them.

### 6.3 Inviting another admin (delegation)

```
Bruno → Devices tab on NAS-partagé → "Generate invite link"
     → backend returns ariaflow://pair/eyJ...?code=1234-5678
       (signed URL + SPAKE2 code, single-use, 24h TTL)
Bruno sends URL to Pote (Signal, mail, in person).
Pote clicks → his dashboard intercepts → SPAKE2 with the code.
Pote is now co-admin.
```

The invite-link **is** the approval. No second-step "Owner approves"
because there is no Owner — admins are equal peers.

### 6.4 Sharing files with non-paired friends

Two flavors:

#### a) Signed share-links (recommended)
```
Bruno marks download #42 as "shared" → backend generates URL:
  https://nas.tail-net.ts.net/d/42?token=<HMAC>&exp=<ts>
Friend opens URL in browser → file streams. No account, no pairing.
```

#### b) Guest-pairing with restricted dashboard
Optional; build only if (a) becomes insufficient. The guest pairs like
an admin would, but their `role='guest'` triggers heavy filtering on
all GET endpoints.

### 6.5 Recovery / kill switch

The "anyone can revoke anyone" property of a flat model creates a
deadlock risk. Mitigations:

- **Self-revocation guard**: refuse `revoke(self)` unless another admin
  remains.
- **Last-admin guard**: refuse to revoke the last admin.
- **Trust-note recovery**: a file `/etc/ariaflow-server/trust_note`
  (mode 600 root) that, when read by an operator with shell access,
  re-injects a privileged device. Local physical control = ultimate
  authority.

### 6.6 Coverage of the "12 powerful features"

| # | Powerful feature | Covered? | How |
|---|---|:-:|---|
| 1 | Fine permissions per action | 🟡 | 3-role model (admin/operator/guest) + capability tokens for agents |
| 2 | Quotas | 🟡 | Rate limit on agent tokens only |
| 3 | TTL on roles | 🟡 | Agent tokens only; humans = manual revoke |
| 4 | Conditional delegation | ❌ | Not covered |
| 5 | Per-item permissions | ✅ | `private_to` column + `share_grants` |
| 6 | Audit per human | ✅ | `owner_label` + audit_log |
| 7 | Email recovery | ❌ | Trust-note instead |
| 8 | Self-service signup | ❌ | Manual pairing only |
| 9 | Groups | ❌ | Not covered |
| 10 | Time/IP policies | ❌ | Not covered |
| 11 | Multi-tenant | 🟡 | Multiple backends instead |
| 12 | GDPR compliance | 🟡 | Audit log exists, no formatted export |

**~5/12 covered, intentionally.** The 7 dropped features are either
B2B-product concerns or have simple workarounds.

### 6.7 Optional add-ons (3 escape hatches)

| Hatch | Cost | Adds |
|---|---|---|
| `private_to` column on downloads | ½ d | Per-item privacy on shared backends (#5) |
| `operator` role | 1 d | Spouse can pause without nuking server (#1) |
| `owner_label` on devices | ¼ d | Audit log shows "Bruno (via MacBook) did X" (#6) |

**Total +1.75 days** for the most useful 3 hatches.

---

## 7. Capability tokens for LLM agents

LLMs and human users have **opposite trust profiles**:

- Humans: trusted, behave reasonably, want simple UX.
- LLMs: untrusted (prompt injection, hallucinations), need very narrow
  scope, ephemeral, must be auditable per call.

So they get a **separate auth path**.

### 7.1 Token shape

```jsonc
{
  "scope":  ["emails.read"],          // exact actions allowed
  "filter": { "from": "*@amazon.com" }, // hard filter applied server-side
  "ttl":    3600,                      // 1 hour
  "rate":   100,                       // calls/hour
  "audit":  "every_call",              // log every call
  "parent": "bruno-macbook"            // who delegated
}
```

Routing: middleware sees `Authorization: Bearer agent-...` → enforces
scope/filter/rate/TTL. Different code path from human device tokens.

### 7.2 UI

Admin-only **Agents** tab:
```
[+ Generate agent token]
  Purpose:  "LLM cherche emails Amazon"
  Scope:    [✓] emails.read
            [ ] emails.write
  Filter:   from contains @amazon.com
  TTL:      [1 hour ▼]
  Rate:     100/hour
  → Token: ariaflow-agent-xxxxxxxxxxxxxxxxxxxxxxx
```

Active agents listed with revoke + audit-log buttons.

### 7.3 MCP standard

Long-term direction: speak Anthropic's **Model Context Protocol** (MCP)
natively. Resources/Tools/Prompts. Token-based capability per tool.
For MVP, a custom token-with-scopes scheme is enough.

---

## 8. Impersonation (View as)

Two flavors:

### 8.1 View as (read-only)
Admin clicks "View as Alice" → all GET responses filtered as if Alice
were calling. All POSTs disabled. Banner: "Viewing as Alice [Exit]".
- ✅ Low risk
- ✅ 80% of debug needs
- ~1 day to implement

### 8.2 Act as (mutating)
Admin clicks "Act as Bruno" → mutations possible, signed with **both**
identities. Audit log records `actor=admin-X impersonated=bruno`.
- 🟡 Higher risk, needs strict guards
- ~1.5 days

### 8.3 Hard rules

1. No elevation: can only impersonate roles ≤ yours.
2. Double audit always: `actor` + `impersonated`.
3. TTL auto (15 min default).
4. Forbidden actions even in Act-as: revoke other admins, transfer
   ownership, generate invite-links.
5. Visible banner persistent on screen.
6. Notify the impersonation target (best-effort).

### 8.4 Recommendation

Ship **View as only**. Skip Act-as until a clear need emerges.

---

## 9. Remote desktop integration

### 9.1 The need

Operator wants to take over a family member's screen to help them. Two
approaches considered:

### 9.2 Option 1: Self-hosted RustDesk-server
- ✅ Total control, granular permissions via API admin
- ❌ Need to run another service
- ❌ Need to expose ports to the internet
- ❌ Admin API is in RustDesk Pro (paid) or community fork
  (`lejianwen/rustdesk-api`)
- **Verdict:** valid but heavy

### 9.3 Option 2: RustDesk public servers + ariaflow-managed local config
- ✅ Zero infra, zero cost
- ✅ NAT traversal for free
- ✅ Ariaflow generates `RustDesk2.toml` on each machine, controlling
  whitelisted IDs, permanent passwords, file/audio permissions
- ❌ No real-time revocation (must wait for next config push or
  password rotation)
- ❌ Trust in rustdesk.com staying available
- **Verdict:** considered, then superseded by Option 3

### 9.4 Option 3: Tailscale + native screen sharing (chosen)
- ✅ Tailscale already provides connectivity
- ✅ Use macOS Screen Sharing (`vnc://`), Windows RDP, or RustDesk in
  direct-IP mode over the Tailscale net
- ✅ No third-party screen-sharing relay needed
- ✅ Ariaflow becomes a launcher: shows peers, opens deep-links
  (`vnc://100.x.x.x`, `rdp://...`, `ssh://...`)
- ✅ ~1 day implementation cost vs ~5 days for Option 1
- **Verdict: ✅ chosen.**

### 9.5 Headscale + RustDesk-server (alternative for full sovereignty)

If rejecting Tailscale Inc.:

- Self-host **Headscale** (control plane compatible with Tailscale clients)
- Self-host **RustDesk-server** (rendezvous + relay) as fallback for
  cross-mesh access
- ACLs configured in Headscale cover much of the role model
- ~1 day extra vs Tailscale gratuit
- 100% self-hosted, no third-party dependencies

---

## 10. mDNS discovery — current state and gaps

### 10.1 Backend already advertises ✅

The backend has a working mDNS module at
`packages/core/src/bonjour/`:

- Service type: `_ariaflow-server._tcp.local.`
- Backends: `dns-sd` on macOS/Windows/WSL, `avahi-publish-service` on Linux
- Subprocess approach (no native lib dep)
- Existing TXT records: `path`, `tls`, `hostname`

### 10.2 Dashboard does NOT browse yet ❌

Need a `discovery.py` module using `zeroconf` (PyPI) that:
- Browses `_ariaflow-server._tcp.local.` continuously
- Maintains a list of discovered services
- Exposes `GET /api/web/discovery` returning the list

### 10.3 BG-67: backend TXT additions needed

Current TXT records lack two fields needed for the SPAKE2 flow:

| Key | Value | Purpose |
|---|---|---|
| `ver` | protocol version, e.g. `0.2` | Compat checks during pairing |
| `fp` | base32(sha256(pubkey))[:16] | Cert pinning + identity verification |

Backend already generates an Ed25519 keypair per `core/install/...`
(or should, if not yet). The `fp` is the truncated hash of its public
key. The pairing protocol uses `fp` to detect MITM (operator types code
into a session that then proves the server has the matching private key).

### 10.4 Why TS in browser can't do this

Browsers have **no Web API for mDNS**. The Python host (or any local
agent) must do the multicast listening and expose results via HTTP. The
browser then fetches `/api/web/discovery` like any other endpoint.

### 10.5 Why Python (not Node) for the dashboard host

The Python host is **historical** — it grew organically with launchd
integration, brew packaging, auto-update chains (BG-65, BG-66), and is
hardened in production. Rewriting in Node = ~3-5 days of pure refactor
with zero new feature. Defer until a strong reason emerges (e.g., shared
TS types for SPAKE2 protocol messages).

For mDNS specifically, the Python `zeroconf` package works fine
(~80 lines).

---

## 11. Pairing flow (SPAKE2)

### 11.1 The 6-step protocol

```
1. ADVERTISE    Backend mDNS: _ariaflow-server._tcp + TXT ver,fp,name

2. DISCOVER     Dashboard browses LAN → list of backends

3. INITIATE     Operator clicks "Pair" on a chosen backend
                Backend generates 8-digit code, displays in stdout/log
                Code TTL: 60s, single-use

4. PAKE2        Both sides run SPAKE2+ with the code as password
                Output: 32-byte shared symmetric key
                MITM cannot guess the code by observing exchanges

5. ATTEST       Backend signs `fp` with its private key
                Dashboard pins the fingerprint for future connections

6. ENROLL       Backend issues device_token (random 32 bytes)
                Dashboard stores {url, fp, token} in peers.json (mode 600)
```

### 11.2 Why 8 digits is enough

10⁸ ≈ 27 bits. Online brute-force impossible because SPAKE2 detects
mismatch on the first try and invalidates the code. Each attempt is
a coin flip among 10⁸ possibilities **and** is immediately exposed
to the operator (no silent retry).

### 11.3 Pairing UX patterns (the iPhone analogy)

| iOS pattern | Trust model | Maps to ariaflow |
|---|---|---|
| AirDrop between same iCloud | preexisting trust | not applicable |
| Hotspot to unknown PC | password as PSK | analogous to our SPAKE2 code |
| HomeKit accessory | code + consent notification | what we build |

**Chosen pattern:** code displayed in backend's logs (or terminal), typed
into the dashboard. Optional future enhancement: notification on the
backend's UI for visual SAS comparison.

### 11.4 Endpoints

```
POST /api/pair/start
  Body: { client_msg_a }
  Returns: { server_msg_b, session_id }
  Side effect: prints "PAIR_CODE: 12345678" to backend logs

POST /api/pair/finish
  Body: { session_id, client_proof }
  Returns: { device_token, server_fp }
```

### 11.5 Invite-link variant (for inviting peer admins)

```
POST /api/pair/invite
  Auth: Bearer <admin_token>
  Body: { role: "admin", expires_in: 86400 }
  Returns: { invite_url: "ariaflow://pair/eyJ...", code: "1234-5678" }

POST /api/pair/redeem
  Body: { invite_code, device_name, spake2_msg_a }
  Returns: { spake2_msg_b, device_token }
```

The invite-link encodes the backend URL + a one-time SPAKE2 code,
already authorized at the requested role. The recipient's dashboard
intercepts the URL scheme and runs the SPAKE2 exchange transparently.

---

## 12. Database schema

### 12.1 Backend tables (one per backend instance)

```sql
CREATE TABLE devices (
  id              TEXT PRIMARY KEY,           -- uuid
  name            TEXT NOT NULL,              -- "Bruno-MacBook"
  owner_label     TEXT,                       -- "Bruno" (optional, free-text)
  fingerprint     TEXT NOT NULL UNIQUE,       -- pubkey hash
  role            TEXT NOT NULL CHECK (role IN ('admin','operator','guest')),
  token_hash      TEXT NOT NULL,              -- argon2(device_token)
  invited_by      TEXT REFERENCES devices(id),
  paired_at       INTEGER NOT NULL,
  last_seen_at    INTEGER,
  last_ip         TEXT,
  revoked_at      INTEGER
);

CREATE TABLE invites (
  id              TEXT PRIMARY KEY,
  code_hash       TEXT NOT NULL,              -- argon2(code)
  role            TEXT NOT NULL,
  created_by      TEXT REFERENCES devices(id),
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER,
  used_by         TEXT REFERENCES devices(id)
);

CREATE TABLE share_grants (
  id              TEXT PRIMARY KEY,
  resource_type   TEXT NOT NULL,              -- 'download' | 'folder'
  resource_id     TEXT NOT NULL,
  granted_to      TEXT,                       -- device_id or owner_label
  permission      TEXT NOT NULL,              -- 'read' | 'download'
  granted_by      TEXT REFERENCES devices(id),
  granted_at      INTEGER NOT NULL,
  expires_at      INTEGER,
  revoked_at      INTEGER
);

CREATE TABLE share_links (
  id              TEXT PRIMARY KEY,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT NOT NULL,
  token_hash      TEXT NOT NULL,              -- argon2(url_token)
  created_by      TEXT REFERENCES devices(id),
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER,
  revoked_at      INTEGER
);

CREATE TABLE agent_tokens (
  id              TEXT PRIMARY KEY,
  token_hash      TEXT NOT NULL,
  created_by      TEXT REFERENCES devices(id),
  purpose         TEXT,
  scopes          JSON NOT NULL,
  filters         JSON,
  ttl_expires_at  INTEGER NOT NULL,
  rate_per_hour   INTEGER DEFAULT 100,
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER,
  revoked_at      INTEGER
);

CREATE TABLE impersonation_sessions (
  id              TEXT PRIMARY KEY,
  actor_device_id TEXT REFERENCES devices(id),
  target_device_id TEXT REFERENCES devices(id),
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  ttl_expires_at  INTEGER NOT NULL,
  reason          TEXT,
  actions_count   INTEGER DEFAULT 0
);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       INTEGER NOT NULL,
  actor_device_id TEXT,
  impersonated_device_id TEXT,                -- nullable
  agent_token_id  TEXT,                       -- nullable
  action          TEXT NOT NULL,
  result          TEXT NOT NULL,              -- 'allow'|'deny'|'rate-limited'
  detail          JSON
);
```

### 12.2 Optional download-side privacy

```sql
ALTER TABLE downloads ADD COLUMN private_to_device_id TEXT;
-- nullable; null = visible to all admins of the backend
-- non-null = visible only to that device
```

### 12.3 Dashboard side (Python, on operator's machine)

```
~/.ariaflow-dashboard/peers.json    (mode 600)
[
  {
    "backend_url": "https://nas-bonomani.tail-net.ts.net:8443",
    "name":        "NAS-Bonomani",
    "fp":          "ab12cd34ef56gh78",
    "device_token": "<opaque>",
    "role":        "admin",
    "paired_at":   1746540000
  },
  ...
]
```

---

## 13. Phased roadmap

Total estimated: **~12 days** for the full system, but phases ship
independently.

| Phase | Scope | Cost | Ships independently |
|---|---|---|:-:|
| **0** | Decide Tailscale vs Headscale, set it up | ~1h-1d | ✅ |
| **1** | mDNS browsing in dashboard + `/api/web/discovery` + UI list | ½ d | ✅ |
| **2** | BG-67: backend adds `ver` + `fp` to TXT records | ¼ d (backend) | ✅ |
| **3** | SPAKE2 pairing endpoints (start/finish) | 1 d | ✅ |
| **4** | Token storage, multi-backend selector, peers.json | 1 d | ✅ |
| **5** | Invite-link flow for co-admins | ½ d | ✅ |
| **6** | Share-links signed URLs (friends-download) | 1 d | ✅ |
| **7** | UI: Devices tab (list, revoke, audit) | 1 d | ✅ |
| **8** | Trust-note recovery mechanism | ½ d | ✅ |
| **9** | 3 escape hatches: private_to, operator role, owner_label | 1.75 d | each ✅ |
| **10** | Capability tokens for LLM agents | 3 d | ✅ |
| **11** | Impersonation (View as) | 1 d | ✅ |
| **12** | Tailscale launcher (deep-links to vnc/rdp/ssh) | 1 d | ✅ |

### Suggested order

1. **Phase 0** first (network foundation) — makes everything else simpler.
2. **Phase 1+2** — mDNS browsing + TXT additions. Useful even before
   pairing exists (just a list of "found" backends).
3. **Phase 3+4** — pairing + storage. End-to-end "I can pair my MacBook
   to the NAS" works.
4. **Phase 5+7** — invite peers, manage them.
5. **Phase 6+12** — sharing with non-paired friends, remote desktop.
6. **Phase 8** — recovery (do before exposing publicly!).
7. **Phase 9** — pick which hatches actually matter to you.
8. **Phase 10+11** — LLM and impersonation, when needed.

### Critical path for "internet-exposed working system"

Phases **0 → 1 → 2 → 3 → 4 → 8** = ~5 days. After that the system is
secure enough to expose, with manual peer management (no invites yet).

---

## 14. Open questions

These were left unanswered during the design discussion. Resolve before
implementation:

### 14.1 Where will the NAS-partagé live?
- At Bruno's home → Bruno has physical control / trust-note recovery
- At Pote's home → Pote has it
- On a VPS → neither has it; need a different recovery mechanism

### 14.2 Tailscale gratuit or Headscale?
- Tailscale gratuit is the fast path
- Headscale is the sovereign path
- Migration between them is ~2-3h, no client changes

### 14.3 Public DNS for backends?
With Tailscale's MagicDNS, hosts get names like `nas-bonomani.tail-XXXX.ts.net`
automatically. No need for own DNS. Headscale gives custom `.bonomani.tail`
or similar, also automatic.

### 14.4 Should the Python host be rewritten in Node?
Not now. Defer until shared types with backend become valuable.

### 14.5 MCP integration for LLM agents — first-class or post-MVP?
Post-MVP. Custom capability tokens are enough for the initial use case.

### 14.6 Impersonation — View as only or also Act as?
View as only. Reconsider Act as when a clear need emerges.

### 14.7 Operator role — ship MVP or defer?
Defer. Start with admin/guest only. Add operator only if "ma femme peut
pause sans casser" comes up in real use.

---

## Appendix A — What this design intentionally does NOT do

To keep the scope honest, here are features rejected as out of scope:

- Email-based account recovery (no SMTP infra wanted)
- Self-service signup pages (manual pairing only)
- Group-based permissions (single label per device suffices)
- Time-of-day or geographic IP policies (not a constrained env)
- Multi-tenant strict isolation (separate backends instead)
- GDPR-compliance tooling (audit log exists, no formal export)
- Conditional delegation rules (all admins can do everything to other admins)
- Fine-grained per-action permissions (3 roles handle 95% of cases)

These are typical RBAC product features. They cost a lot to build and
won't be used in the operator's actual scenario (family + 1 friend +
their families + occasional file recipients).

## Appendix B — Full hypotheses considered (including rejected complex ones)

This appendix documents **every option seriously considered**, including
those rejected. Kept here so future revisits don't repeat the analysis
from scratch.

### B.1 Reverse proxy options (rejected — user: "no Caddy")

#### B.1.a Caddy
```caddy
ariaflow.tondomaine.com {
    encode gzip
    rate_limit { zone auth_zone { key {remote_host} events 5 window 1m } }
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "no-referrer"
        Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self'"
    }
    reverse_proxy 127.0.0.1:8765
}
```
- Auto-TLS via Let's Encrypt
- Built-in rate limiting (with plugin)
- Security headers config-driven
- Cost: 1 component to maintain

#### B.1.b nginx
- More config to write (no auto-TLS without certbot integration)
- More mature for very high traffic
- Overkill for this use case

#### B.1.c HAProxy
- TCP-level load balancing
- More complex than needed

### B.2 Native TLS in Python + Node (rejected — superseded by tunnel)

#### B.2.a Implementation sketch
```python
import ssl
ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
ctx.load_cert_chain(certfile="/etc/ariaflow/fullchain.pem",
                    keyfile="/etc/ariaflow/privkey.pem")
ctx.minimum_version = ssl.TLSVersion.TLSv1_3
ctx.set_ciphers("ECDHE+AESGCM:ECDHE+CHACHA20")

httpd = HTTPServer(("0.0.0.0", 443), Handler)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
```

#### B.2.b Cert management
- `certbot certonly --standalone` in standalone mode + cron renew
- Or DNS-01 challenge (requires DNS provider with API: Cloudflare, OVH)
- Pre-hook stop / post-hook start service to bind 443

#### B.2.c Issues
- Must implement: Host header check, CORS whitelist, CSP, HSTS,
  rate limit, lockout, audit log, fail2ban-equivalent — all the things
  Caddy does for free
- Cert renewal failure = service outage
- TLS 0day = your problem
- Implementation: ~3-4 days
- More attack surface than reverse proxy

### B.3 SSH-based options (kept as personal admin tool, not enough for family)

#### B.3.a Plain SSH tunnel
```
ssh -L 8443:localhost:8443 maman@maman-pc.local
```
- Clé Ed25519 forte
- ~/.ssh/config pour shortcuts
- Free, zero infra
- Browser doesn't speak SSH → operator must launch tunnels manually

#### B.3.b Reverse SSH tunnels (autossh)
```
# On Maman-PC, permanent reverse tunnel:
autossh -M 0 -N -R 9000:localhost:8443 bruno@vps.bonomani.fr
# Bruno reaches Maman via vps.bonomani.fr:9000
```
- Solves NAT traversal
- Needs a pivot VPS always on
- autossh setup on each remote machine = friction

#### B.3.c ProxyJump bastion
```
ssh -J bastion.bonomani.fr -L 8443:localhost:8443 maman@10.0.0.5
```
- One bastion host, jump through to internal targets
- Needs the bastion + correct routing on the LAN

#### B.3.d Mosh (SSH-like over UDP)
- Survives network changes, hibernation
- **Shell only**, no port forwarding → useless for ariaflow tunneling

#### B.3.e SSH over QUIC
- `quicssh`, `qsh` — not production-ready
- Watch in 2-3 years

#### B.3.f wstunnel / chisel (SSH over WebSocket/HTTPS)
- Bypass firewalls that block SSH/22 but allow HTTPS/443
- Useful in restricted networks, not general

### B.4 Network-layer options (one was chosen — Tailscale)

#### B.4.a WireGuard pure
```ini
# /etc/wireguard/wg0.conf
[Interface]
PrivateKey = ...
Address = 10.0.0.1/24

[Peer]
PublicKey = ...
Endpoint = maman-pc.dyndns.org:51820
AllowedIPs = 10.0.0.2/32
```
- 4000 lines of code, kernel-fast
- Manual peer config per machine
- No NAT traversal (need port forward / DDNS)
- No discovery, no key rotation
- Good for 2-3 fixed machines

#### B.4.b Tailscale (gratuit ≤100 devices)
- WireGuard underneath, identical perf
- Auto NAT traversal (DERP relay fallback)
- MagicDNS, ACL, OAuth login
- Free for hobby use, ~6$/user/mo for business
- Trusts Tailscale Inc. (US) for control plane

#### B.4.c Headscale (self-hosted Tailscale control plane)
- Same Tailscale clients, your control server
- 100% self-hosted, no third-party trust
- ~1h initial setup, simple config.yaml
- ACL config in Tailscale-compatible JSON
- Mobile clients need custom control URL

#### B.4.d Nebula (Slack's mesh VPN)
- Similar to Tailscale conceptually
- Different protocol (not WireGuard)
- Less ecosystem maturity for individual use
- **Considered but not pursued**

#### B.4.e ZeroTier
- Layer 2 mesh, broader than just IP routing
- Free for ≤25 nodes
- More complex than WireGuard-based options
- **Considered but not pursued**

### B.5 Authentication patterns (full set considered)

#### B.5.a Pre-shared bearer token in a file
- ~50 lines, ½ day
- UX: must access server filesystem to read token
- Single-secret risk

#### B.5.b Token + TOTP login flow
- Argon2id-hashed token, JWT access (15 min) + refresh token rotation
- TOTP via `pyotp` / `otplib` with QR-code bootstrap
- Standard, well-understood
- Setup friction (auth app required)

#### B.5.c mTLS (mutual TLS)
- Strongest phishing resistance
- Custom CA, distribute client certs
- Browser cert installation hell on mobile
- Used by enterprise, painful for family

#### B.5.d Passkey / WebAuthn
- Modern, phishing-resistant by construction (origin-bound)
- Hardware key (YubiKey) or platform (Touch ID, Windows Hello)
- ~5-7 days to integrate properly
- **Future enhancement, not MVP**

#### B.5.e SPAKE2+ pairing (chosen)
- Code never transmitted in clear
- Phishing-resistant, MITM-resistant
- HomeKit / Matter pattern
- Once paired, long device_token

#### B.5.f Magic links via email
- Click email link → logged in
- Rejected: requires SMTP infra, recovery question

#### B.5.g OAuth (Google/GitHub/etc.)
- Delegate identity to IdP
- Used by Tailscale, B2C SaaS
- Adds external dependency
- Not chosen for primary auth, but Tailscale uses it transitively

#### B.5.h Hardware Security Keys (FIDO2)
- Subset of B.5.d
- Strongest known auth
- Distribution problem at scale

### B.6 Authorization models (full hierarchy explored)

#### B.6.a Flat (no roles)
Every paired device is fully privileged.
- Trivial, single boolean check
- Anyone can revoke anyone (deadlock risk)
- No way to give partial access

#### B.6.b Hierarchical (Owner > Admin > Operator > Viewer)
Classic RBAC.
- Familiar (HomeKit, AWS, Google Workspace)
- "Tu ne peux pas créer un rôle ≥ ton rôle"
- Owner is special: only one, transferable
- Rejected: user wanted no hierarchy

#### B.6.c Domain-scoped (per-functional-area roles)
```
Bruno   : owner(downloads)  + owner(lifecycle)  + owner(devices)
Alice   : admin(downloads)  + viewer(lifecycle) + none(devices)
```
Domains: downloads, scheduler, declaration, lifecycle, devices, files
- Powerful, AWS-IAM-style
- Heavy UI (matrix per role per domain)
- Overkill for selfhosted

#### B.6.d Group/scope-based (Slack-workspaces)
Multiple "fabrics" sharing a backend, isolated data per fabric.
- Better for multi-tenant
- Not user's mental model

#### B.6.e Per-resource ACLs (Google Drive)
Permissions per item.
- Maps cleanly to "share specific downloads"
- Heavy as a primary model
- **Kept as a targeted hatch (private_to, share_grants)**

#### B.6.f Capability-based (UCAN, macaroons, Object-Capabilities)
Token = a bag of attenuated rights, delegatable.
- Ideal for LLM agents
- Wrong UX for humans
- **Kept as a separate layer for agents**

#### B.6.g Identity-centric (B model with users)
Real human accounts owning multiple devices.
- Needed for OAuth-based onboarding, password resets
- Adds: users table, sessions, password_resets, email verification
- 3-4× more code than device-centric
- Migration path: add `user_id` column on devices when needed

#### B.6.h Device-centric (A model)
- One device = one identity
- Simple, no humans modeled
- Used for MVP

#### B.6.i Hybrid C (devices + free-text owner_label)
- A model + a label column
- Best of both worlds for small-scale use
- **Adopted as primary model**

#### B.6.j Co-administration peer-to-peer
- Flat roles among admins (no Owner above)
- Like Syncthing or shared Git repo
- **Adopted on top of C**

#### B.6.k Multi-hierarchy (parallel hierarchies)
- Each domain its own admin/operator/viewer chain
- Example: Bruno = admin(downloads), Alice = admin(lifecycle), shared
- Considered, rejected as too complex

### B.7 The 12 powerful features — full detail

| # | Feature | Description | Cost if added | Verdict |
|---|---|---|---|---|
| 1 | Fine permissions per action | Per-API-route permission per role | 2-3 d | Partial via 3 roles |
| 2 | Quotas | "Alice max 100 GB/month" | 2 d | Agent-only via rate limit |
| 3 | TTL on roles | "Bob admin until 2026-06-01" | 1 d | Agent-only |
| 4 | Conditional delegation | "Alice can invite guests, not admins" | 1 d | Skipped |
| 5 | Per-item permissions | "Item #42 private to Bruno" | ½ d | Adopted via private_to |
| 6 | Audit per human | Audit log shows human label, not just device | ¼ d | Adopted via owner_label |
| 7 | Email recovery | "Lost device → magic link → recover" | 5 d | Skipped (trust-note instead) |
| 8 | Self-service signup | Public invitation links accepted by anyone | 3 d | Skipped |
| 9 | Groups | "Group Family = [Maman, Papa, Sis], share to group" | 1 d | Skipped (label suffices) |
| 10 | Time/IP policies | "Alice only during 8-22h from FR IP" | 4-5 d | Skipped |
| 11 | Multi-tenant | "Perso fabric vs Boulot fabric" | 7-10 d | Workaround: separate backends |
| 12 | GDPR compliance | Audit export, right-to-be-forgotten, retention | 5-7 d | Skipped (audit log only) |

### B.8 Pairing UX patterns considered

#### B.8.a Numeric code on server, typed on dashboard (chosen)
HomeKit / Matter pattern.
- Code displayed in backend logs (or terminal, or systray)
- Operator types into dashboard
- SPAKE2 derives shared key
- Works regardless of server having a screen

#### B.8.b Approval notification on server + SAS comparison
- Server shows "Bruno-MacBook wants to pair — Authorize? Verify code: 4F-2A-9B"
- Both sides display short auth string for visual MITM check
- Like Signal Safety Numbers or WireGuard mobile QR
- Requires UI on the server (problem if headless)

#### B.8.c Trust-on-first-use (TOFU)
- First device that pairs becomes Owner automatically
- Subsequent require approval
- Time-bounded "bootstrap mode" mitigates race

#### B.8.d Bootstrap code in /etc file
- `/etc/ariaflow-server/bootstrap_code` mode 600 root
- First pairing must prove read access to file
- Strong but requires shell on server

#### B.8.e QR code at first boot
- Console displays QR once
- Phone scans it
- Strong but requires screen/console access

#### B.8.f Email-delivered code
- Backend sends code by email at pairing-request time
- Requires SMTP infra
- Rejected

#### B.8.g Auto-trust on same Unix UID
- "If localhost connection from uid=501, auto-pair"
- Trivial, weak, only works for the user running the server
- Useful for first-time bootstrap maybe

### B.9 RustDesk integration variants

#### B.9.a Self-hosted rustdesk-server + lejianwen/rustdesk-api
- Full control, granular permissions via API
- Requires open-source admin API fork
- ~5 days to integrate
- Run rustdesk-server + rustdesk-api as ariaflow-managed services

#### B.9.b RustDesk Pro (paid)
- Official admin API
- ~10€/month
- ~5 days to integrate

#### B.9.c RustDesk public servers + ariaflow pushes local config
- Zero infra, zero cost
- Ariaflow generates `RustDesk2.toml` on each machine
- Whitelisted IDs, permanent passwords, file/audio permissions
- No real-time revocation (config-push driven)
- Trust in rustdesk.com availability
- ~4 days

#### B.9.d Tailscale + native screen sharing (chosen)
- macOS Screen Sharing (`vnc://100.x.x.x`)
- Windows RDP (`rdp://...`)
- RustDesk in direct-IP mode over Tailscale net
- Ariaflow as launcher only
- ~1 day

#### B.9.e Headscale + RustDesk-server as fallback
- 100% self-hosted
- ACLs in Headscale cover most of the role model
- Plus RustDesk-server for cross-mesh edge cases
- ~1 day for integration in ariaflow

### B.10 LLM agent token mechanisms

#### B.10.a Custom token-with-scopes (planned MVP)
- Backend issues token with scope/filter/TTL/rate-limit/audit
- Middleware enforces on every call
- Simple, custom-made

#### B.10.b MCP (Model Context Protocol) — Anthropic standard
- Resources / Tools / Prompts abstractions
- Standard protocol, growing ecosystem
- More work upfront, future-proof
- Post-MVP enhancement

#### B.10.c UCAN (User-Controlled Authorization Network)
- Used by Bluesky, Fission
- DID-based, very capability-pure
- Heavy spec
- Probably overkill

#### B.10.d Macaroons
- Google's "cookies with caveats"
- Attenuation by appending caveats
- Mature, well-understood
- More than needed for LLM use case alone

### B.11 Impersonation modes

#### B.11.a View as (read-only) — chosen
- All GETs filtered as if target were calling
- All POSTs return 403
- Banner persistent
- ~1 day

#### B.11.b Act as (mutating)
- Mutations possible with double identity in audit log
- Forbidden actions even in this mode: revoke other admins, transfer
  ownership, generate invite-links
- Notify target user
- ~1.5 days

#### B.11.c Sudo mode
- Permanent role change for current session, not impersonation
- Less useful for debugging
- Considered, rejected

### B.12 Recovery / kill-switch mechanisms

#### B.12.a Trust-note local file (chosen)
- `/etc/ariaflow-server/trust_note` mode 600 root
- Operator with shell access can re-inject privileged device
- Physical control = ultimate authority
- ~½ day

#### B.12.b Email-based account recovery
- Standard SaaS pattern
- Requires SMTP infra
- Rejected

#### B.12.c Recovery codes printed at install
- 10 single-use codes from `ariaflow-server install`
- User stores in password manager
- Each code grants admin once
- Strong but distribution UX

#### B.12.d Hardware backup key
- Always-paired YubiKey-like fallback
- Strongest, most expensive

#### B.12.e Multi-admin requirement (no single revocation power)
- Refuse last-admin revocation
- Require N-of-M consensus for critical operations
- Considered as add-on

### B.13 Multi-backend selector evolutions

#### B.13.a Single-backend dashboard (current state)
- One `__ARIAFLOW_BACKEND_URL__` injected at HTML render
- Operator changes via env var or config

#### B.13.b Manual list with select dropdown
- `loadBackendState()` already partially supports this
- Operator manually adds backends
- No auto-discovery

#### B.13.c mDNS-discovered list (planned)
- Auto-populated from `_ariaflow-server._tcp` browse
- Operator pairs with a click

#### B.13.d Tailscale-discovered list (alternative)
- `tailscale status --json` lists peer machines
- Filter for those running ariaflow-server
- Skip mDNS entirely on Tailscale-managed networks

### B.14 Pairing simplicity tiers

#### B.14.a "Mini" — token in a file
- ½ day
- Operator copies token from `~/.ariaflow-server/bootstrap_token.txt`
- No mDNS, no SPAKE2
- Like Syncthing, qBittorrent, Sonarr

#### B.14.b "Simple" — mDNS + SPAKE2 with 6-digit code (chosen for MVP)
- ~1 day
- Auto-discovery + secure exchange
- Like HomeKit

#### B.14.c "Complete" — + roles + approvals + revocation + UI
- ~5 days
- Like Tailscale

### B.15 Anti-CSRF / anti-bruteforce options

#### B.15.a Custom-header requirement (X-Ariaflow: 1)
- Browsers preflight custom headers → blocks naive cross-origin POST
- Cheap, gross-reduction of CSRF risk

#### B.15.b Double-submit cookie
- Random value in cookie + same value in form
- Server checks they match
- Heavier, doesn't add much over header trick

#### B.15.c Origin / Referer header check
- Whitelist allowed origins
- Some browsers strip Referer in privacy mode

#### B.15.d Per-request CSRF token (synchronizer pattern)
- Server-issued token per session, validated per mutation
- Heaviest, most explicit
- Useful for high-security endpoints

#### B.15.e In-memory rate limiter
- Dict `{ip: deque[timestamps]}`, max N events per window
- ~30 lines Python
- Restart loses state

#### B.15.f SQLite-backed lockout
- After N failures in W time, ban IP for D
- Survives restarts
- Standard pattern

### B.16 Database options for the backend's auth state

#### B.16.a SQLite (recommended)
- File-based, zero deps
- Already used by Node backend if available
- Plenty fast for ≤100 devices

#### B.16.b BoltDB / LevelDB / etc.
- KV store
- More work for relational queries
- Not chosen

#### B.16.c PostgreSQL
- Overkill for selfhosted
- Adds ops burden

### B.17 Frontend identity persistence options

#### B.17.a peers.json mode 600
- Plain JSON file in user's home dir
- Encrypted-at-rest by macOS FileVault if enabled
- Simple, inspectable

#### B.17.b Keychain / Secret Service
- macOS Keychain, GNOME Keyring, KWallet
- OS-managed, requires user interaction at unlock
- More secure but more friction

#### B.17.c Encrypted file with password
- File encrypted with user-chosen passphrase
- Adds password fatigue
- Not chosen

### B.18 Rejected exotic ideas

These came up briefly during the discussion and were dismissed:

- **Blockchain-based identity** — solves no real problem, adds latency
- **DIDs (Decentralized Identifiers)** — interesting but no ecosystem locally
- **Federated SSO** — requires running an IdP
- **OIDC integration** — too heavy for a hobby setup
- **PKCE-only flow** — needs a full OAuth provider
- **TOFU certificate without fingerprint pinning** — defeats the security
- **Storing tokens in localStorage instead of memory** — XSS vector
- **Proxying all backend traffic through Python host** — false architecture
  (was a misunderstanding I had earlier; corrected)

---

## Appendix C — Glossary

| Term | Meaning |
|---|---|
| **Backend** | An ariaflow-server instance, possibly co-administered |
| **Device** | A paired client (laptop, phone) holding a `device_token` |
| **Admin** | Peer-equal full-power role |
| **Guest** | Restricted role, sees only shared resources |
| **Operator** | (Optional) admin minus destructive actions |
| **Agent** | An LLM/automation client using a capability token |
| **Owner-label** | Free-text human label on a device (e.g. "Bruno") |
| **SAS** | Short Authentication String — visual code for MITM detection |
| **SPAKE2** | Symmetric Password-Authenticated Key Exchange — the protocol used for pairing |
| **PAKE** | General term for password-authenticated key exchange protocols |
| **Tailscale** | Managed WireGuard mesh networking |
| **Headscale** | Self-hostable Tailscale-compatible control plane |
| **MCP** | Anthropic's Model Context Protocol for LLM tool/resource access |
| **TXT records** | Key-value metadata in mDNS service announcements |
| **Trust-note** | A file on the backend's local filesystem usable for last-resort recovery |
