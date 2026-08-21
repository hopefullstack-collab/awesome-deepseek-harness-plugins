# Company Store deploy (fork)

This repository is company-forked from DSH 1024Store. The Market catalog is
**company-reviewed `catalog/plugins/*.json` only**. GitHub topic whole-network
scan is **off** by default (`TOPIC_DISCOVERY_ENABLED=0`).

## Local-first (recommended unblock)

**Yes — run and deploy from your laptop.** This cloud agent has no company
Cloudflare session (`wrangler whoami` unauthenticated). Interactive
`wrangler login` on a machine where you already use Cloudflare is the
fastest path to a durable Worker. Use
`npm run deploy:company-store-laptop` after login (see §B). GitHub Actions
secrets remain an alternative; do not wait on cloud device-login polls.

Two layers (do not conflate them):

| Layer | What it proves | Completes M1? |
| --- | --- | --- |
| `wrangler dev --local` / `npm run smoke:company-plugins-api` on `http://127.0.0.1:8787` | Wire contract for anonymous Market GET | **No** — localhost is **dev only** |
| `wrangler login` → create D1/KV → migrate → `wrangler deploy` → anonymous **HTTPS** on `*.workers.dev` or real apex | Durable public origin employees/Market can use | **Yes** (M1 gate) |

**Explicit:** localhost is for development and smoke. Market for employees
needs a **public HTTPS** origin. Do not redefine M1 as “local only.”

### A. Local API smoke (no Cloudflare account)

From the Store repo root (after `npm ci`):

```bash
npm run smoke:company-plugins-api
# equivalent: builds Worker, boots wrangler dev --local on :8787,
# syncs curated samples, asserts GET /api/v1/plugins has packages + meta
```

Or leave a long-lived local Worker running:

```bash
# terminal A — after npm ci + npm run build in apps/web (or let smoke boot it)
cd apps/web
npx wrangler d1 migrations apply CATALOG_DB --local
npx wrangler dev --local --port 8787
# terminal B
curl -sS http://127.0.0.1:8787/api/v1/health
curl -sS 'http://127.0.0.1:8787/api/v1/plugins?limit=1' | jq 'keys, .meta'
```

### B. From your laptop — durable deploy (recommended)

Use a shell where you can complete the Cloudflare browser login (company
account). **Preferred:** one script that verifies `whoami`, creates D1/KV when
placeholders remain, strips `*.company.example` routes for workers.dev, migrates,
deploys, curls anonymous health/plugins, and prints the exact desktop pin step.

```bash
# 0) Clone this fork branch and install
git clone https://github.com/hopefullstack-collab/awesome-deepseek-harness-plugins.git
cd awesome-deepseek-harness-plugins
git checkout cursor/company-store-fork-cb2c   # or main after merge
npm ci

# 1) Interactive login (opens browser — do this on YOUR machine)
npx wrangler login
npx wrangler whoami
# Expect the company Cloudflare account (note Account ID)

# 2) One-shot durable land (workers.dev)
npm run deploy:company-store-laptop
# equivalent: ./scripts/company-store-laptop-deploy.sh
#
# Flags:
#   --check-only         whoami + plan only
#   --print-edits-only   print exact wrangler.jsonc edits (no CF calls)
#   --no-workers-dev     leave routes[] (real custom domains)
#   --base-url URL       override origin used for post-deploy curls
```

The script backs up `apps/web/wrangler.jsonc` before editing, writes generated
secrets to gitignored `apps/web/.env.laptop-deploy`, and prints:

- public origin (`https://company-store.<subdomain>.workers.dev`)
- exact `COMPANY_STORE_PLACEHOLDER_*` values to pin
- **paste-back / pin instructions** — reply with the origin on Store PR #1, or run:

```bash
COMPANY_STORE_ORIGIN='https://company-store.<subdomain>.workers.dev' \
  npm run pin:company-store-origin -- --verify
# Apply into desktop PR #19 checkout:
COMPANY_STORE_ORIGIN='…' npm run pin:company-store-origin -- \
  --apply --verify --desktop-path /path/to/deepseek-harness-desktop
```

If auto-editing routes looks unsafe (no `.example` hosts but `routes[]` still
present), it leaves them alone and prints the exact manual edits instead
(`./scripts/company-store-laptop-deploy.sh --print-edits-only`).

#### Pin helper (after origin exists)

`npm run pin:company-store-origin` /
[`scripts/pin-company-store-origin.sh`](../scripts/pin-company-store-origin.sh)
takes `COMPANY_STORE_ORIGIN=https://…`, refuses trycloudflare/localhost/http,
and prints (or `--apply`s) the exact desktop PR #19 file edits + commit message.
Self-test: `COMPANY_STORE_ORIGIN=https://company-store.example-dry-run.workers.dev npm run pin:company-store-origin`.

#### Manual sequence (same steps the script runs)

```bash
cd apps/web
npx wrangler d1 create company-store-catalog
# Copy the printed database_id → replace the all-zero database_id in wrangler.jsonc
npx wrangler kv namespace create CATALOG_CACHE
# Copy the printed id → replace the all-zero KV id in wrangler.jsonc

# First land on *.workers.dev: remove placeholder custom-domain routes
# (plugins.company.example is not a real zone — leaving it fails the deploy).
# Delete or comment out the entire "routes": [ ... ], block in wrangler.jsonc
# so only the Worker name remains. Keep TOPIC_DISCOVERY_ENABLED "0".

openssl rand -hex 32   # → INSTALL_CLIENT_HASH_SECRET
openssl rand -hex 32   # → CATALOG_SYNC_TOKEN
# (script uploads these after deploy; for manual: wrangler secret put …)

npx wrangler d1 export CATALOG_DB --remote \
  --output=catalog-backup-$(date +%Y%m%d-%H%M).sql || true   # ok if DB empty on first run
cd ../..
npm run db:migrate:remote --workspace @dsh-1024store/web
npm run deploy

export APEX='https://company-store.<your-subdomain>.workers.dev'   # replace
curl -sS "$APEX/api/v1/health"
curl -sS "$APEX/api/v1/plugins?limit=1" | jq 'keys, .meta'
export CATALOG_SYNC_TOKEN='…same value as secret…'
node scripts/company-fork-e2e-install-check.mjs --base-url "$APEX" --sync
curl -sS "$APEX/api/v1/plugins?limit=5" | jq '(.packages|length), .meta'
```

Only after anonymous HTTPS succeeds: pin desktop placeholders via
`npm run pin:company-store-origin` (or paste the origin back into the Store
agent / PR #1). See desktop `company-store-endpoint-swap.md`. Do **not** pin
trycloudflare or localhost into production constants.

Later (real DNS): restore three `routes[]` patterns, set real apex in
`site-config.ts`, re-deploy with `--no-workers-dev`, re-pin desktop.

### C. Dev-only Market → localhost (optional local e2e)

Desktop Stage 2 can point the **company-store** built-in at a local Worker
**without** changing the committed production default:

```bash
# Store: terminal A
npm run smoke:company-plugins-api   # or wrangler dev --local on :8787

# Desktop host process (AI Buddy / dsh-community-market host):
export DSH_COMPANY_STORE_LOCAL_ENDPOINT=1
# or: export DSH_COMPANY_STORE_LOCAL_ENDPOINT=http://127.0.0.1:8787/api/v1/plugins
# Then start the desktop/Market host. Unset the env for normal runs.
```

Rules:

- Env unset → placeholder `https://plugins.company.example` (production default).
- Only `http://127.0.0.1` is accepted; never commit a localhost pin.
- Built-in stays **not** default-selected / not fallback (unchanged).
- This does **not** complete M1; employees still need public HTTPS (§B).

Details: desktop `dsh-community-market/docs/company-store-endpoint-swap.md`
(§ Local development override).

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

Re-checked from scratch on the cloud agent host this turn (shell env, `/tmp/cursor`,
`apps/web/.dev.vars`, Cursor `environment-info` MCP, `npx wrangler whoami`,
GitHub Actions secrets API):

| Check | Result |
| --- | --- |
| `npx wrangler whoami` | **Not authenticated** — no OAuth session |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` env | **Absent** |
| Cursor environment secrets / linked env | **None** (`environment: null`) |
| GitHub Actions secrets list (API) | **403** for this integration — cannot confirm presence; owner must verify names in repo Settings → Secrets |
| `apps/web/.dev.vars` | Present locally for smoke only (gitignored; not CF auth) |
| Wrangler temporary preview account | May appear under `~/.config/.wrangler/` — **not** company auth; expires; Market GET unusable |
| Wrangler config D1 / KV ids | Still all-zero placeholders |
| Custom domain zone | Placeholder `*.company.example` only |

Until company Cloudflare credentials exist, **do not** treat `workers.dev`
temporary preview or a trycloudflare quick tunnel as the permanent Market
origin — AI Buddy `company-store` must pin the final durable apex. Local +
interim tunnel smoke prove the wire contract while the goal stays open.

Requirement audit (done vs blocked): [`goal-completion-checklist.md`](./goal-completion-checklist.md).

## Human unblock packet (M1 → Stage 2 pin)

**Preferred:** follow [§ Local-first](#local-first-recommended-unblock) on your
laptop (`wrangler login` → D1/KV → deploy → HTTPS verify). That unblocks M1
without waiting on this cloud agent’s device-login polls or Actions secrets.

Do **not** redefine M1 as local-only or trycloudflare. Localhost proves the
wire; public HTTPS is the production gate.

### A. Exact GitHub Actions secret **names** (repo Settings → Secrets and variables → Actions)


| Secret name | Value to paste | How to mint |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token string | Cloudflare dashboard → My Profile → API Tokens → Create Token with **Workers Scripts Edit**, **Workers KV Storage Edit**, **Account Analytics Read**, **D1 Edit** (and **DNS Edit** if binding custom domains) |
| `CLOUDFLARE_ACCOUNT_ID` | 32-hex account id | Workers overview right sidebar, or `wrangler whoami` after login |
| `WORKER_GITHUB_TOKEN` (alias `CATALOG_GITHUB_TOKEN`) | GitHub PAT or fine-grained token | Needed for Worker `GITHUB_TOKEN` secret (catalog enrichment); repo `public_repo` / metadata read is enough for public plugins |
| `INSTALL_CLIENT_HASH_SECRET` | ≥32 random bytes (hex/base64) | `openssl rand -hex 32` |
| `CATALOG_SYNC_TOKEN` | ≥32 random bytes | `openssl rand -hex 32` — must match callers of `POST /api/v1/catalog/sync` |
| `GITHUB_OAUTH_CLIENT_ID` | OAuth App client id | Optional for first workers.dev land; required before site sign-in |
| `GITHUB_OAUTH_CLIENT_SECRET` | OAuth App secret | Same |

Optional **Actions variables** (Settings → Variables):

| Variable | When |
| --- | --- |
| `COMPANY_D1_DATABASE_ID` | After first create, commit or set so push deploys do not recreate |
| `COMPANY_KV_NAMESPACE_ID` | Same for KV |
| `COMPANY_DEPLOY_WORKERS_DEV` | Leave unset/`true` for first land; set `false` only after real DNS routes are committed |

### B. Ordered commands (first durable land on `*.workers.dev`)

```bash
# 0) Confirm secrets exist in the Store fork repo (UI), then:
#    Actions → "Company fork Cloudflare deploy" → Run workflow
#    create_resources=true, workers_dev_only=true, apply_migrations=true

# 1) After the workflow succeeds, note the workers.dev URL from the job log, e.g.
#    https://company-store.<subdomain>.workers.dev
export APEX='https://company-store.<subdomain>.workers.dev'   # replace

# 2) Health + empty/anonymous plugins shape
curl -sS "$APEX/api/v1/health"
curl -sS "$APEX/api/v1/plugins?limit=1" | jq 'keys, .meta'

# 3) Sync curated samples (token = repository secret CATALOG_SYNC_TOKEN)
export CATALOG_SYNC_TOKEN='…paste same value…'
node scripts/company-fork-e2e-install-check.mjs --base-url "$APEX" --sync

# 4) Assert anonymous Market GET (packages + meta); record URL for desktop pin
curl -sS "$APEX/api/v1/plugins?limit=5" | jq '(.packages|length), .meta, (.packages[0].installMethods|type)'

# 5) Desktop Stage 2 pin (separate repo) — only now:
#    Edit dsh-community-market/src/adapters/company-store.ts
#      COMPANY_STORE_ENDPOINT = "$APEX/api/v1/plugins"
#      COMPANY_STORE_HOSTNAME = host of $APEX
#    Follow dsh-community-market/docs/company-store-endpoint-swap.md
#    Re-run assemble + wiring + yarn vitest run; push desktop PR.

# 6) Later (real company DNS): fill wrangler routes + D1/KV ids, set
#    COMPANY_DEPLOY_WORKERS_DEV=false, re-run workflow, re-pin desktop constants.
```

### C. Interactive laptop path

Prefer `npm run deploy:company-store-laptop` ([§ Local-first B](#b-from-your-laptop--durable-deploy-recommended)).
That is the maintained one-shot path (login → create D1/KV → strip placeholder
routes → migrate → deploy → curl HTTPS → print desktop pin + **paste-back**).
Prefer it over waiting for cloud-agent `wrangler login` device codes.

After success, either paste the printed origin into this PR / cloud agent, or:

```bash
COMPANY_STORE_ORIGIN='https://company-store.<subdomain>.workers.dev' \
  npm run pin:company-store-origin -- --verify
```

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

## Local listening smoke (dev wire check — not M1-complete)

See [§ Local-first A](#a-local-api-smoke-no-cloudflare-account). Vite
`npm run dev` needs a Cloudflare remote-proxy token in this environment; the
smoke uses **`wrangler dev --local`** against a production build instead (no
account / no API token).

What `npm run smoke:company-plugins-api` does:

1. Writes gitignored `apps/web/.dev.vars` if missing (smoke tokens only).
2. Applies local D1 migrations (`CATALOG_DB --local`).
3. `npm run build` → starts `wrangler dev --local` on `http://127.0.0.1:8787`.
4. `POST /api/v1/catalog/sync` with the three curated samples.
5. Anonymous `GET /api/v1/plugins?limit=5` — asserts `packages` + `meta` (+
   `installMethods` array-or-absent).
6. Writes evidence under `docs/examples/smoke-evidence/`.

CI gate: `.github/workflows/company-fork-deploy-readiness.yml` (PR + push) runs
API contract + company-fork invariants + this smoke.

This is **necessary but not sufficient** for M1 — employees still need public
HTTPS from [§ Local-first B](#b-from-your-laptop--durable-deploy-recommended).

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

**Availability / contract**

- [ ] `GET https://<apex>/api/v1/health` → ok
- [ ] `GET https://<apex>/api/v1/plugins?limit=1` → `packages` + `meta`
- [ ] `GET https://<apex>/api/v1/registry` → `name: dsh-1024store-catalog`
- [ ] `GET https://api.<…>/v1/health` → ok; unknown paths → `404 {"code":"NOT_FOUND"}`
- [ ] www → 301 apex
- [ ] TLS cert valid; no captive portal / Managed Challenge on anonymous Market GET

**Catalog / policy**

- [ ] Catalog sync workflow green after a curated merge (`CATALOG_SYNC_TOKEN` match)
- [ ] `TOPIC_DISCOVERY_ENABLED` still `"0"` unless intentionally reopened
- [ ] Published snapshot package count matches curated `from_pr=1` expectation
- [ ] Stage 3 install check: `node scripts/company-fork-e2e-install-check.mjs --base-url https://<apex>`

**Client pin**

- [ ] AI Buddy `company-store` `COMPANY_STORE_ENDPOINT` / `HOSTNAME` match apex
- [ ] Desktop disclaimer still shows `公司目录，收录≠安全审核` when selected

**Capacity / errors**

- [ ] Workers analytics: alert on sustained 5xx on `/api/v1/plugins` and `/api/v1/health`
- [ ] Public API search quota headers present on metered routes; no unexpected 429 storm
- [ ] D1 size / KV write failures visible in CF dashboard
- [ ] Weekly: export D1 backup even without migration

See also Stage 3 notes: [`company-fork-stage3-e2e-install.md`](./company-fork-stage3-e2e-install.md)
and the live audit: [`goal-completion-checklist.md`](./goal-completion-checklist.md).

### Deploy readiness definition of done

Public HTTPS apex serving anonymous Market-compatible `GET /api/v1/plugins`,
real domain wired into desktop `company-store` adapter constants, Stage 2 merged
and re-verified. Local smoke + docs are necessary but **not** sufficient alone.
