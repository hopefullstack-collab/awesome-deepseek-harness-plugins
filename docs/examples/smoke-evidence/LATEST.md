# Company Store M1 smoke evidence

## Local listening origin

Captured: 2026-08-21T17:41:09.962Z
Origin: `http://127.0.0.1:8787`
Runtime: `wrangler dev --local` (no Cloudflare account)
Request: `GET http://127.0.0.1:8787/api/v1/plugins?limit=5`
packages: 3
meta.total: 3
meta.source: kv
Artifact: [`plugins-api-2026-08-21T17-41-09-961Z.json`](./plugins-api-2026-08-21T17-41-09-961Z.json)

Acceptance (local):
- [x] Anonymous GET (no Authorization header)
- [x] JSON includes `packages` and `meta`
- [x] Package rows expose Market identity fields; `installMethods` array-or-absent

## Interim public HTTPS (not durable M1)

Captured: 2026-08-21T17:50:20Z
Kind: cloudflared quick tunnel → local Worker
Origin: `https://excel-combo-increasingly-spots.trycloudflare.com` (**ephemeral**)
Evidence: [`interim-https-summary.json`](./interim-https-summary.json),
[`interim-https-health.json`](./interim-https-health.json),
[`interim-https-plugins-slim.json`](./interim-https-plugins-slim.json),
[`interim-https-headers.txt`](./interim-https-headers.txt)

Acceptance (interim HTTPS):
- [x] Anonymous GET over public HTTPS (TLS via Cloudflare edge)
- [x] `/api/v1/health` → `{"status":"ok"}`
- [x] `/api/v1/plugins` → `packages` (3) + `meta` + `rankings` + `categories`
- [ ] Durable company apex / `*.workers.dev` Worker — **still blocked** (no CF API token)
- [ ] Desktop `COMPANY_STORE_*` constants pinned to durable origin — **deferred** (tunnel URL not stable)

See `docs/company-fork-deploy.md` for credentials audit + secrets-gated Actions deploy.
