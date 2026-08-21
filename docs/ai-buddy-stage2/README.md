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
- Upstream PR #465 / #466: open but `mergeable_state: dirty` — fork history does not share a merge-base with `anywhere-labs/master`. This agent cannot create a fork ref at upstream SHA `9d18856` (MCP `create_branch` only accepts branch names; `gh` integration token **403** on `git/refs`; `git push` as `cursor[bot]` **403**). **Maintainers should apply the patch/bundle above on upstream tip**, or push rights for commit `4d46120`.

Do **not** pin `COMPANY_STORE_*` until durable company Store HTTPS exists.

Upstream reference clone:

`https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/dsh-community-market`
