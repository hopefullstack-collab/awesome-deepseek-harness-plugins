# Company 1024Store + AI Buddy `company-store` — goal completion checklist

**Status:** Goal remains **ACTIVE**. Durable public company HTTPS + Stage 2
built-in verified against that origin are **not** done. Local/interim tunnel
evidence does **not** complete M1.

Re-verified CF auth blocker (this turn):

| Check | Result |
| --- | --- |
| `npx wrangler whoami` | Not authenticated |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` env | Absent |
| Cursor `environment-info` | `environment: null` (no linked secrets) |
| GitHub Actions secrets API | 403 for this integration (cannot list values; operator must confirm names in repo Settings) |
| Wrangler temporary preview account | Ephemeral only — Managed Challenge / missing D1; **not** durable M1 |

PRs:

- Store: https://github.com/hopefullstack-collab/awesome-deepseek-harness-plugins/pull/1 (`cursor/company-store-fork-cb2c`)
- Desktop: https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19 (`cursor/company-store-builtin-cb2c`)

---

## M1 — Company Store public HTTPS (durable)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Curated-only catalog policy (`TOPIC_DISCOVERY_ENABLED=0`, `from_pr=1`) | **Done** | `apps/web/wrangler.jsonc`, `apps/web/tests/company-fork-invariants.test.ts`, CI readiness |
| Placeholder hosts + branding | **Done** | `site-config.ts`, PR #1 |
| Preserve `GET /api/v1/plugins` wire + registry `dsh-1024store-catalog` | **Done** | `npm run test:api-contract`, company-fork invariants |
| Local listening anonymous Market GET | **Done** | `npm run smoke:company-plugins-api` → [`examples/smoke-evidence/LATEST.md`](./examples/smoke-evidence/LATEST.md) |
| Interim public HTTPS (tunnel) | **Done (not M1)** | [`examples/smoke-evidence/interim-https-*`](./examples/smoke-evidence/) — `durable: false` |
| Secrets-gated CF deploy workflow | **Done (code)** | [`.github/workflows/company-fork-deploy.yml`](../.github/workflows/company-fork-deploy.yml); actionlint clean |
| Company CF API token + account + D1/KV | **Blocked** | Missing credentials audit in [`company-fork-deploy.md`](./company-fork-deploy.md) |
| Durable public HTTPS apex / workers.dev Worker | **Blocked** | Depends on secrets |
| Anonymous HTTPS Market GET on durable origin | **Blocked** | Depends on deploy |
| Pin desktop `COMPANY_STORE_*` to durable origin | **Blocked** | Explicitly deferred; do not pin trycloudflare |

## M2 / Stage 2 — AI Buddy optional `company-store` built-in

| Requirement | Status | Evidence |
| --- | --- | --- |
| New key `company-store` (not retarget `dsh-1024store`) | **Done** | Desktop PR #19 adapters + `built-in-providers.ts` |
| Not default / not preferred / not fallback | **Done** | Host tests: add → `enabled: false`; coexistence select; docs EN+ZH |
| Disclaimer `公司目录，收录≠安全审核` | **Done** | `CompanyStoreDisclaimerBanner` + locales EN/ZH + MarketSettingsTab wiring |
| Adapter + host-routes tests | **Done** | `company-store-adapter.spec.ts`, `company-store-host-routes.spec.ts` |
| Docs EN + ZH | **Done** | README.md / README.zh.md, market-shell.md / .zh.md, `docs/company-store-builtin.md` + `.zh.md` |
| Local vitest green | **Done** | 283+ tests on tip (re-run after latest commits) |
| Desktop GitHub Actions CI on PR | **Blocked (owner)** | Workflow `CI` active but **0 runs**; permissions API 403 — see [`company-store-ci-note`](https://github.com/hopefullstack-collab/deepseek-harness-desktop/blob/cursor/company-store-builtin-cb2c/dsh-community-market/docs/company-store-ci-note.md) |
| Merged + re-verified against durable Store | **Blocked** | Needs M1 durable origin + merge |

## M3 / Stage 3 — E2E install path (public npm; no private registry)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Curated sample set + installability rules documented | **Done** | [`examples/curated-reviewed/README.md`](./examples/curated-reviewed/README.md) |
| Installable wire fixture for adapter | **Done** | `docs/ai-buddy-stage2/patch/fixtures/plugins-api.installable.json` |
| E2E install notes + operator script after deploy | **Done (docs/script)** | [`company-fork-stage3-e2e-install.md`](./company-fork-stage3-e2e-install.md), `scripts/company-fork-e2e-install-check.mjs` |
| Live e2e install against durable HTTPS | **Blocked** | Needs M1 deploy + npm probe on real registry |

## M4 / Stage 4 — Ops

| Requirement | Status | Evidence |
| --- | --- | --- |
| Deploy + migrate runbook | **Done** | [`company-fork-deploy.md`](./company-fork-deploy.md) |
| D1 backup before remote migrate | **Done** | Same doc |
| Monitoring checklist | **Done** | Same doc § Monitoring + this checklist |
| Maintainer roster filled | **Partial** | TODO placeholders remain for named owners |
| Live monitoring on production | **Blocked** | Needs deploy |

## Out of scope (unchanged — do not expand)

- iframe Store shell into AI Buddy
- Intranet / login-required catalog
- Private npm one-click install
- Retargeting official `dsh-1024store` at the company domain

---

## Human unblock (one sitting)

Exact secret **names**, value sources, and ordered commands:
[`company-fork-deploy.md` § Human unblock packet](./company-fork-deploy.md#human-unblock-packet-m1--stage-2-pin).
