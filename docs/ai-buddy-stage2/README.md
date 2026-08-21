# Stage 2 patch kit (AI Buddy `dsh-community-market`)

Ready-to-apply sources for registering built-in **`company-store`** without
retargeting official **`dsh-1024store`**.

Start at [patch/APPLY.md](./patch/APPLY.md). Product brief:
[../ai-buddy-company-market.md](../ai-buddy-company-market.md).

## One-command maintainer apply (preferred)

From this Store repo root, a Desktop maintainer with a writable remote can land
Stage 2 on current upstream tip without cursor[bot] push rights:

```bash
./scripts/apply-company-store-stage2.sh
# or against an existing checkout:
./scripts/apply-company-store-stage2.sh --desktop-path /path/to/deepseek-harness-desktop
```

The script clones/uses `anywhere-labs/deepseek-harness-desktop`, checks out
`master`, `git am`s [`company-store-stage2-on-9d18856.patch`](./company-store-stage2-on-9d18856.patch)
(falls back to `git apply --3way`), runs `yarn vitest run` in
`dsh-community-market`, and prints push/PR next steps. It **never pushes** and
**never opens** an upstream PR.

## Clean port on upstream `master` (`9d18856`) — manual artifacts

Verified locally: `yarn vitest run` in `dsh-community-market` → **279 passed**
(re-verified 2026-08-21 on tip `c0d5f16`, parent `9d18856`).

| Artifact | Use |
| --- | --- |
| [`../scripts/apply-company-store-stage2.sh`](../scripts/apply-company-store-stage2.sh) | **One command** — clone/checkout/`git am`/vitest/next steps |
| [`company-store-stage2-on-9d18856.patch`](./company-store-stage2-on-9d18856.patch) | `git checkout 9d18856 && git am company-store-stage2-on-9d18856.patch` |
| [`company-store-stage2-on-9d18856.bundle`](./company-store-stage2-on-9d18856.bundle) | `git fetch company-store-stage2-on-9d18856.bundle 4d46120:cursor/company-store-builtin-cb2c` (single commit on parent `9d18856`) |

Product constants in that commit match [patch/APPLY.md](./patch/APPLY.md) (`plugins.company.example`, `com.company.store.catalog`, `market.company-store-v1`, disclaimer `公司目录，收录≠安全审核`).

### Upstream PR status (this agent)

- **No clean upstream PR URL** — blocked on publishing a tip that descends from `anywhere-labs/master`.
- Obsolete dirty upstream attempts (do not reopen): [#465](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/465), [#466](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/466) — both **closed**.
- Fork-local PR (clean vs diverged fork `master` only): https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19
- Temporary sync PR on fork (upstream `master` → fork; **dirty** / conflicts): https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/20

### New-fork attempt (2026-08-21) — failed for shared history

| Step | Result |
| --- | --- |
| MCP `fork_repository` → org `hopefullstack-collab` | **Invalid**: login is a **user** account, not an organization |
| `POST /repos/anywhere-labs/deepseek-harness-desktop/forks` with `name=deepseek-harness-desktop-stage2` | **403** `Resource not accessible by integration` |
| MCP `fork_repository` (no org) | Returns existing diverged fork (cannot have two forks per user) |
| MCP `create_repository` `deepseek-harness-desktop-stage2` | Created empty repo (not a fork; no upstream network) |
| `git push --mirror` / push tip `c0d5f16` (parent `9d18856`) | **403** `Permission ... denied to cursor[bot]` |
| `POST .../git/refs` to `cursor/exact-9d18856` @ `9d18856` | **403** `Resource not accessible by integration` |
| `POST .../merge-upstream` on existing fork | **403** same |
| MCP `create_branch` | Works, but only copies an **existing branch tip** (cannot take upstream SHA) |

Existing fork vs upstream: `master` tips `2b8f88d` vs `9d18856`; compare status **diverged** (merge-base `7ff6c98`).

**Do not open more dirty upstream PRs.** Maintainer apply path below remains valid.

### Unblock permissions (exact)

| Actor | Capability needed |
| --- | --- |
| Fork owner (`hopefullstack-collab`) | GitHub UI **Sync fork** on `master`, **or** `POST /repos/hopefullstack-collab/deepseek-harness-desktop/merge-upstream` with `branch=master` |
| Token / App with **Contents: Write** (not cursor[bot] as used here) | Create ref `refs/heads/cursor/company-store-builtin-cb2c` at tip with parent `9d18856` (local tip after `git am` was `c0d5f16`), then open PR → `anywhere-labs/master` |
| Rename/delete diverged fork then re-fork | Would allow a fresh shared-history fork; current App cannot rename (`PATCH` repo → 403) |

**Maintainer fallback:** run [`../scripts/apply-company-store-stage2.sh`](../scripts/apply-company-store-stage2.sh) (or apply the patch/bundle above) on current upstream tip. Do **not** pin `COMPANY_STORE_*` until durable company Store HTTPS exists.

### Cloudflare

`wrangler whoami` → **not authenticated**. No deploy / no `COMPANY_STORE_*` pin this run.

Upstream reference clone:

`https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/dsh-community-market`
