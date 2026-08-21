# Stage 2 patch kit (AI Buddy `dsh-community-market`)

Ready-to-apply sources for registering built-in **`company-store`** without
retargeting official **`dsh-1024store`**.

Start at [patch/APPLY.md](./patch/APPLY.md). Product brief:
[../ai-buddy-company-market.md](../ai-buddy-company-market.md).

## Clean port on upstream `master` (`9d18856`) — preferred apply path

Verified locally: `yarn vitest run` in `dsh-community-market` → **279 passed**.

| Artifact | Use |
| --- | --- |
| [`company-store-stage2-on-9d18856.patch`](./company-store-stage2-on-9d18856.patch) | `git checkout 9d18856 && git am company-store-stage2-on-9d18856.patch` |
| [`company-store-stage2-on-9d18856.bundle`](./company-store-stage2-on-9d18856.bundle) | `git fetch company-store-stage2-on-9d18856.bundle 4d46120:cursor/company-store-builtin-cb2c` (single commit on parent `9d18856`) |

Product constants in that commit match [patch/APPLY.md](./patch/APPLY.md) (`plugins.company.example`, `com.company.store.catalog`, `market.company-store-v1`, disclaimer `公司目录，收录≠安全审核`).

### Upstream PR status (this agent)

- Fork PR (clean vs fork `master`): https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19
- Upstream PR [#465](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/465) / [#466](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/466): **closed** (`mergeable_state: dirty`). No further dirty upstream PRs from this agent.
- **No clean upstream PR URL** — agent could not publish tip `4d46120` onto a fork ref that descends from `anywhere-labs/master`.

### Unblock permissions (exact)

| Actor | Capability needed |
| --- | --- |
| Fork owner (`hopefullstack-collab`) | GitHub UI **Sync fork** on `master`, **or** `POST /repos/hopefullstack-collab/deepseek-harness-desktop/merge-upstream` with `branch=master` |
| GitHub App / `gh` as `cursor[bot]` | **Contents: Write** on the fork (today: **403** `Resource not accessible by integration` on `merge-upstream`, `git/refs`, `git/blobs`, `merges`) |
| Push of clean tip | Rights to push `4d46120` (parent `9d18856`) to a fork branch (today: **403** denied to `cursor[bot]`; MCP `create_branch` cannot take a SHA) |

**Maintainer fallback:** apply the patch/bundle above on current upstream tip. Do **not** pin `COMPANY_STORE_*` until durable company Store HTTPS exists.

Upstream reference clone:

`https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/dsh-community-market`
