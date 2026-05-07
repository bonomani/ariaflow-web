# Hardware-Bound Identity — Design Doc

> Status: design only — no implementation yet.
>
> Goal: capture the architecture for cryptographically enforced
> per-(machine, component, user) identity using platform hardware
> (Secure Enclave on macOS, TPM 2.0 on Linux/Windows). Identity proof
> requires the physical hardware that registered it; copying files
> across machines does not allow impersonation.
>
> This is **Position A** from the conversation thread that led here:
> "two machines with same user+component must remain crypto-distinct,
> even if their keys are copied between them."

## Table of Contents

1. [Why hardware binding](#1-why-hardware-binding)
2. [Identity model](#2-identity-model)
3. [Platform-specific key custody](#3-platform-specific-key-custody)
4. [Pairing flow](#4-pairing-flow)
5. [Request signing flow](#5-request-signing-flow)
6. [Cross-platform abstraction layer](#6-cross-platform-abstraction-layer)
7. [Migration from current state](#7-migration-from-current-state)
8. [Threat model](#8-threat-model)
9. [Phased implementation plan](#9-phased-implementation-plan)
10. [Risks & open questions](#10-risks--open-questions)

---

## 1. Why hardware binding

Software-only identity ("file mode 600 with a private key") is **not
machine-bound**. The file can be copied to another machine, where the
same user can run the same component. The signatures from machine B
using machine A's keys are indistinguishable from machine A's own
signatures — the backend has no way to verify physical origin.

This contradicts the project's identity goal: **identity should be the
triple `(machine, component, user)`, with two machines staying
distinct even when user and component match**.

The only way to make `machine` cryptographically real is to make the
**signing operation itself** require physical hardware that exists on
exactly one machine. Three platforms provide this:

- **macOS** (Apple Silicon and T2-equipped Intel): **Secure Enclave**.
  Private keys are generated inside the SEP and never extractable.
  Signing is an IPC call to the SEP chip.
- **Linux**: **TPM 2.0** via libtss2 / tpm2-tools. Most modern hardware
  has a TPM 2.0 chip; firmware-emulated fallback exists for laptops
  without one.
- **Windows**: **TPM 2.0** via NCrypt API or PowerShell `Get-Tpm`.
  Required by Windows 11.

All three offer:
- Key generation that never produces an extractable private key
- Signature operation that requires the original hardware
- Optional biometric/PIN gating before signing (Touch ID, Windows Hello)

## 2. Identity model

### Identity tuple

```
identity = (machine, component, user)
identity_id = sha256(machine_uuid || component_id || user_id)[:16]
```

Where:

| Field | Source on macOS | Source on Linux | Source on Windows |
|---|---|---|---|
| `machine_uuid` | `IOPlatformUUID` | `/etc/machine-id` | `MachineGuid` from registry |
| `component_id` | service label / binary hash | systemd unit / binary hash | service name / binary hash |
| `user_id` | `getuid()` + username | `getuid()` + username | SID + username |

### Display name

Human-readable principal name:

```
<component>/<user>@<machine>

Examples:
  ariaflow-dashboard/bc@bcs-mac-mini
  ariaflow-server/maman@maman-pc
```

### Public identity record (stored backend-side)

```sql
CREATE TABLE identities (
  identity_id        TEXT PRIMARY KEY,            -- sha256[:16]
  display_name       TEXT NOT NULL,                -- "dashboard/bc@host"
  component          TEXT NOT NULL,
  user_username      TEXT NOT NULL,
  user_uid           INTEGER,
  machine_uuid_hash  TEXT NOT NULL,                -- attestation reference
  public_key         TEXT NOT NULL,                -- Ed25519 or ECDSA P-256 pubkey
  hardware_attestation TEXT,                       -- platform-specific blob
  attestation_valid_until INTEGER,                 -- attestation can expire
  role               TEXT NOT NULL,                -- admin/operator/guest
  paired_at          INTEGER NOT NULL,
  paired_by          TEXT REFERENCES identities(identity_id),
  last_seen_at       INTEGER,
  revoked_at         INTEGER
);
```

The critical field is `hardware_attestation`: a platform-specific blob
that proves the public_key was generated inside genuine hardware. The
backend can verify the attestation chain at pairing time (and re-verify
periodically) to ensure the key isn't a software simulation.

### Why hardware attestation matters

Without attestation, an attacker on a malicious machine could:
1. Generate a software keypair
2. Submit `(identity_id, public_key, machine_uuid_hash)` claiming hardware
3. Pair successfully

With attestation, the backend can verify "this public_key really lives
inside a Secure Enclave / TPM that I trust." Apple, Microsoft, and TCG
provide attestation chains rooted in their respective platform CAs.

Tradeoff: attestation chain verification adds dependency on platform
CA infrastructure. For selfhost we may accept "trust on first use"
(TOFU) attestation — operator sees the platform claim during pairing
and approves.

## 3. Platform-specific key custody

### 3.1 macOS — Secure Enclave (Apple Silicon, T2-Intel)

#### Key creation

```swift
import Security

let access = SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    [.privateKeyUsage],  // ← key cannot leave the SEP
    nil
)!

let attributes: [String: Any] = [
    kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom,
    kSecAttrKeySizeInBits: 256,
    kSecAttrTokenID: kSecAttrTokenIDSecureEnclave,  // ← live in SEP
    kSecPrivateKeyAttrs: [
        kSecAttrIsPermanent: true,
        kSecAttrApplicationTag: "com.bonomani.ariaflow.identity.\(identity_id)",
        kSecAttrAccessControl: access,
    ],
]

var error: Unmanaged<CFError>?
let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error)
```

The returned `privateKey` is a **handle**. The actual key bytes never
exist outside the SEP.

#### Signing

```swift
let signature = SecKeyCreateSignature(
    privateKey,
    .ecdsaSignatureMessageX962SHA256,
    message as CFData,
    &error
)
```

The SEP performs the signing internally. CPU never sees the key.

#### Bindings for our codebase

Three options:

- **A. Native CLI helper** — small Swift binary, bundled in the brew
  bottle. Python/Node call it via subprocess. ~50 lines Swift.
- **B. PyObjC** — Python bindings to Apple's Security framework. No
  native binary, but PyObjC adds ~30 MB to the bottle.
- **C. ffi-rs** with `keyring` crate that supports SE — smaller, but
  Rust toolchain in CI.

**Recommendation**: A. Smallest dependency footprint, easiest to ship,
operator never sees Swift unless debugging.

#### Attestation

`SecKeyCopyAttestationData` returns a CMS-format attestation that
chains up to Apple's manufacturing CA. The backend can verify it
matches `apple_root_ca_apple_silicon`.

For selfhost, we may opt out of attestation chain validation and
accept the SEP's claim by reference: "this key was created with
`kSecAttrTokenIDSecureEnclave`" — trust on first use.

### 3.2 Linux — TPM 2.0

#### Key creation

```bash
# Create primary key in storage hierarchy
tpm2_createprimary -C o -G ecc256 -c primary.ctx

# Create signing key as child
tpm2_create -C primary.ctx -G ecc256 \
    -u key.pub -r key.priv \
    -a "fixedtpm|fixedparent|sensitivedataorigin|sign"

# Load into TPM
tpm2_load -C primary.ctx -u key.pub -r key.priv -c key.ctx
```

The key is sealed to this specific TPM. Loading on another machine's
TPM fails because the encryption is bound to the original chip.

#### Signing

```bash
tpm2_sign -c key.ctx -g sha256 -s ecdsa -o signature.bin message.bin
```

#### Bindings for our codebase

- **A. tpm2-tools subprocess** — system package on most distros, can be
  declared as brew dependency. Wraps every operation as exec call.
- **B. python-tss** — direct Python bindings to libtss2. Smaller
  footprint, no subprocess overhead.
- **C. Rust `tpm2-rs` crate** — same trade-off as macOS option C.

**Recommendation**: A initially for simplicity, B if performance becomes
an issue (cold-tpm2-tools call is ~100ms; not great for per-request
signing).

#### Attestation

`tpm2_certify` produces a certificate signed by the TPM's Endorsement
Key (EK). The EK certificate chains to the manufacturer's CA (Intel,
STMicro, Infineon, etc.).

For selfhost, accept "trust on first use" — the EK cert is checked at
pairing time; if it's a recognizable TPM brand and the chip looks
genuine, approve.

### 3.3 Windows — TPM 2.0 via NCrypt

#### Key creation

```powershell
$keyName = "com.bonomani.ariaflow.identity.$identity_id"
$keyParams = @{
    Subject = "CN=$identity_id"
    KeyAlgorithm = "ECDSA_P256"
    KeyUsage = "DigitalSignature"
    Provider = "Microsoft Platform Crypto Provider"  # ← TPM-backed
    KeyExportPolicy = "NonExportable"
}
New-SelfSignedCertificate @keyParams -CertStoreLocation cert:\LocalMachine\My
```

The `Microsoft Platform Crypto Provider` ensures the key is bound to
the local TPM 2.0.

#### Signing

```powershell
$cert = Get-ChildItem cert:\LocalMachine\My | Where-Object Subject -eq "CN=$identity_id"
$signature = $cert.PrivateKey.SignData($message, "SHA256")
```

#### Bindings for our codebase

- **A. PowerShell subprocess** — ships with Windows, no extra install.
  Cross-platform consistency with the macOS approach (subprocess).
- **B. .NET interop** — only if we ever ship a native Windows app.

**Recommendation**: A.

#### Attestation

Windows TPM provides `TpmAttestationCreate` for AIK-based attestation.
For selfhost, TOFU again is reasonable.

## 4. Pairing flow

### Step-by-step

```
Operator clicks "Pair this device" on the dashboard:

1. Dashboard computes identity:
     machine_uuid = read_machine_uuid()
     component   = "ariaflow-dashboard"
     user        = current OS user
     identity_id = sha256(machine_uuid || component || user)[:16]
     display     = "dashboard/<user>@<machine>"

2. Dashboard generates hardware-bound keypair:
     macOS:  SecKeyCreateRandomKey with SE token
     Linux:  tpm2_create
     Windows: New-SelfSignedCertificate (TPM provider)

   Stores handle / context locally:
     ~/.ariaflow-dashboard/identities/<identity_id>/handle.json

3. Dashboard requests attestation:
     macOS:  SecKeyCopyAttestationData
     Linux:  tpm2_certify
     Windows: TpmAttestationCreate

4. POST /api/identity/pair to backend:
     {
       identity_id, display_name, component,
       user_username, user_uid, machine_uuid_hash,
       public_key, attestation_blob, attestation_format
     }

5. Backend optionally verifies attestation:
     - Apple SE: chain to apple_root_ca
     - TPM 2.0: chain to manufacturer CA
     - Fallback: trust on first use, log "attestation NOT verified"

6. Backend stores the identity in pending state, notifies admin (SSE
   broadcast or banner).

7. Admin approves with role:
     POST /api/identity/<id>/approve { role: "admin"|"operator"|"guest" }

8. Backend marks identity as active. Dashboard receives confirmation,
   stores `paired=true` flag locally.
```

### Pairing UX

Two flavors based on the SPAKE2 discussion:

#### Flavor A — Self-attestation only (no SPAKE2)
Dashboard self-asserts its identity. Admin approves based on display
name + attestation. No code typing.

Pros: simple, no extra step.
Cons: an attacker who's compromised the LAN could submit fake pairings
hoping admin clicks Approve.

#### Flavor B — SPAKE2 + attestation (defense in depth)
Admin generates a one-time code. Operator types it on the new machine.
SPAKE2 derives a shared secret which the dashboard mixes into its
attestation request, proving "an authorized human is at the console
right now."

Pros: prevents passive attackers from registering fake identities.
Cons: more steps; requires admin to dispense codes.

**Recommendation**: ship Flavor A first, add SPAKE2 layer later if
threat model evolves.

## 5. Request signing flow

### Per-request

```
Dashboard wants to call POST /api/downloads:

1. Construct canonical message:
     msg = timestamp || method || path || sha256(body)
     (timestamp = milliseconds, prevents replay)

2. Sign with hardware:
     macOS:  SecKeyCreateSignature(privateKeyHandle, msg)
     Linux:  tpm2_sign
     Windows: $cert.PrivateKey.SignData

3. Build headers:
     X-Identity:   <identity_id>
     X-Timestamp:  <ms>
     X-Signature:  base64(sig)
     X-Machine-Hint: <machine_uuid_hash>   # for backend logging only

4. Send request

Backend middleware:

1. Parse X-Identity → look up identity record (must exist + not revoked)
2. Verify timestamp within window (default ±5 min)
3. Reconstruct canonical message
4. Verify signature against stored public_key
5. (optional) Log machine_uuid_hash for audit; alert if differs
   significantly from stored value
```

### Why timestamp + sha256(body)

Without timestamp: attacker captures a signed request, replays it
indefinitely. Backend rejects timestamps too far from now.

Without body hash: attacker takes a benign signed GET request, bolts
on a malicious POST body. Body hash binds the body to the signature.

### Performance considerations

Per-request hardware signing has overhead:

| Platform | Approx signing time |
|---|---|
| macOS SE (Apple Silicon) | ~5-10 ms |
| macOS SE (T2 Intel) | ~10-20 ms |
| Linux TPM (firmware) | ~50-100 ms |
| Linux TPM (discrete chip) | ~10-30 ms |
| Windows TPM | ~20-50 ms |

For interactive UI clicks (~1-10 req/s), this is invisible. For SSE
heavy traffic or polling-heavy patterns, may need to amortize:

- Sign once per "session" with a short-lived bearer that's separately
  attested. Like Kerberos service tickets.
- Or batch-sign: one signature covers a window of requests.

**Recommendation**: don't optimize until measured. Start naive
per-request signing.

## 6. Cross-platform abstraction layer

To keep the consumer code clean, abstract the platform difference:

```python
# src/ariaflow_dashboard/identity_hw.py

from abc import ABC, abstractmethod

class IdentityProvider(ABC):
    @abstractmethod
    def create_identity(self, identity_id: str) -> IdentityHandle: ...

    @abstractmethod
    def load_identity(self, identity_id: str) -> IdentityHandle | None: ...

    @abstractmethod
    def sign(self, handle: IdentityHandle, message: bytes) -> bytes: ...

    @abstractmethod
    def public_key(self, handle: IdentityHandle) -> bytes: ...

    @abstractmethod
    def attestation(self, handle: IdentityHandle) -> AttestationBlob: ...


class SecureEnclaveProvider(IdentityProvider):
    """Apple Secure Enclave via Swift CLI helper."""
    ...

class Tpm2Provider(IdentityProvider):
    """TPM 2.0 via tpm2-tools subprocess."""
    ...

class WindowsTpmProvider(IdentityProvider):
    """Windows TPM via PowerShell + NCrypt."""
    ...

class SoftwareFallbackProvider(IdentityProvider):
    """File-based keys, mode 600. Used when no hardware available.
    Identity record marks `attestation_format = 'software'` so backend
    can apply lower-trust policy or refuse."""
    ...


def detect_provider() -> IdentityProvider:
    if sys.platform == "darwin" and has_secure_enclave():
        return SecureEnclaveProvider()
    if sys.platform.startswith("linux") and has_tpm2():
        return Tpm2Provider()
    if sys.platform == "win32" and has_tpm2():
        return WindowsTpmProvider()
    return SoftwareFallbackProvider()
```

Backend mirrors this abstraction:

```typescript
// packages/core/src/identity/attestation.ts

interface AttestationVerifier {
  verify(blob: AttestationBlob, expectedPubkey: PublicKey): VerifyResult;
}

class AppleSeAttestationVerifier implements AttestationVerifier { ... }
class Tpm2AttestationVerifier implements AttestationVerifier { ... }
class SoftwareAttestationVerifier implements AttestationVerifier { ... }
```

## 7. Migration from current state

Today the dashboard authenticates via... actually, today it doesn't
authenticate at all (no auth on `/api/*` endpoints). This refactor is
not a *replacement* of an existing auth scheme — it's the first auth
scheme.

### Coexistence with no-auth mode

During phase rollout:

```
Backend middleware order:
  1. If config.require_signed_requests = false:
       allow all (current behavior)
  2. If header X-Identity is present AND signed correctly:
       accept, log identity_id
  3. If config.require_signed_requests = true AND no signature:
       401
```

Operators opt in by setting `require_signed_requests: true` in the
declaration. Default `false` for the rollout window (~1 month).

### Coexistence with SoftwareFallbackProvider

If an operator runs ariaflow-dashboard on a machine without SE/TPM
(VM without TPM passthrough, old Linux box), the SoftwareFallbackProvider
generates file-based keys and stamps `attestation_format = 'software'`
on the identity record.

Backend policy choice:
- `policy.allow_software_attestation = true` (default for selfhost):
  accept, but require admin double-confirmation at pairing time
- `policy.allow_software_attestation = false` (strict mode): reject

This lets operators run on legacy hardware while making the
hardware-binding limitation explicit.

## 8. Threat model

### What this design defends against

✅ **Stolen laptop, file copy** — keys can't be extracted from SE/TPM.
   Even with full disk access on the stolen device, attacker can't
   migrate identity to their own machine.

✅ **Malware with user-level access on the legitimate machine** — can
   request signatures (via the user's running session), but cannot
   exfiltrate the key. If signing requires biometric/PIN gate, malware
   can't even sign without user approval.

✅ **Same-user different-machines confusion** — `(uuid_A, dashboard, bc)`
   and `(uuid_B, dashboard, bc)` are distinct identities backed by
   distinct hardware. No accidental conflation.

✅ **Backup/iCloud sync** — SEP keys are not synced (created with
   `kSecAttrSynchronizable=false`). TPM keys can't be backed up by
   design.

### What this design does NOT defend against

❌ **Compromised SE/TPM** (firmware bug, hardware exploit) — fixable
   only by hardware vendor. Out of scope.

❌ **Attacker with root + physical access on the legitimate machine**
   — can request signatures any time. Same threat model as a session-
   compromised user. Mitigation: biometric gate per-request (slows
   attacker but doesn't stop a determined adversary with root).

❌ **Replay attacks** — covered by timestamp + nonce in canonical
   message. Window must be tight.

❌ **MITM during pairing** — covered if combined with SPAKE2 (Flavor B
   in §4). Without SPAKE2, attacker on LAN could register a fake
   identity hoping for admin approval.

❌ **Social engineering of admin** — admin clicks Approve on a malicious
   pairing request. Mitigation: display name should clearly identify
   machine + user; high-trust pairings require SPAKE2.

❌ **Quantum cryptanalysis** — Ed25519/ECDSA are vulnerable to a
   sufficiently large quantum computer. Migration to PQC signatures
   when standards stabilize. Out of scope for now.

## 9. Phased implementation plan

### Phase 1 — Software fallback only (~3 days, no hardware involvement)

**Goal**: ship the IdentityProvider abstraction + the file-based
fallback. No hardware code yet. Identity records tagged
`attestation_format = 'software'`.

This validates the API contracts (pair, list, revoke, sign, verify)
without committing to hardware integration.

**Acceptance**:
- Pair flow works end-to-end with file-based keys
- Backend stores identities, distinguishes them by identity_id
- Request signing and verification work
- Tests cover pair / sign / verify / revoke

### Phase 2 — macOS Secure Enclave (~3 days)

**Goal**: replace SoftwareFallbackProvider with SecureEnclaveProvider
on Apple Silicon hosts. Ship a small Swift CLI helper bundled in the
dashboard's brew bottle.

**Acceptance**:
- Bottle includes `ariaflow-identity-helper` Swift binary
- Pair flow generates SE-bound keys; attestation blob present
- Signing time < 50 ms typical
- Software fallback still works on non-SE Macs (older Intel without T2)

### Phase 3 — Linux TPM 2.0 (~3 days)

**Goal**: Tpm2Provider via tpm2-tools subprocess.

**Acceptance**:
- Brew dependency on `tpm2-tools` (or apt/dnf for non-brew Linux)
- Pair flow generates TPM-sealed keys
- Backend verifies TPM EK certificate chain (or accepts TOFU)
- Software fallback for systems without TPM

### Phase 4 — Windows TPM 2.0 (~2 days)

**Goal**: WindowsTpmProvider via PowerShell + NCrypt.

**Acceptance**:
- Pair flow generates TPM-bound certificate
- Sign / verify works
- Compatible with Windows 11 (TPM 2.0 mandated)

### Phase 5 — Backend attestation verification (~3 days)

**Goal**: backend can verify attestation chains from Apple SE, TPM
manufacturers, and decide policy (accept/reject software attestation).

**Acceptance**:
- Apple root CA chain validated for SE attestations
- Common TPM manufacturer CAs (Intel, STMicro, Infineon, etc.)
  validated
- Policy switch in declaration: strict / permissive / disabled

### Phase 6 — UI tab Devices + role management (~2 days)

**Goal**: admin UI to view paired identities, approve pending,
assign/change role, revoke.

**Acceptance**:
- "Devices" tab visible to admins
- Each row: display_name, attestation status, role, last_seen, actions
- Pending pairing requests show with Approve [role ▼] / Reject
- Admin can revoke any identity, including the one currently in use
  (with confirmation)

### Phase 7 — Polish + docs + canary rollout (~2 days)

**Goal**: documentation, troubleshooting guide, gradual rollout via
`require_signed_requests` flag.

**Total**: ~18 days for full hardware-bound identity across 3 platforms.

### Independently shippable phases

- Phase 1 alone is useful: identities tracked, audit log per identity,
  even if attestation is software. Ships in 3 days.
- Phases 2-4 can ship in any order; each platform independent.
- Phase 5 (attestation verification) can stay in TOFU mode for months
  if no compelling reason to chain-verify.
- Phase 6 (UI) depends on Phase 1 only.

## 10. Risks & open questions

### 10.1 Phase 1 software fallback — false sense of security

**Risk**: shipping Phase 1 with software-only attestation gives the
impression of "hardware-bound identity" when it isn't. Operators may
think they're protected.

**Mitigation**: large warning at pair time when software fallback is
used: "This identity uses file-based keys. Keys are not bound to this
machine's hardware. See docs/HARDWARE_BOUND_IDENTITY.md for details."
The identity record's `attestation_format` field is exposed in the UI.

### 10.2 Linux laptops without TPM

**Risk**: older Linux laptops or ARM SBCs without TPM 2.0. Fallback to
software is the only option.

**Mitigation**: detect at startup, document the limitation, allow opt-in
to SoftwareFallbackProvider with explicit operator acknowledgment.

### 10.3 Cross-platform signing-time variance

**Risk**: TPM firmware operations can be slow (~100ms). For high-rate
event streams (SSE heartbeats, frequent polls), this aggregates.

**Mitigation**: introduce session tickets — sign once at session start,
issue a short-lived bearer (~5min) that doesn't require hardware per
request. Like Kerberos. Phase 7+ optimization.

### 10.4 Attestation root CA bootstrapping

**Risk**: backend needs Apple root CA, TPM manufacturer roots, etc.
Bundling them in the codebase means they need updates. Skipping them
means TOFU only.

**Mitigation**: ship known roots in `packages/core/src/identity/roots.ts`
with a comment about update cadence. Allow operator to disable chain
verification per-platform if they want lighter trust model.

### 10.5 Identity rotation / re-keying

**Question**: if a key is suspected compromised (malware on the
machine, before being detected), how does an operator rotate?

**Answer**: revoke the identity from the admin UI, then re-pair from
the affected machine. New keypair, new attestation, fresh trust.

### 10.6 What if an operator wants to clone a VM

**Question**: VMs duplicate every byte including TPM state. Clone has
the same TPM (technically — vTPMs included). Do we accept that as
two valid distinct identities or detect duplication?

**Answer**: treat each instance as distinct. If both VMs run the same
component as the same user simultaneously, both will appear with
different `last_seen_at` patterns. Operators can manually revoke one
if intentional cloning isn't desired.

### 10.7 Touch ID / biometric gate per-request

**Question**: should signing require Touch ID for every action, or
unlock once per session?

**Answer**: configurable. Default: unlock at startup (one Touch ID),
cache the SEP unlock state for the dashboard's process lifetime.
Critical actions (revoke another identity, change role) require fresh
Touch ID. Backend declares which actions are "critical."

### 10.8 What about `detect_managed_by` aspect

**Question**: today the backend has `(managed_by, installed_via)` axes
for lifecycle. Does the identity model integrate with this?

**Answer**: orthogonal. `managed_by` is about who supervises the
process. Identity is about who can talk to it. A launchd-supervised
backend can be talked to by a Tailscale-connected admin from a
different machine.

### 10.9 macOS recovery: what happens after Erase All Content & Settings?

**Answer**: SE keys are wiped. Identity becomes unusable. Operator
must re-pair. This is the desired behavior — it's the same machine,
but the SE has been reset, so cryptographically it's a "new identity."

### 10.10 Multi-component on same machine

**Question**: dashboard and server both run on `bcs-mac-mini` as user
`bc`. Two distinct identities `dashboard/bc@host` and `server/bc@host`.
Each has its own SE keypair. Total 2 keys for one (machine, user) pair.
Acceptable cost.

---

## Appendix A — Comparison table

| Aspect | Today (no auth) | Phase 1 (software) | Phase 2-4 (hardware) |
|---|:-:|:-:|:-:|
| Identity verifiable | ❌ | ✅ logically | ✅ cryptographically |
| Resists file copy | n/a | ❌ | ✅ |
| Resists root malware | n/a | ❌ | 🟡 (mitigates, doesn't stop) |
| Cross-platform | ✅ | ✅ | ✅ (different impls) |
| Attestation chain | n/a | software stamp | hardware-rooted |
| Implementation cost | 0 | 3 days | 18 days |
| Operator complexity | 0 | low | medium (TPM enable, etc.) |

## Appendix B — Comparison with prior art

| System | Key custody | Identity granularity |
|---|---|---|
| WebAuthn / Passkeys | SE / TPM via OS | Per-origin per-device |
| HomeKit | SE on iOS/macOS | Per home, per device, with home-key sharing |
| Tailscale | Software (Wireguard keys, file-based) | Per-device, OAuth identity |
| Matter / Thread | DAC (Device Attestation Cert) on chip | Per-device, fabric-administered |
| Apple Setup Assistant Continuity | iCloud + SE-derived | Per Apple ID + per device |
| Kerberos | KDC tickets, optional smartcard | Per service principal |

The proposed model is closest to **WebAuthn**: per (machine, component,
user) keypair living in platform secure storage, attested at pairing,
verified per-request.
