# Curated sample set (company Store)

These are **real** public DSH plugins already present under `catalog/plugins/`.
They are copied here as a documented company-review starter set — not invented
packages.

| File | Plugin id | Notes |
| --- | --- | --- |
| `anweat--dsh-restart.json` | `anweat/dsh-restart` | Browse-capable catalog entry; Installable only after npm verification yields a verified method |
| `jesse-njx--dsh-crosstalk.json` | `Jesse-njx/dsh-crosstalk` | Same — structure matches `plugin.schema.json` |
| `awesome-dsh-plugin--dsh-find-plugin.json` | `awesome-dsh-plugin/dsh-find-plugin` | Curated registry helper plugin |

## Browse → Installable (1024Store rules)

Catalog JSON alone is **browse** metadata. AI Buddy marks a row **Installable**
only when `GET /api/v1/plugins` exposes exactly one verified npm target that
passes the Market adapter’s `reviewedNpmTarget` check:

- `kind: "npm"`
- `verification: "verified"`
- `code: "repository_backlink"` (Store also aliases `published_package`)
- `requiresBuildAllowance: false`
- stable semver `revision` + valid npm `spec`
- HTTPS GitHub `url` matching the plugin identity

See `docs/ai-buddy-stage2/patch/fixtures/plugins-api.installable.json` for a
captured wire fixture of verified public npm plugins (used by the Stage 2
adapter tests). Do not invent fake npm package names in catalog JSON.

## How to use in a company fork

1. Keep `TOPIC_DISCOVERY_ENABLED=0`.
2. Curate by editing `catalog/plugins/*.json` (these three are already live in
   this fork’s tree).
3. Sync → D1 (`from_pr = 1`) → npm probe → publish snapshot.
4. Confirm with `curl '.../api/v1/plugins?limit=5'` that `packages[].installMethods`
   and `meta` match the preserved wire shape (`name` registry remains
   `dsh-1024store-catalog`).

## E2E smoke without a private registry

Private npm one-click is **out of scope**. What this fork can prove today:

| Layer | Evidence |
| --- | --- |
| Catalog JSON schema | Files above + `company-fork-invariants` sample schema check |
| Listening Market API | `npm run smoke:company-plugins-api` → syncs these three → anonymous `GET /api/v1/plugins` |
| Installable wire fixture | `docs/ai-buddy-stage2/patch/fixtures/plugins-api.installable.json` (verified npm `repository_backlink` rows for adapter tests) |
| Public npm installability | Only after deployed Store runs npm probe against real registry; do not invent package names |

```bash
# From repo root (starts local origin, syncs samples, curls plugins):
npm run smoke:company-plugins-api
# Evidence: docs/examples/smoke-evidence/LATEST.md
```

After public HTTPS deploy, re-run the same curl against the apex and paste the
URL into the desktop `company-store` adapter constants.
