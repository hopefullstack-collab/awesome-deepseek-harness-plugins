# Apply Stage 2: `company-store` in dsh-community-market

**Preferred:** from the Store repo root run
[`../../scripts/apply-company-store-stage2.sh`](../../scripts/apply-company-store-stage2.sh)
(one command: clone/checkout/`git am`/vitest/next steps; no push).

**Upstream package found:** `anywhere-labs/deepseek-harness-desktop` →
`dsh-community-market/` (public clone works; this Cloud Agent token cannot
fork/push there). Apply this patch in a clone you can push, on branch
`cursor/<descriptive-name>-cb2c`, then open a PR upstream.

## Product rules (do not weaken)

| Rule | Value |
| --- | --- |
| Built-in key | **New** `company-store` — never modify/replace `dsh-1024store` |
| Default | Not selected (`add-builtin` → `enabled: false`) |
| Failure fallback | Never fall back to company-store on official failure |
| Disclaimer ZH | `公司目录，收录≠安全审核` |
| Display EN | `Company Store` (TODO finalize with stakeholders) |
| Display ZH | `公司插件目录` (TODO finalize) |
| Endpoint | `https://plugins.company.example/api/v1/plugins` (placeholder) |
| Provider ID | `com.company.store.catalog` |
| Adapter ID | `market.company-store-v1` |

## Files to add / replace

| Action | Path in `dsh-community-market` | Source in this patch |
| --- | --- | --- |
| **Add** | `src/adapters/dsh-1024-style-store.ts` | `src/adapters/dsh-1024-style-store.ts` |
| **Replace** | `src/adapters/dsh-1024store.ts` | `src/adapters/dsh-1024store.ts` (thin wrapper; keep exported constants) |
| **Add** | `src/adapters/company-store.ts` | `src/adapters/company-store.ts` |
| **Edit** | `src/catalog/service.ts` | See `snippets/BUILT_IN_PROVIDERS.snippet.ts` |
| **Edit** | `src/host/routes.ts` | See `snippets/routes.snippet.ts` |
| **Edit** | `src/index.ts` | See `snippets/index.snippet.ts` |
| **Add** | `tests/company-store-adapter.spec.ts` | `tests/company-store-adapter.spec.ts` |
| **Add** | `tests/fixtures/plugins-api.installable.json` | `fixtures/plugins-api.installable.json` |
| **Edit** | `tests/host-routes.spec.ts` | Extend `it.each` with company-store row |
| **Docs** | README / market-shell | Note optional partner source + ZH disclaimer |

## Registration checklist

1. `BUILT_IN_PROVIDERS` includes `company-store` with `partnership: true`.
2. `adapters` Map includes `companyStoreAdapter`.
3. Restricted HTTP client pins `COMPANY_STORE_HOSTNAME` only for that adapter.
4. Existing `dsh-1024store` / `dshfind` tests stay green.
5. New tests cover:
   - `add-builtin` key `company-store` → disabled source
   - unknown key still rejected
   - adapter pages / limit ≤ 50 / origin pin / `q` filter
   - installable item when `installMethods` has single verified `repository_backlink`
   - browse-only item (github-only methods) has no `package` field
   - coexistence: both built-ins can be added; selecting one does not enable the other

## UI / i18n

When the active source’s `builtInProviderKey === 'company-store'`, show the ZH
disclaimer (`公司目录，收录≠安全审核`) in the Market chrome. EN optional notice:
“Company-reviewed catalog. Listing means inclusion only — not a security audit.”

Do **not** auto-select company-store. Do **not** use it as fallback when
`dsh-1024store` fetch fails.

## Out of scope

iframe Store shell, intranet/login catalog, private npm one-click, retargeting
official `dsh-1024store` endpoint at the company domain.
