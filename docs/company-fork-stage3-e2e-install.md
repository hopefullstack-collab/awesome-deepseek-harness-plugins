# Stage 3 — E2E install notes (company Store → AI Buddy)

Private npm one-click is **out of scope**. Stage 3 proves that a curated
company catalog entry can become **Installable** in AI Buddy Market after a
**durable** public HTTPS Store origin exists (M1), using the same public npm
`repository_backlink` rules as official 1024Store.

## Preconditions

1. Durable apex or `https://company-store.<account>.workers.dev` serving
   anonymous `GET /api/v1/plugins` (not trycloudflare).
2. `CATALOG_SYNC_TOKEN` uploaded to the Worker and known to the operator.
3. Desktop PR #19 (or merged equivalent) with `COMPANY_STORE_*` pinned to that
   apex — see `company-store-endpoint-swap.md` on the desktop fork.
4. Curated samples under [`examples/curated-reviewed/`](./examples/curated-reviewed/).

## Operator script (Store repo)

```bash
# Against a live durable origin (after deploy + secrets):
export CATALOG_SYNC_TOKEN='…'
node scripts/company-fork-e2e-install-check.mjs \
  --base-url 'https://company-store.<subdomain>.workers.dev' \
  --sync

# Dry / local (already covered by M1 smoke — browse wire only):
npm run smoke:company-plugins-api
```

What the e2e check asserts:

| Step | Pass criteria |
| --- | --- |
| Health | `GET /api/v1/health` → ok |
| Sync (optional `--sync`) | `POST /api/v1/catalog/sync` with the three curated samples → 2xx |
| Plugins wire | Anonymous `GET /api/v1/plugins?limit=20` → `packages` + `meta` |
| Installable signal | At least one package has `installMethods` containing a single verified npm target (`verification: verified`, `code: repository_backlink` or `published_package`, semver `revision`) **or** documents browse-only when npm probe has not yet run |
| Registry compat | `GET /api/v1/registry` → `name: dsh-1024store-catalog` |

If every row is still browse-only after sync, run the Store’s normal catalog
publish / npm probe path (same as upstream 1024Store) against the public npm
registry — do **not** invent package names in catalog JSON.

## AI Buddy side (after pin)

1. Add built-in `company-store` (starts **disabled**).
2. Select it explicitly (must show disclaimer `公司目录，收录≠安全审核`).
3. Confirm official `dsh-1024store` is **not** auto-selected and that forcing an
   official fetch failure does **not** enable company-store.
4. Install one Installable row via the normal Market install UI (public npm).

## Evidence to attach when Stage 3 closes

- Curl / script stdout against the durable HTTPS origin (URL + timestamp).
- Screenshot or note of Market Installable row for one curated plugin.
- Confirmation that `COMPANY_STORE_ENDPOINT` matches that origin (desktop commit).

Until durable HTTPS exists, keep Stage 3 **blocked**; local smoke + installable
fixtures are preparation only.
