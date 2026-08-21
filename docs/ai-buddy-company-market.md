# AI Buddy Market: company-store built-in (Stage 2)

## Stage 2 upstream PR

- **Desktop fork PR (clean):** [https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19](https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19)
- **Branch:** `cursor/company-store-builtin-cb2c` (base fork `master`)
- **Fork:** `hopefullstack-collab/deepseek-harness-desktop` (from `anywhere-labs/deepseek-harness-desktop`)
- **Clean upstream-tip port:** commit `4d46120` on `9d18856` — Store [`company-store-stage2-on-9d18856.patch`](./ai-buddy-stage2/company-store-stage2-on-9d18856.patch) / [`.bundle`](./ai-buddy-stage2/company-store-stage2-on-9d18856.bundle) (**279** vitest)
- **Upstream PRs:** [#465](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/465) / [#466](https://github.com/anywhere-labs/deepseek-harness-desktop/pull/466) **closed** (dirty). No clean upstream PR until fork sync or tip push.

## Status

| Check | Evidence |
| --- | --- |
| Package location | [`anywhere-labs/deepseek-harness-desktop`](https://github.com/anywhere-labs/deepseek-harness-desktop) → `dsh-community-market/` (also `jo32/DeepDeck` → `plugins/community-market/`) |
| Writable fork | [`hopefullstack-collab/deepseek-harness-desktop`](https://github.com/hopefullstack-collab/deepseek-harness-desktop) (GitHub MCP; `gh` CLI remains read-only for cursor[bot]) |
| Stage 2 PR | Fork [PR #19](https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19) clean; **no clean upstream PR** (dirty #465/#466 closed). Maintainer: patch/bundle on `anywhere-labs/master` or sync fork + push `4d46120` |
| Local market tests | assemble + wiring + `yarn vitest run` → **283 passed** on tip |
| Ready-to-apply patch (Store repo) | [`docs/ai-buddy-stage2/patch/`](../ai-buddy-stage2/patch/APPLY.md) (reference / re-apply aid) |

Official `dsh-1024store` / `dshfind` remain optional partners alongside the
company source. Goal completion still requires **real company domain deploy** and Stage 2 **merged + re-verified** on the desktop fork.

**Blockers (re-verified this turn):** still no Cloudflare auth in the agent
environment (`wrangler whoami` unauthenticated; no `CLOUDFLARE_API_TOKEN` / account id /
real D1+KV ids; Cursor environment secrets none; Actions secrets API 403). Interim public HTTPS was proven via
cloudflared quick tunnel → local Worker (evidence under `docs/examples/smoke-evidence/interim-https-*`)
but is **not** durable M1. Secrets-gated deploy workflow is ready at
`.github/workflows/company-fork-deploy.yml`. Desktop PR #19 local vitest green;
GitHub Actions still shows **0 workflow runs** on the fork (owner must enable/approve Actions —
see desktop `docs/company-store-ci-note.md`).

Full done-vs-blocked audit: [`goal-completion-checklist.md`](./goal-completion-checklist.md).
Human unblock packet (secret names + ordered commands):
[`company-fork-deploy.md` § Human unblock packet](./company-fork-deploy.md#human-unblock-packet-m1--stage-2-pin).


## Product rules

| Rule | Requirement |
| --- | --- |
| Built-in key | **New** key `company-store` — do not modify/replace `dsh-1024store` |
| Default selection | Not selected by default (`enabled: false` after `add-builtin`) |
| Failure fallback | Never fall back to company-store on official failure |
| Disclaimer (ZH) | `公司目录，收录≠安全审核` |
| Display EN | `Company Store` (TODO finalize) |
| Display ZH | `公司插件目录` (TODO finalize) |
| Endpoint | `https://plugins.company.example/api/v1/plugins` (placeholder domain) |
| Provider ID | `com.company.store.catalog` |
| Adapter ID | `market.company-store-v1` |

## Exact files to change (upstream `dsh-community-market`)

| File | Change |
| --- | --- |
| `src/adapters/dsh-1024-style-store.ts` | **Add** — shared configurable parser/factory (from official adapter) |
| `src/adapters/dsh-1024store.ts` | **Replace** with thin wrapper over factory; keep exported constants |
| `src/adapters/company-store.ts` | **Add** — company constants + `companyStoreAdapter` |
| `src/catalog/service.ts` | Import company adapter; append `BUILT_IN_PROVIDERS` entry; register in `adapters` Map |
| `src/host/routes.ts` | Pin restricted HTTP client to `plugins.company.example`; wire `adapterHttpClients` |
| `src/index.ts` | Re-export company adapter / key constants |
| `src/client/locales.ts` / settings UI | Show ZH disclaimer when `builtInProviderKey === 'company-store'` |
| `tests/company-store-adapter.spec.ts` | **Add** — origin pin, paging, `q`, installable vs browse-only |
| `tests/host-routes.spec.ts` | Extend `add-builtin` `it.each` with `company-store` |
| `tests/fixtures/plugins-api.installable.json` | **Add** — Store wire fixture (also shipped here under `patch/fixtures/`) |
| README / `docs/market-shell.md` | Note optional company partner source |

Patch sources live under [`docs/ai-buddy-stage2/patch/`](../ai-buddy-stage2/patch/).

## API shapes the adapter must accept

`GET /api/v1/plugins` (company apex) — same as official Store:

`GET /api/v1/plugins` body (adapter-relevant fields):

```json
{
  "packages": [
    {
      "id": "owner/repo",
      "name": "…",
      "owner": "…",
      "url": "https://github.com/owner/repo",
      "category": "tools",
      "description": { "en": "…", "zh": "…" },
      "installMethods": [
        {
          "kind": "npm",
          "spec": "some-npm-package",
          "verification": "verified",
          "code": "repository_backlink",
          "requiresBuildAllowance": false,
          "revision": "1.2.3"
        }
      ]
    }
  ],
  "rankings": { "stars": [], "installs": [], "newest": [] },
  "categories": [],
  "meta": {
    "total": 1,
    "catalogTotal": 1,
    "updated": "YYYY-MM-DD",
    "generatedAt": "…",
    "revision": "sha256:…",
    "source": "kv",
    "metricCoverage": 1
  }
}
```

`GET /api/v1/registry` keeps `name: "dsh-1024store-catalog"` for compatibility.
The Market adapter parses `packages` + `meta` from `/api/v1/plugins` (optional
top-level `name` is ignored if present).

Installable (AI Buddy) ⇔ single verified npm `repository_backlink` target +
HTTPS GitHub URL. Browse-only rows remain valid catalog items without
`package` / `latestVersion`.

Contract fixture: [`docs/ai-buddy-stage2/patch/fixtures/plugins-api.installable.json`](../ai-buddy-stage2/patch/fixtures/plugins-api.installable.json).

## Test cases (must pass)

1. `POST …/sources` `{ action: "add-builtin", key: "company-store" }` → 200, source with `enabled: false`, `builtInProviderKey: "company-store"`.
2. Unknown key → 400 `built-in source unavailable`.
3. Adapter fetch pins origin to `https://plugins.company.example`; rejects final URL origin change.
4. `limit` capped at 50; cursor pagination; `q` filters id/name/publisher/summary.
5. Installable fixture packages expose `package.registry === "npm"` + semver `latestVersion`.
6. GitHub-only methods → browse item, no npm package field.
7. Coexistence: `dsh-1024store` and `company-store` both addable; selecting one disables the other; official failure must not auto-enable company-store.

## EN / ZH strings

| Context | EN | ZH |
| --- | --- | --- |
| Built-in display name | Company Store | 公司插件目录 |
| Built-in description | Company-reviewed catalog. Listing means inclusion only — not a security audit. | 公司目录，收录≠安全审核。需要用户明确添加并启用。 |
| Selected-source banner | Company-reviewed catalog. Listing ≠ security audit. | 公司目录，收录≠安全审核 |
| Attribution name | Company Store | 公司插件目录 |

## Compatibility

Company Store preserves the upstream `GET /api/v1/plugins` JSON shape
(`packages`, `meta`, `installMethods`, registry `name: dsh-1024store-catalog`).
The shared factory parameterizes only hostname / endpoint / providerId /
adapterId.

## Out of scope

- iframe of the Store shell into AI Buddy
- login-required / intranet-only catalog API
- private npm registry one-click install
- pointing official `dsh-1024store` at the company domain
