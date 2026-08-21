# Cloudflare plugin discovery

> **Company fork note:** By default this fork sets `TOPIC_DISCOVERY_ENABLED=0`
> and keeps discovery crons empty so the Market publishes only curated
> `catalog/plugins/*.json` entries. See [company-fork-deploy.md](./company-fork-deploy.md).
> The rest of this document describes the upstream whole-network topic scan for
> when that var is intentionally re-enabled.

## Production data flow

GitHub repositories carrying the `dsh-plugin` topic are the primary discovery source. The
checked-in `catalog/plugins/*.json` entries contributed through pull requests remain the
secondary, curated source; GitHub CI pushes them into D1 through
`POST /api/v1/catalog/sync` after every merge to `main`. Nothing is bundled into the Worker.

```text
GitHub topic search ──> repository validation ──────> D1 catalog ──> KV snapshot ──> /api/v1/*
                                                        ▲
checked-in PR catalog ──> CI POST /api/v1/catalog/sync ─┘
```

D1 holds two tables: `catalog_repositories` (one row per GitHub repository) and
`catalog_plugins` (one row per plugin, referencing its repository). A GitHub numeric
repository ID is the stable identity across renames, and the normalized `owner/repository`
key deduplicates rows before that ID is known. Plugins are keyed by the normalized full
plugin id — `owner/repository`, or `owner/repository/sub/dir` for a monorepo subpackage —
so one repository may host several. Which channel found it is a column, not a table:
`from_topic` on the repository (the scan discovers repositories) and `from_pr` on the plugin
(a submission contributes one plugin). Column ownership decides who may overwrite what —
`curated_*` only from a submission, `github_*`/`git_*`/`npm_*` only from the crawler — so a
refresh cannot clobber a reviewed description. If both sources cover the same plugin id
(a topic-scanned repository whose accepted manifest directory matches a curated entry's
path), GitHub owns repository facts and PR metadata owns the display name, category,
bilingual descriptions, and added date; curated subdirectory entries with other paths
coexist as separate plugins of the same repository. Repository-level metrics (stars, forks,
growth, star history) are shared by all plugins of a repository, while install metrics are
keyed by full plugin id.

Topic-only repositories are published after static validation and use the `unclassified`
category until curated metadata is added. PR-only repositories remain published, so losing a
topic never silently removes a maintainer-approved entry.

## Install method inference

Install methods are derived from facts collected by the scheduled discovery pipeline; the
Worker does not install or execute third-party plugins. GitHub inspection records whether the
declared entry point is committed and whether `prepare` exists. npm inspection fetches the
latest manifest for the exact package name declared by the repository and records whether it
declares `dsh.bundle`.

- A published npm package whose latest manifest declares `dsh.bundle` is a verified method and
  is recommended before GitHub source installation. Its `repository` field is diagnostic only:
  a missing, stale, or different backlink does not change npm verification.
- GitHub is always retained as the source method. A committed entry, a carrier package with no
  declared entry, or an entry produced by `prepare` is statically considered loadable. Missing
  build output without `prepare` is unverified; incomplete or failed inspection is unknown.
- When `prepare` exists, the generated GitHub command includes pnpm's
  `--allow-build=<package-name>` option. pnpm therefore grants and persists the permission while
  completing the first install, instead of requiring a known-failing attempt followed by a
  manual `pnpm-workspace.yaml` edit.

“Verified” means the static evidence supports a loadable installation path. It is not a runtime
test, compatibility guarantee, quality rating, or security review.

## Schedules and failure behavior

- `7 * * * *` and `37 * * * *`: Cron Triggers dispatch incremental GitHub discovery every
  30 minutes, with a five-minute overlap. Each incremental run combines GitHub's supported
  `created:` and `pushed:` repository searches and deduplicates the results. This captures new
  repositories and fresh plugin pushes; the weekly full reconciliation catches topic-only
  changes on otherwise inactive repositories.
- `17 3 * * SUN`: weekly full reconciliation, partitioned by repository creation timestamp to
  exhaust GitHub Search's 1,000-result window.
- `*/15 * * * *`: refresh the published catalog/star-growth snapshot.

Each Cron invocation has a 12-minute processing budget and holds a 20-minute D1 lease so it
cannot overlap another discovery run. Work that exceeds the deadline or GitHub budget remains
pending for the next half-hour invocation. Each run has a durable scan record, and each GitHub source record stores the
last full run that saw it. A repository is marked as no longer carrying the topic only after a
successful full scan. The watermark advances only during the final publish step.

The Worker stores a discovery-strategy version in D1. A deployment that changes the search
strategy forces one successful full reconciliation before incremental discovery resumes. This
provides an automatic production backfill without deleting the watermark or editing D1 by hand.

Validation reads the default-branch Git tree and then every root or nested `package.json`
in it, shallowest first. It never installs dependencies or executes repository code. It
requires a package name, `dsh.bundle.patch`, and an existing patch blob in the same tree.

**Every manifest that passes becomes its own plugin.** A monorepo publishing 24 packages
contributes 24 plugins, each with its own `#path:` install spec, install metrics and install
badge; they share their repository's stars, forks and star history. Validation used to stop
at the first manifest that passed and truncate the candidate list at 25, so such a repository
surfaced as exactly one plugin and the rest were invisible with nothing recorded to say so.

One repository must not publish the same plugin twice, which takes rules in two places
because `normalized_plugin_id` is globally unique while the plugin row's primary key
(`repository_id`, `plugin_path`) is case-sensitive. Within a pass, a manifest is dropped
when an earlier one already used its package name (a duplicated package tree is one plugin)
or its case-folded directory. Across passes and sweeps the database decides: the crawler
clears its own stale row for that identity before inserting — which is what lets
`packages/app` be renamed to `packages/App` without the insert failing — and stands down
entirely when the row belongs to a catalog submission, since only a submission may move a
curated plugin. Manifests are also rejected when their package name still carries a
`__NAME__` scaffold placeholder, when no plugin id can represent their directory, and when
the id the row would carry exceeds `PLUGIN_ID_MAX_LENGTH`; publishing any of those yields
an install command that installs something other than the package it names.

A pass reads at most 60 manifest blobs. A repository with more resumes on the next run from
`catalog_repositories.manifest_cursor`, which stores the **path** of the last manifest read
rather than an index — the manifest list is rebuilt from a fresh git tree every pass, so a
positional offset would shift by one for every file removed ahead of it and the sweep would
skip a live package. Such a repository stays in the validation queue until its sweep reaches
the end. Only a finished sweep reconciles: plugins the sweep never re-confirmed are retired
(`validation_code = 'bundle_absent'`), which unpublishes a discovered plugin and gives a
curated one a verdict without retracting it — only a catalog submission may do that.

A repository re-enters the validation queue when it has never been scanned, when its sweep
is mid-flight, when `pushed_at` is newer than `last_scanned_at`, or when its last scan is
more than `VALIDATION_MAX_AGE_MS` (7 days) old. That last clause is the floor under
everything else: a repository rejected wholesale — a tree that 404'd while it was briefly
private, a `default_branch` gone stale after a rename — has no pending plugins, no cursor
and a scan newer than its push, so nothing else could ever bring it back. It also catches a
topic added or removed with no commit behind it. Re-queueing never touches
`validation_status`, so a plugin stays published while it waits for its re-check instead of
blinking out of the catalog. Each repository is inspected at most once per run, so a
repository pushed *during* a run cannot spin the queue.

## GitHub API budget

A personal access token receives 5,000 core REST requests per hour. Repository Search uses a
separate authenticated bucket of 30 requests per minute. Search calls are paced 2.1 seconds
apart (at most 28.6/minute). Every validation batch checks `/rate_limit`, processes repositories
serially, and preserves 500 core calls for the website and other automation. Pending validation
continues in the next half-hour run instead of exhausting the token.

At the current scale of roughly 3,300 topic repositories:

| Work | Expected calls |
| --- | ---: |
| Half-hour created + pushed search with fewer than 100 results each | 2 Search requests |
| Validation of one ordinary single-package repository | 2 core requests |
| Validation of a 24-package monorepo | 1 tree + 25 blob requests |
| Weekly full discovery | roughly 25–35 Search requests |
| First validation backfill, if most repositories have one manifest | roughly 6,600 core requests |

Reading every manifest raises the average cost per repository, not the worst case: a
repository whose manifests all fail validation already read the whole list before this
change. The per-pass ceiling is 61 core requests (1 tree + 60 blobs), and repositories are
re-checked when they are pushed or once a week, whichever comes first, so the steady-state
cost tracks push activity plus roughly 10 repositories per tick for the weekly floor rather
than catalog size. Retiring the phantom root row that used to keep every nested-bundle
monorepo permanently queued is a straight saving that offsets part of the increase.

The initial backfill can span more than one 5,000-request core window. The 500-call reserve makes
that safe; remaining validation work carries over to later half-hour runs. The limit is shared by
all tokens acting as the same GitHub user, so use a dedicated,
read-only fine-grained token. A GitHub App is the later upgrade path if this automation needs an
isolated and scalable quota.

GitHub references: [REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
[rate-limit endpoint](https://docs.github.com/en/rest/rate-limit/rate-limit), and
[REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).

## Cloudflare cost estimate

The production configuration should use Workers Paid. Its account minimum is **US$5/month**.
At this catalog's scale the scanner is expected to remain inside all included monthly usage:

| Resource | Estimated scanner usage | Paid inclusion |
| --- | ---: | ---: |
| Discovery Cron invocations | about 1,445/month | shared 10 million Worker requests |
| Catalog metric refresh | one GraphQL request per 80 published repositories every 15 minutes | shared GitHub GraphQL quota |
| KV writes | at most about 4,400/month | 1 million/month |
| D1 reads | low millions/month | 25 billion/month |
| D1 writes, including indexed rows and star snapshots | low millions/month | 50 million/month |
| D1 storage | well below 1 GB | 5 GB included |

Network waiting does not consume Worker CPU time. Worker CPU has 30 million milliseconds
included per month, and the repository search/JSON processing here should be far below that.
The practical estimate is therefore **US$5/month total with no scanner-specific overage**;
normal website traffic still shares the Worker request and CPU allowance.

Pricing references: [Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/), and
[Workers KV](https://developers.cloudflare.com/kv/platform/pricing/).

## Deployment and operations

The configured D1 database is `dsh-store-star-history`; it stores both star history and the
primary catalog. Apply migrations before deploying code that starts the scheduled Cron task:

```bash
npm ci
npm run typecheck
npm test
npx wrangler d1 export CATALOG_DB --remote --output=catalog-backup-$(date +%Y%m%d-%H%M).sql
npm run db:migrate:remote --workspace @dsh-1024store/web
npm run deploy
```

Nothing deploys on a push: publishing is this local sequence, run deliberately.

Take the export before every migration and check that it restores (`sqlite3 tmp.db < backup.sql`).
It is the only way back: a Worker cannot read a schema it predates, so rolling one back means
rolling back both.

Migrating before deploying is required, not merely recommended, for
`0005_catalog_plugins.sql`: it collapses `catalog_metadata` and
`catalog_repository_sources` into one row per plugin, and a Worker built against the older
shape queries tables that no longer exist.

`GITHUB_TOKEN` must be a Cloudflare Worker secret, never a Wrangler plaintext variable or a
committed `.dev.vars` value. Check Cron invocations and D1 row metrics in the Cloudflare
dashboard after the first backfill. Alert on failed Cron invocations, a stale `discovery_watermark`, or
repeated runs that stop at the 500-call GitHub reserve.

The API reads a fresh KV snapshot first, refreshes it from D1 when stale, and serves the last
KV value during D1/GitHub failures. Stale KV is the only degradation mode; there is no bundled
registry fallback. External consumers read the same D1-backed catalog through
`GET /api/v1/registry` (see [API reference](api.md)).
