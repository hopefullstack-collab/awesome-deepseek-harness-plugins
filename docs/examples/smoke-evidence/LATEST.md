# Company Store M1 smoke evidence (local listening origin)

Captured: 2026-08-21T17:41:09.962Z
Origin: `http://127.0.0.1:8787`
Runtime: `wrangler dev --local` (no Cloudflare account)
Request: `GET http://127.0.0.1:8787/api/v1/plugins?limit=5`
packages: 3
meta.total: 3
meta.source: kv
meta.revision: sha256:d82931c9ef2e163c0a11b10a0beff81bee8f5a3e507685b44edb192f881a656f
body sha256[0:16]: `63d2ac175b84092d`
Artifact: [`plugins-api-2026-08-21T17-41-09-961Z.json`](./plugins-api-2026-08-21T17-41-09-961Z.json)

Acceptance:
- [x] Anonymous GET (no Authorization header)
- [x] JSON includes `packages` and `meta`
- [x] Package rows expose Market identity fields; `installMethods` array-or-absent

Public HTTPS deploy still blocked without Cloudflare account + real domain
(see `docs/company-fork-deploy.md` missing-credentials section).
