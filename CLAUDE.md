# Directives Claude Code - ariaflow-dashboard (frontend)

## Project bindings (adjust per repo)
- **THIS_REPO:** `ariaflow-dashboard` (frontend)
- **PAIRED_REPO:** `/home/bc/repos/github/bonomani/ariaflow-server` (backend)
- **PAIRED_GAPS_FILE:** `/home/bc/repos/github/bonomani/ariaflow-server/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md`
- **LOCAL_GAPS_FILE:** `FRONTEND_GAPS.md` (at this repo root)
- **PAIRED_GAP_ID_PREFIX:** `BG-` (paired repo's gap IDs)
- **LOCAL_GAP_ID_PREFIX:** `FE-` (local repo's gap IDs)

## General rule — external repos and directories
- On ANY repo or directory other than THIS_REPO, you MAY ONLY run read-only commands: `cat`, `head`, `grep`, `find`, `ls`, `git log`, `git show`, `git diff` (without write flags).
- NEVER run mutating commands outside THIS_REPO: `git add`, `git commit`, `git push`, `git pull`, `git checkout`, `git reset`, `rm`, `mv`, `cp`, `sed`, `pip install`, or any command that modifies files, state, or history.

## Cross-repo boundary — PAIRED_REPO
- PAIRED_REPO is a separate project. All communication is through its public interface (API, protocol, CLI, etc.).
- You MAY read PAIRED_REPO source files to stay in sync with contracts, types, and behavior.
- EXCEPTION: You MAY write/update **PAIRED_GAPS_FILE** to report missing or inconsistent behavior discovered during work in THIS_REPO. No other writes allowed.
- If the user asks you to operate on PAIRED_REPO (beyond reading or the gaps file exception), remind them of this boundary and suggest they use a separate session from that repo.

## Gap reporting — STRICT

**Location**
- Single source of truth: **PAIRED_GAPS_FILE**. This is the ONLY location for gaps about PAIRED_REPO.
- NEVER create a copy of PAIRED_GAPS_FILE in THIS_REPO. No mirrors, no duplicates.
- LOCAL_GAPS_FILE tracks gaps about THIS_REPO only — it lives at the repo root and is authored by this agent.

**When to file a paired-repo gap**
- PAIRED_REPO is missing a feature THIS_REPO needs.
- Its public interface returns inconsistent, malformed, or undocumented data.
- Its behavior contradicts its own documentation or spec.
- A declared capability is not populated, or a populated capability is not declared.

**Before filing — mandatory checks**
1. Read the CURRENT PAIRED_REPO source to confirm the issue still exists (may already be fixed).
2. Read PAIRED_GAPS_FILE to avoid filing a duplicate.
3. If unsure whether it's a THIS_REPO or PAIRED_REPO problem, investigate both sides first.

**Gap entry format** (for PAIRED_GAPS_FILE)
Each open gap must have:
- A stable ID: `{PAIRED_GAP_ID_PREFIX}N` (next available number, never reuse IDs).
- A one-line summary as the heading: `### {ID}: <summary>`
- A description: what's wrong, with file:line references if relevant.
- **Desired:** what PAIRED_REPO should do.
- **Impact on THIS_REPO:** why it matters / what's blocked or degraded.
- **Blocks local gap:** the corresponding `{LOCAL_GAP_ID_PREFIX}N` entry in LOCAL_GAPS_FILE. Use `(none)` if it's pure infrastructure with no user-visible counterpart in THIS_REPO.
- **Priority:** `critical` / `high` / `medium` / `low`.

**Pairing rule — MANDATORY**
- When you file a paired-repo gap, you MUST also file a corresponding entry in LOCAL_GAPS_FILE, marked as `Blocked by: {PAIRED_GAP_ID}`.
- The local gap describes what the user sees (or doesn't see) because of the missing paired-repo feature.
- Exception: if the paired gap is pure infrastructure (e.g. logging, schema quality, tooling) with no user-visible local counterpart, note `Blocks local gap: (none)` in the paired entry and skip the local gap.
- When a paired-repo gap is resolved, check the paired local gap: if it's now unblocked, either move it to Resolved (if the fix is already consumed) or re-scope it as an active local task.

**Lifecycle**
- Open gaps live under the top of the file.
- When a gap is fixed, it should be moved to the `## Resolved` table with a one-line resolution note and keep its ID.
- If a gap becomes obsolete (the asking side no longer needs it, e.g. feature removed or scope changed), add an `**Obsolete for {THIS_REPO}:** <reason>` annotation to the paired entry. The paired agent may then delete or keep it as it prefers.

**Final cleanup step — MANDATORY after any gap-related work**
When closing a task that touched gap files, always end with a cleanup pass:
1. Re-read BOTH files (PAIRED_GAPS_FILE and LOCAL_GAPS_FILE).
2. For every entry in the paired Resolved table, verify the paired local gap is either (a) also resolved, (b) re-scoped as an active local task, or (c) annotated `**Obsolete for {THIS_REPO}:** <reason>` in the paired entry.
3. Trim stale Resolved entries when they clutter the file (e.g. 10+ entries accumulated, or clearly no longer informative). History lives in git.
4. Ensure every open paired-repo gap has its paired local gap (`Blocked by: ID`) or is explicitly marked `Blocks local gap: (none)`.
5. If the local gap for a resolved paired item would never be useful again, mark it `**Obsolete for {THIS_REPO}:** <reason>` in the paired entry so future agents know not to re-implement it.

**Verification before committing changes based on gaps**
- Before asserting a gap is resolved, re-verify against CURRENT source, not memory.
- Before claiming a gap is blocking work, check if there's a viable local-only workaround first — workarounds should be documented in the gap entry.
