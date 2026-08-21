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
