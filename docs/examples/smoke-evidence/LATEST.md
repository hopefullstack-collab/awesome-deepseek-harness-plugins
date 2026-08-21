# Company Store M1 smoke evidence (local listening origin)

Captured: 2026-08-21T19:27:36.798Z
Origin: `http://127.0.0.1:8787`
Runtime: `wrangler dev --local` (no Cloudflare account)
Request: `GET http://127.0.0.1:8787/api/v1/plugins?limit=5`
packages: 3
meta.total: 3
meta.source: stale
meta.revision: sha256:d82931c9ef2e163c0a11b10a0beff81bee8f5a3e507685b44edb192f881a656f
body sha256[0:16]: `0784f68a0d84204e`
Artifact: [`plugins-api-2026-08-21T19-27-36-798Z.json`](./plugins-api-2026-08-21T19-27-36-798Z.json)

Acceptance:
- [x] Anonymous GET (no Authorization header)
- [x] JSON includes `packages` and `meta`
- [x] Package rows expose Market identity fields; `installMethods` array-or-absent

## Interim public HTTPS recheck (not M1 / not pin-eligible)

Captured: 2026-08-21T23:22:50Z
Origin: `https://mas-speeds-constitutional-cleared.trycloudflare.com`
(Prior `excel-combo-increasingly-spots…` died after UDP DNS outage; tunnel restarted.)
Via: `cloudflared` → `127.0.0.1:8787` (`ha_connections=1`; agent uses local DoH DNS proxy)
Anonymous `GET /api/v1/health` → `{"status":"ok"}` (200, no Managed Challenge)
Anonymous `GET /api/v1/plugins?limit=5` → Market JSON keys
`categories|meta|packages|rankings`, 3 packages (200, no Managed Challenge)
Pin: `npm run pin:company-store-origin` **refuses** trycloudflare
Summary: [`interim-https-summary.json`](./interim-https-summary.json)

Public durable HTTPS deploy still blocked (`wrangler whoami` unauthenticated;
see `docs/company-fork-deploy.md` laptop deploy / secrets). Goal remains OPEN.

## Local M3 install-path structure (no public CF)

Captured: 2026-08-21T19:31:55Z
Script: `node scripts/company-fork-e2e-install-check.mjs --base-url http://127.0.0.1:8787` → PASS
Evidence: [`local-m3-install-path-2026-08-21T19-31-55Z.json`](./local-m3-install-path-2026-08-21T19-31-55Z.json)

| Check | Result |
| --- | --- |
| Health / registry `dsh-1024store-catalog` | ok |
| Live packages | 3 browse-only (`github` methods; no verified npm yet) |
| Fixture installable wire (alias published_package↔repository_backlink) | 3 installable / 0 browse-only |
| Private npm invented | no |

Stage 3 stays **blocked** for durable HTTPS + public npm probe; this is strongest in-repo e2e without CF.

## Live-origin smoke (`smoke:company-store-live`)

Captured: 2026-08-21T23:22:50.413Z
Origin: `https://mas-speeds-constitutional-cleared.trycloudflare.com`
PASS checks: 6/6 (health, packages/meta/installMethods, `q` hit/miss, search pagination, pin refuse)
durable=false pinAllowed=false
Details: [`LIVE.md`](./LIVE.md) · [`live-smoke-2026-08-21T23-22-50-413Z.json`](./live-smoke-2026-08-21T23-22-50-413Z.json)

## Stage 2 adapter live wire (`verify:company-store-adapter-live`)

Captured: 2026-08-21T23:22:52.701Z
Fed interim Market JSON through desktop `createDsh1024StyleStoreAdapter` → **PASS**
items=3 browseOnly=3 github=3 npm=0 (no invented npm identity)
Artifact: [`adapter-live-2026-08-21T23-22-52-701Z.json`](./adapter-live-2026-08-21T23-22-52-701Z.json)
Does **not** pin `COMPANY_STORE_*`.

## Desktop adapter/host tests vs live HTTPS

Captured: 2026-08-21T23:23:04Z
- `DSH_COMPANY_STORE_LOCAL_ENDPOINT` **rejects** trycloudflare HTTPS (loopback-only)
- `yarn vitest run tests/company-store-adapter.spec.ts tests/company-store-host-routes.spec.ts` → **10/10 PASS** (placeholder constants; no live override)
- Live wire parse evidence = adapter-live script above
Artifact: [`desktop-live-origin-tests-2026-08-21T23-23-04Z.json`](./desktop-live-origin-tests-2026-08-21T23-23-04Z.json)

