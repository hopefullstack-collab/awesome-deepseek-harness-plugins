# AI Buddy Market: company-store built-in (Stage 2)

## Status

**Blocked in this workspace:** `dsh-community-market`, `dsh-1024store.ts`, and
`BUILT_IN_PROVIDERS` are not present in
`awesome-deepseek-harness-plugins` (searched locally and on GitHub). Apply the
contract below in the AI Buddy / market-shell repository when available.

Official `dsh-1024store` / `dshfind` remain optional alongside the company source.

## Product rules

| Rule | Requirement |
| --- | --- |
| Built-in key | **New** key `company-store` — do not modify/replace `dsh-1024store` |
| Default selection | Not selected by default |
| Failure fallback | Never fall back to company-store on official failure |
| Disclaimer (ZH) | `公司目录，收录≠安全审核` |
| Display EN | `Company Store` (TODO finalize) |
| Display ZH | `公司插件目录` (TODO finalize) |
| Endpoint | `https://plugins.company.example/api/v1/plugins` (placeholder domain) |

## Implementation sketch

1. Extract a shared configurable parser from `dsh-1024store.ts`
   (endpoint / hostname / providerId).
2. Add `company-store.ts` adapter with compile-time constants pointing at the
   company Store host (placeholder OK until DNS is real).
3. Register in `BUILT_IN_PROVIDERS` + adapters Map under key `company-store`.
4. UI: optional partner source; show the ZH disclaimer when selected.
5. Tests:
   - host routes `add-builtin` / unknown key
   - adapter pages / limits / origin / `q`
   - coexistence with official `dsh-1024store`
6. Docs: README / market-shell note that company partner source is optional.

## Compatibility

Company Store preserves the upstream `GET /api/v1/plugins` JSON shape
(`packages`, `meta`, `installMethods`, …). The adapter should parse the same
fields as `dsh-1024store` after hostname/providerId are parameterized.

## Out of scope

- iframe of the Store shell into AI Buddy
- login-required / intranet-only catalog API
- private npm registry one-click install
- pointing official `dsh-1024store` at the company domain
