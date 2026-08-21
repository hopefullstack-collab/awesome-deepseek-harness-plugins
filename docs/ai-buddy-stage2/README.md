# Stage 2 patch kit (AI Buddy `dsh-community-market`)

Ready-to-apply sources for registering built-in **`company-store`** without
retargeting official **`dsh-1024store`**.

Start at [patch/APPLY.md](./patch/APPLY.md). Product brief:
[../ai-buddy-company-market.md](../ai-buddy-company-market.md).

## Clean port on upstream `master` (`9d18856`) — preferred apply path

Verified locally: `yarn vitest run` in `dsh-community-market` → **279 passed**
(re-verified 2026-08-21 on tip `c0d5f16`, parent `9d18856`).

| Artifact | Use |
| --- | --- |
| [`company-store-stage2-on-9d18856.patch`](./company-store-stage2-on-9d18856.patch) | `git checkout 9d18856 && git am company-store-stage2-on-9d18856.patch` |
| [`company-store-stage2-on-9d18856.bundle`](./company-store-stage2-on-9d18856.bundle) | `git fetch company-store-stage2-on-9d18856.bundle 4d46120:cursor/company-store-builtin-cb2c` (single commit on parent `9d18856`) |

Product constants in that commit match [patch/APPLY.md](./patch/APPLY.md) (`plugins.company.example`, `com.company.store.catalog`, `market.company-store-v1`, disclaimer `公司目录，收录≠安全审核`).

### Upstream PR status (this agent)

- **No clean upstream PR URL** — blocked on publishing a tip that descends from `anywhere-labs/master`.
- Obsolete dirty upstream attempts (do not reopen): [#465](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/465), [#466](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/466) — both **closed**.
- Fork-local PR (clean vs diverged fork `master` only): https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19
- Temporary sync PR on fork (upstream `master` → fork; **dirty** / conflicts): https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/20

### Writable-remote probe (2026-08-21, refreshed)

Identity: GitHub MCP `get_me` → `hopefullstack-collab`. Upstream `master` still `9d18856`.

| Candidate | Proper fork? | Write result |
| --- | --- | --- |
| `hopefullstack-collab/deepseek-harness-desktop` | **Yes** | MCP `create_branch` + `push_files` **OK** on existing fork history. Local clean tip `4d46120` (parent `9d18856`, 1 commit) **cannot** `git push` → **403** `denied to cursor[bot]`. `merge-upstream` / `git/refs` @ `9d18856` → **403** integration. |
| `hopefullstack-collab/deepseek-harness-desktop-stage2` | No (docs-only) | MCP branch create OK; not on upstream PR network. |
| `jo32/DeepDeck` | No | MCP `create_branch` → **404** (no write). |

### Earlier new-fork attempt — failed for shared history

| Step | Result |
| --- | --- |
| MCP `fork_repository` → org `hopefullstack-collab` | **Invalid**: login is a **user** account, not an organization |
| `POST /repos/anywhere-labs/deepseek-harness-desktop/forks` with `name=deepseek-harness-desktop-stage2` | **403** `Resource not accessible by integration` |
| MCP `fork_repository` (no org) | Returns existing diverged fork (cannot have two forks per user) |
| MCP `create_repository` `deepseek-harness-desktop-stage2` | Created empty repo (not a fork; no upstream network) |
| `git push` clean tip (parent `9d18856`) | **403** `Permission ... denied to cursor[bot]` |
| `POST .../git/refs` @ `9d18856` | **403** `Resource not accessible by integration` |
| `POST .../merge-upstream` | **403** same |
| MCP `create_branch` | Works, but only copies an **existing branch tip** (cannot take upstream SHA) |

Existing fork vs upstream: `master` tips `2b8f88d` vs `9d18856`; compare status **diverged** (merge-base `7ff6c98`).

**Do not open more dirty upstream PRs.** Maintainer apply path below remains valid. Patch-only delivery repo skipped (redundant with this Store PR).

### Unblock permissions (exact)

| Actor | Capability needed |
| --- | --- |
| Fork owner (`hopefullstack-collab`) | GitHub UI **Sync fork** on `master`, **or** `POST /repos/hopefullstack-collab/deepseek-harness-desktop/merge-upstream` with `branch=master` |
| Token / App with **Contents: Write** (not cursor[bot] as used here) | Create ref `refs/heads/cursor/company-store-builtin-cb2c` at tip with parent `9d18856` (local tip after `git am` was `c0d5f16`), then open PR → `anywhere-labs/master` |
| Rename/delete diverged fork then re-fork | Would allow a fresh shared-history fork; current App cannot rename (`PATCH` repo → 403) |

**Maintainer fallback:** apply the patch/bundle above on current upstream tip. Do **not** pin `COMPANY_STORE_*` until durable company Store HTTPS exists.

### Cloudflare

`CLOUDFLARE_API_TOKEN` unset; `wrangler whoami` → **not authenticated**. No durable deploy / no `COMPANY_STORE_*` pin. Keepalive device verify still running with code **`UYXhiK4t`**. One-shot ≥15m CF recheck timer subscribed.

Upstream reference clone:

`https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/dsh-community-market`
