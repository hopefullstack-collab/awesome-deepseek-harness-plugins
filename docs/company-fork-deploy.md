# Company Store deploy (fork)

This repository is company-forked from DSH 1024Store. The Market catalog is
**company-reviewed `catalog/plugins/*.json` only**. GitHub topic whole-network
scan is **off** by default (`TOPIC_DISCOVERY_ENABLED=0`).

## Placeholders to replace before production

| Item | Current placeholder | Notes |
| --- | --- | --- |
| Apex site | `plugins.company.example` | Public HTTPS only — no intranet IP |
| www | `www.plugins.company.example` | Permanent 301 to apex |
| Public API host | `api.plugins.company.example` | Allow-list: `/v1/plugins/search`, `/v1/health` |
| Display name EN | `Company Store` | TODO: finalize with stakeholders |
| Display name ZH | `公司插件目录` | TODO: finalize; AI Buddy disclaimer uses this |
| D1 `database_id` / name | zeros in `wrangler.jsonc` | Create in company Cloudflare account |
| KV `CATALOG_CACHE` id | zeros in `wrangler.jsonc` | Create in company Cloudflare account |
| Worker `name` | `company-store` | Optional rename |

Secrets (never commit): `GITHUB_TOKEN`, `INSTALL_CLIENT_HASH_SECRET`,
`CATALOG_SYNC_TOKEN`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`.

## Real-domain swap checklist

Work top-to-bottom. Leaving any placeholder live will either fail DNS binding
or advertise the wrong hostname to Market clients.

1. **DNS / Cloudflare**
   - [ ] Create zone for the real apex (e.g. `plugins.example.com`).
   - [ ] Plan three hostnames: apex, `www.`, and `api.` (same pattern as
         `deepseek1024.com` / `www.` / `api.`).
   - [ ] Confirm public HTTPS only (no RFC1918 / intranet origins).

2. **`apps/web/wrangler.jsonc`**
   - [ ] Replace all three `routes[].pattern` values (keep **exactly three**
         entries — dropping one unbinds that custom domain → `522`).
   - [ ] Create D1 + KV in the **company** Cloudflare account; paste real
         `database_id` / KV `id` (never leave all-zero placeholders).
   - [ ] Optionally rename Worker `name` / D1 `database_name`.
   - [ ] Leave `TOPIC_DISCOVERY_ENABLED` at `"0"` unless intentionally
         re-enabling whole-network topic scan.
   - [ ] Keep `triggers.crons` empty while topic discovery is off.

3. **Site identity (`apps/web/worker/lib/site-config.ts`)**
   - [ ] `DEFAULT_SITE_ORIGIN` → `https://<apex>`
   - [ ] `DEFAULT_WWW_HOST` / `DEFAULT_PUBLIC_API_HOST` → real hosts
   - [ ] Finalize `DEFAULT_SITE_NAME` / `DEFAULT_SITE_NAME_ZH`
   - [ ] Keep `COMPANY_MARKET_BUILTIN_KEY === "company-store"`

4. **AI Buddy built-in (separate repo)**
   - [ ] Update `COMPANY_STORE_ENDPOINT` / `COMPANY_STORE_HOSTNAME` in
         `company-store.ts` to the real apex (same as Store).
   - [ ] Do **not** change official `dsh-1024store` constants.

5. **Secrets + migrate + deploy** (local deliberate act — not implied by git push)

```bash
# After real domain + D1/KV ids are filled into apps/web/wrangler.jsonc:
npx wrangler d1 export CATALOG_DB --remote --output=catalog-backup-$(date +%Y%m%d-%H%M).sql
npm run db:migrate:remote --workspace @dsh-1024store/web
npm run deploy
```

6. **Verify**

```bash
curl -sS https://<apex>/api/v1/health
curl -sS 'https://<apex>/api/v1/plugins?limit=1' | jq '.name, .packages, .meta'
curl -sS https://api.<apex-parent>/v1/health
# Expect registry name still "dsh-1024store-catalog" for adapter compatibility.
```

- [ ] Apex health `{"status":"ok"}` (or site health shape)
- [ ] Plugins listing includes `packages`, `rankings`, `categories`, `meta`
- [ ] API host `/v1/health` OK; unknown paths `404 {"code":"NOT_FOUND"}`
- [ ] www → 301 apex
- [ ] Anonymous Market GET still unauthenticated

## Catalog policy

1. Curators add/edit JSON under `catalog/plugins/`.
2. Starter reviewed samples (real public plugins): [`docs/examples/curated-reviewed/`](./examples/curated-reviewed/).
3. CI / `POST /api/v1/catalog/sync` loads them into D1 (`from_pr = 1`).
4. Published snapshot includes **only** `from_pr = 1` while topic discovery is off.
5. Anonymous `GET /api/v1/plugins` (and search) remains unauthenticated — required
   for AI Buddy Market browsing.

Wire shape of `GET /api/v1/plugins` is preserved (`packages`, `rankings`,
`categories`, `meta`, per-plugin `installMethods`, etc.). Registry name stays
`dsh-1024store-catalog` for adapter compatibility.

## Re-enabling topic scan (not recommended for company Market)

Set wrangler var `TOPIC_DISCOVERY_ENABLED` to `1`, restore discovery crons from
upstream `docs/plugin-discovery.md`, redeploy. Official whole-network behavior
returns; company Market should usually keep this off.

## AI Buddy built-in (`company-store`)

Stage 2 lives in AI Buddy `dsh-community-market` (located upstream in
`anywhere-labs/deepseek-harness-desktop`). This Store ships a ready-to-apply
patch under [`docs/ai-buddy-stage2/patch/`](./ai-buddy-stage2/patch/APPLY.md).
See [ai-buddy-company-market.md](./ai-buddy-company-market.md).

Do **not** retarget the official `dsh-1024store` built-in at the company domain.

## Missing credentials audit (this environment)

Re-checked on the cloud agent host this turn (env, `/tmp/cursor`, `.dev.vars`,
Cursor `environment-info` MCP, wrangler config):

| Check | Result |
| --- | --- |
| `npx wrangler whoami` | **Not authenticated** — no OAuth session |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` env | **Absent** |
| Cursor environment secrets / linked env | **None** (`environment: null`) |
| `apps/web/.dev.vars` | Present locally for smoke only (gitignored; not CF auth) |
| Wrangler config D1 / KV ids | Still all-zero placeholders |
| Custom domain zone | Placeholder `*.company.example` only |

**Exact secrets / resources required before a durable public HTTPS deploy:**

1. Cloudflare account with Workers enabled (company account, not personal ad-hoc).
2. `CLOUDFLARE_API_TOKEN` (or interactive `wrangler login`) with Workers / D1 / KV / DNS edit.
3. `CLOUDFLARE_ACCOUNT_ID` if using API-token non-interactive deploy.
4. Real public zone + three hostnames (apex / www / api) — HTTPS only.
5. Created D1 database id + KV namespace id pasted into `apps/web/wrangler.jsonc`.
6. Worker secrets (never commit): `GITHUB_TOKEN`, `INSTALL_CLIENT_HASH_SECRET`,
   `CATALOG_SYNC_TOKEN`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`.
7. Matching GitHub Actions secrets for `.github/workflows/company-fork-deploy.yml`
   (at minimum `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; see below).

Until those exist, **do not** treat `workers.dev` preview or a trycloudflare
quick tunnel as the permanent Market origin — AI Buddy `company-store` must pin
the final public apex. Local + interim tunnel smoke prove the wire contract
while the goal stays open for durable company deploy.

## Interim public HTTPS (cloudflared quick tunnel) — not M1-complete

While CF account API credentials are missing, the Worker was proven over
**public HTTPS** via:

1. `wrangler dev --local` on `http://127.0.0.1:8787` (curated catalog synced)
2. `cloudflared tunnel --url http://127.0.0.1:8787` (account-less quick tunnel)

Evidence (committed under `docs/examples/smoke-evidence/`):

| File | Contents |
| --- | --- |
| `interim-https-summary.json` | Origin, package count, wire keys, durable=false |
| `interim-https-health.json` | `GET /api/v1/health` → `{"status":"ok"}` |
| `interim-https-plugins-slim.json` | Slim `packages` / `meta` extract |
| `interim-https-headers.txt` | HTTP/2 200, `server: cloudflare`, HSTS |

Captured origin example (ephemeral — dies with the agent tunnel process):

`https://excel-combo-increasingly-spots.trycloudflare.com`

Anonymous `GET /api/v1/plugins?limit=5` returned `packages` + `meta` +
`rankings` + `categories` (3 curated packages) over TLS.

**This is interim M1 verification only.** It does **not** complete the durable
company-domain M1 gate. Do **not** pin desktop `COMPANY_STORE_ENDPOINT` /
`COMPANY_STORE_HOSTNAME` to a `*.trycloudflare.com` URL (unstable hostname,
process-bound). Keep placeholders until a durable apex or `*.workers.dev`
Worker exists, then follow the swap steps in the desktop
`company-store-builtin` docs.

Reproduce locally:

```bash
# terminal A
npm run smoke:company-plugins-api   # or leave wrangler dev --local running
# terminal B
cloudflared tunnel --url http://127.0.0.1:8787
curl -sS "$TUNNEL_URL/api/v1/health"
curl -sS "$TUNNEL_URL/api/v1/plugins?limit=5" | jq 'keys, (.packages|length), .meta'
```

## Secrets-gated GitHub Actions deploy (one merge away)

Workflow: [`.github/workflows/company-fork-deploy.yml`](../.github/workflows/company-fork-deploy.yml)

| Trigger | Behavior without CF secrets | Behavior with secrets |
| --- | --- | --- |
| `push` to `main` (web paths) | Soft-skip exit 0 + notice | Build → migrate → deploy |
| `workflow_dispatch` | **Hard fail** (loud operator signal) | Same; optional create D1/KV |

**Repository secrets to add (company Cloudflare account):**

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Non-interactive wrangler auth |
| `CLOUDFLARE_ACCOUNT_ID` | Account scope |
| `WORKER_GITHUB_TOKEN` (or `CATALOG_GITHUB_TOKEN`) | Worker `GITHUB_TOKEN` secret |
| `INSTALL_CLIENT_HASH_SECRET` | Worker secret |
| `CATALOG_SYNC_TOKEN` | Worker secret (+ catalog-sync workflow) |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | Worker secrets |

**Optional repository variables:**

| Variable | Purpose |
| --- | --- |
| `COMPANY_D1_DATABASE_ID` | Inject real D1 id before deploy |
| `COMPANY_KV_NAMESPACE_ID` | Inject real KV id before deploy |
| `COMPANY_DEPLOY_WORKERS_DEV` | Default `true` on push — strips placeholder custom domains so the first deploy lands on `*.workers.dev` |

**Operator sequence once secrets exist:**

1. Actions → **Company fork Cloudflare deploy** → Run workflow
   (`create_resources=true`, `workers_dev_only=true` for first land).
2. Confirm `https://company-store.<subdomain>.workers.dev/api/v1/health`.
3. `POST /api/v1/catalog/sync` with curated samples + `CATALOG_SYNC_TOKEN`.
4. Anonymous `GET /api/v1/plugins` — assert `packages` + `meta`.
5. Update desktop `COMPANY_STORE_ENDPOINT` / `HOSTNAME` to that durable HTTPS origin.
6. Later: commit real DNS routes in `wrangler.jsonc`, set
   `COMPANY_DEPLOY_WORKERS_DEV=false`, re-run for the company apex.



## Wrangler `--temporary` preview (also not durable)

Re-checked this turn: `wrangler whoami` still unauthenticated, but Wrangler 4.x
offers `wrangler deploy --temporary` (preview account, claim within ~60 minutes).

Attempted a minimal assets-only deploy (no D1/KV/DO — placeholders cannot bind
on a preview account):

- Preview URL: `https://company-store-preview.adaptable-pint.workers.dev`
- Upload succeeded; Version ID recorded in agent logs
- Anonymous `curl` to `/api/v1/health` and `/api/v1/plugins` hit Cloudflare
  **Managed Challenge** (`cf-mitigated: challenge`, HTTP 403 HTML) and/or Worker
  exception `1101` (bindings missing) — **not** a usable Market origin
- Claim window is short; unclaimed preview accounts expire — **not durable**

Treat this the same as the trycloudflare tunnel: useful proof that Cloudflare
edge HTTPS can be reached without a company account, but **do not** pin desktop
`COMPANY_STORE_*` constants here. Durable M1 still needs company
`CLOUDFLARE_API_TOKEN` + account + D1/KV via `.github/workflows/company-fork-deploy.yml`
(or interactive `wrangler login` + real domain checklist above).

## Local listening smoke (M1 acceptance without CF)

Vite `npm run dev` needs a Cloudflare remote-proxy token in this environment.
The smoke uses **`wrangler dev --local`** against a production build instead
(no account / no API token):

```bash
npm ci
node scripts/smoke-company-plugins-api.mjs
# or: npm run smoke:company-plugins-api
```

What it does:

1. Writes gitignored `apps/web/.dev.vars` if missing (smoke tokens only).
2. Applies local D1 migrations (`CATALOG_DB --local`).
3. `npm run build` → starts `wrangler dev --local` on `http://127.0.0.1:8787`.
4. `POST /api/v1/catalog/sync` with the three curated samples.
5. Anonymous `GET /api/v1/plugins?limit=5` — asserts `packages` + `meta` (+
   `installMethods` array-or-absent).
6. Writes evidence under `docs/examples/smoke-evidence/`.

CI gate: `.github/workflows/company-fork-deploy-readiness.yml` (PR + push) runs
API contract + company-fork invariants + this smoke.

## Ops runbook (M4)

### Who merges catalog PRs

| Change type | Owner | Gate |
| --- | --- | --- |
| Single-file `catalog/plugins/*.json` submission | Auto-merge via `plugin-review.yml` after static review | Protect `main` with `Plugin submission review / static-review` |
| Multi-file / docs / Worker / policy | Named company maintainers (TODO: fill roster) | Manual review + ruleset bypass only for emergencies |
| Display-name / domain / wrangler id swaps | Same maintainers + ops | Must follow real-domain checklist above |

Record the maintainer roster in the company runbook wiki (link TODO) — do not
rely on informal chat ownership.

### D1 backup (before every remote migration / deploy)

```bash
npx wrangler d1 export CATALOG_DB --remote \
  --output=catalog-backup-$(date +%Y%m%d-%H%M).sql
# Spot-check restore:
sqlite3 /tmp/catalog-restore-check.db < catalog-backup-*.sql
sqlite3 /tmp/catalog-restore-check.db 'SELECT COUNT(*) FROM plugins;'
npm run db:migrate:remote --workspace @dsh-1024store/web
npm run deploy
```

Keep the `.sql` off the git tree (local ops store / encrypted bucket). Retention:
at least the last successful pre-migration backup until the next green deploy
+ catalog sync.

### Monitoring checklist (post-deploy)

- [ ] `GET https://<apex>/api/v1/health` → ok
- [ ] `GET https://<apex>/api/v1/plugins?limit=1` → `packages` + `meta`; registry
      name still `dsh-1024store-catalog` on `/api/v1/registry`
- [ ] `GET https://api.<…>/v1/health` → ok; unknown paths → `404 {"code":"NOT_FOUND"}`
- [ ] www → 301 apex
- [ ] Catalog sync workflow green after a curated merge (`CATALOG_SYNC_TOKEN` match)
- [ ] `TOPIC_DISCOVERY_ENABLED` still `"0"` unless intentionally reopened
- [ ] AI Buddy `company-store` endpoint constants match apex (separate desktop PR)
- [ ] Quota / 5xx: Workers analytics + D1 size; alert on sustained 5xx on plugins GET
- [ ] Weekly: export D1 backup even without migration

### Deploy readiness definition of done

Public HTTPS apex serving anonymous Market-compatible `GET /api/v1/plugins`,
real domain wired into desktop `company-store` adapter constants, Stage 2 merged
and re-verified. Local smoke + docs are necessary but **not** sufficient alone.
