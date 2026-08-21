import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NpmProbeResult } from '../worker/lib/npm-registry'
import type { NpmDownloadsResult } from '../worker/lib/npm-downloads'

// The snapshot refresh and the registry are separate concerns with their own
// tests; stubbing them keeps this file about the sweep/cursor/write logic.
const refreshCatalogSnapshot = vi.fn(async () => ({ snapshot: null, source: 'd1' as const }))
vi.mock('../worker/lib/catalog-store', () => ({ refreshCatalogSnapshot }))

const probeNpmPackage = vi.fn<
  (id: string, packageName: string, etag: string | null) => Promise<NpmProbeResult>
>()
vi.mock('../worker/lib/npm-registry', () => ({ probeNpmPackage }))

const fetchNpmDownloads7d = vi.fn<(packageName: string) => Promise<NpmDownloadsResult>>()
vi.mock('../worker/lib/npm-downloads', () => ({ fetchNpmDownloads7d }))

const { runNpmRefreshTask } = await import('../worker/lib/npm-refresh-task')

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SqliteD1Statement(this.database, this.sql, params)
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] }
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

function sqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(database, sql)
    },
    async batch(statements: SqliteD1Statement[]) {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  } as unknown as D1Database
}

const NOW = '2026-08-19T00:00:00.000Z'
const SCHEDULED_AT = Date.parse(NOW)

function catalogDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  for (const migration of ['0002_plugin_catalog.sql', '0005_catalog_plugins.sql',
    '0006_ai_classification.sql', '0009_manifest_sweep.sql', '0010_npm_etag.sql',
    '0011_npm_downloads.sql', '0012_npm_download_ownership.sql']) {
    database.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  }
  // One topic-discovered repository; its accepted plugins are the eligible set.
  database.prepare(`
    INSERT INTO catalog_repositories (github_id, full_name, normalized_full_name, owner,
      repository_name, html_url, from_topic, first_seen_at, last_seen_at, created_at, updated_at)
    VALUES (42, 'Scan/Repo', 'scan/repo', 'Scan', 'Repo', 'https://github.com/Scan/Repo', 1, ?, ?, ?, ?)
  `).run(NOW, NOW, NOW, NOW)
  return database
}

interface SeedOptions {
  packageName?: string | null
  npmStatus?: string
  npmVersion?: string | null
  npmEtag?: string | null
  validationStatus?: string
}

function seedPlugin(database: DatabaseSync, path: string, options: SeedOptions = {}): void {
  const repo = database.prepare('SELECT id FROM catalog_repositories WHERE normalized_full_name = ?')
    .get('scan/repo') as { id: number }
  const pluginId = `Scan/Repo/${path}`
  database.prepare(`
    INSERT INTO catalog_plugins (repository_id, plugin_id, normalized_plugin_id, plugin_path,
      package_name, npm_status, npm_version, npm_etag, validation_status,
      first_seen_at, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    repo.id, pluginId, pluginId.toLowerCase(), path,
    options.packageName ?? `pkg-${path}`,
    options.npmStatus ?? 'found',
    options.npmVersion ?? '1.0.0',
    options.npmEtag ?? null,
    options.validationStatus ?? 'accepted',
    NOW, NOW, NOW, NOW,
  )
}

function pluginRow(database: DatabaseSync, path: string) {
  return database.prepare(
    'SELECT npm_version, npm_etag, npm_status FROM catalog_plugins WHERE plugin_path = ?',
  ).get(path) as { npm_version: string | null; npm_etag: string | null; npm_status: string }
}

function state(database: DatabaseSync, key: string): string | null {
  const row = database.prepare('SELECT value FROM catalog_state WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function notModified(etag: string): NpmProbeResult {
  return {
    status: 'not_modified', httpStatus: 304, version: null, repositoryUrl: null,
    repositoryDirectory: null, bundleDeclared: false, entryPoint: null, tarballUrl: null,
    integrity: null, binding: 'unknown', etag,
  }
}

function found(version: string, etag: string): NpmProbeResult {
  return {
    status: 'found', httpStatus: 200, version, repositoryUrl: 'https://github.com/Scan/Repo',
    repositoryDirectory: null, bundleDeclared: true, entryPoint: './index.js', tarballUrl: 'https://x.tgz',
    integrity: 'sha512-x', binding: 'strict', etag,
  }
}

function absent(): NpmProbeResult {
  return {
    status: 'absent', httpStatus: 404, version: null, repositoryUrl: null, repositoryDirectory: null,
    bundleDeclared: false, entryPoint: null, tarballUrl: null, integrity: null, binding: 'absent', etag: null,
  }
}

function checkedAt(database: DatabaseSync, path: string): string | null {
  return (database.prepare('SELECT npm_checked_at FROM catalog_plugins WHERE plugin_path = ?')
    .get(path) as { npm_checked_at: string | null }).npm_checked_at
}

function envFor(database: DatabaseSync): Env {
  return {
    CATALOG_DB: sqliteD1(database),
    // These fixtures seed topic-discovered plugins; re-enable topic eligibility.
    TOPIC_DISCOVERY_ENABLED: '1',
  } as unknown as Env
}

describe('npm refresh task', () => {
  beforeEach(() => {
    probeNpmPackage.mockReset()
    fetchNpmDownloads7d.mockReset()
    fetchNpmDownloads7d.mockResolvedValue({ status: 'error' })
    refreshCatalogSnapshot.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes nothing and skips the snapshot when every package is 304', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'a', { npmEtag: '"a1"', npmVersion: '1.0.0' })
    seedPlugin(database, 'b', { npmEtag: '"b1"', npmVersion: '2.0.0' })
    probeNpmPackage.mockImplementation(async (_id, _name, etag) => notModified(etag ?? ''))

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result).toMatchObject({ probed: 2, notModified: 2, found: 0, absent: 0, errors: 0 })
    expect(refreshCatalogSnapshot).not.toHaveBeenCalled()
    // Untouched — a 304 does not rewrite the row.
    expect(pluginRow(database, 'a')).toMatchObject({ npm_version: '1.0.0', npm_etag: '"a1"' })
    // Whole set fit in one tick, so the cursor wrapped back to the start.
    expect(result.wrapped).toBe(true)
    expect(state(database, 'npm_refresh_cursor')).toBe('')
    database.close()
  })

  it('records stale download counts while the existing version sweep visits a package', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'a', { npmEtag: '"a1"', npmVersion: '1.0.0' })
    database.prepare(
      `UPDATE catalog_plugins
          SET npm_package_name = 'pkg-a', npm_bundle_declared = 1
        WHERE plugin_path = 'a'`,
    ).run()
    probeNpmPackage.mockImplementation(async (_id, _name, etag) => notModified(etag ?? ''))
    fetchNpmDownloads7d.mockResolvedValue({
      status: 'found', downloads: 321, start: '2026-08-12', end: '2026-08-18',
    })

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result).toMatchObject({
      notModified: 1, downloadsChecked: 1, downloadsUpdated: 1, downloadErrors: 0,
    })
    expect(fetchNpmDownloads7d).toHaveBeenCalledWith('pkg-a')
    expect(database.prepare(
      `SELECT npm_downloads_7d, npm_downloads_start, npm_downloads_end
         FROM catalog_plugins WHERE plugin_path = 'a'`,
    ).get()).toEqual({
      npm_downloads_7d: 321,
      npm_downloads_start: '2026-08-12',
      npm_downloads_end: '2026-08-18',
    })
    expect(refreshCatalogSnapshot).toHaveBeenCalledTimes(1)
    database.close()
  })

  it('never fetches downloads for a package owned by another repository', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'fork', { npmEtag: '"fork1"', npmVersion: '1.0.0' })
    database.prepare(
      `UPDATE catalog_plugins
          SET npm_package_name = 'pkg-fork', npm_bundle_declared = 1, npm_binding = 'mismatch'
        WHERE plugin_path = 'fork'`,
    ).run()
    probeNpmPackage.mockImplementation(async (_id, _name, etag) => notModified(etag ?? ''))

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result).toMatchObject({ notModified: 1, downloadsChecked: 0, downloadsUpdated: 0 })
    expect(fetchNpmDownloads7d).not.toHaveBeenCalled()
    database.close()
  })

  it('caps a cold-start download backfill at 50 packages per scheduled tick', async () => {
    const database = catalogDatabase()
    for (let index = 0; index < 51; index += 1) {
      seedPlugin(database, `pkg-${String(index).padStart(2, '0')}`, { npmEtag: `"${index}"` })
    }
    database.prepare(`
      UPDATE catalog_plugins
         SET npm_package_name = package_name, npm_bundle_declared = 1
    `).run()
    probeNpmPackage.mockImplementation(async (_id, _name, etag) => notModified(etag ?? ''))
    fetchNpmDownloads7d.mockResolvedValue({
      status: 'found', downloads: 123, start: '2026-08-12', end: '2026-08-18',
    })

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result.downloadsChecked).toBe(50)
    expect(result.downloadsUpdated).toBe(50)
    expect(fetchNpmDownloads7d).toHaveBeenCalledTimes(50)
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM catalog_plugins WHERE npm_downloads_status = \'pending\'',
    ).get()).toEqual({ count: 1 })
    database.close()
  })

  it('records the new version and ETag and refreshes the snapshot on a change', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'a', { npmEtag: '"a1"', npmVersion: '1.0.0' })
    database.prepare(
      `UPDATE catalog_plugins
          SET npm_package_name = 'pkg-a', npm_downloads_7d = 99,
              npm_downloads_start = '2026-08-12', npm_downloads_end = '2026-08-18',
              npm_downloads_status = 'found', npm_downloads_checked_at = ?
        WHERE plugin_path = 'a'`,
    ).run(NOW)
    probeNpmPackage.mockImplementation(async () => found('3.4.5', '"a2"'))

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result).toMatchObject({ probed: 1, found: 1 })
    expect(pluginRow(database, 'a')).toMatchObject({ npm_version: '3.4.5', npm_etag: '"a2"', npm_status: 'found' })
    expect(database.prepare(
      `SELECT npm_downloads_7d, npm_downloads_checked_at FROM catalog_plugins WHERE plugin_path = 'a'`,
    ).get()).toEqual({ npm_downloads_7d: 99, npm_downloads_checked_at: NOW })
    expect(refreshCatalogSnapshot).toHaveBeenCalledTimes(1)
    database.close()
  })

  it('probes brand-new pending packages (no ETag) so they earn a badge fast', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'new', { npmStatus: 'pending', npmVersion: null, npmEtag: null })
    probeNpmPackage.mockImplementation(async () => found('0.1.0', '"n1"'))

    await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    // Called with a null ETag (unconditional first fetch), then persisted.
    expect(probeNpmPackage).toHaveBeenCalledWith('Scan/Repo/new', 'pkg-new', null)
    expect(pluginRow(database, 'new')).toMatchObject({ npm_version: '0.1.0', npm_etag: '"n1"', npm_status: 'found' })
    database.close()
  })

  it('resumes the sweep from the stored cursor and skips earlier ids', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'a', { npmEtag: '"a1"' })
    seedPlugin(database, 'b', { npmEtag: '"b1"' })
    seedPlugin(database, 'c', { npmEtag: '"c1"' })
    // Cursor sits just after 'a', so only b and c are in range this tick.
    database.prepare(
      "INSERT INTO catalog_state (key, value, updated_at) VALUES ('npm_refresh_cursor', ?, ?)",
    ).run('scan/repo/a', NOW)
    probeNpmPackage.mockImplementation(async (_id, name) => found('9.9.9', `"${name}"`))

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    const probed = probeNpmPackage.mock.calls.map((call) => call[1]).sort()
    expect(probed).toEqual(['pkg-b', 'pkg-c'])
    expect(result.found).toBe(2)
    // 'a' was before the cursor, so it was left as it was.
    expect(pluginRow(database, 'a')).toMatchObject({ npm_version: '1.0.0' })
    expect(pluginRow(database, 'c')).toMatchObject({ npm_version: '9.9.9' })
    database.close()
  })

  it('skips writing an absent package that is still absent (no churn)', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'gone', { npmStatus: 'absent', npmVersion: null, npmEtag: null })
    probeNpmPackage.mockImplementation(async () => absent())

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result).toMatchObject({ probed: 1, absent: 0, skippedUnchanged: 1 })
    // npm_checked_at was NULL on seed and stays NULL — nothing was written.
    expect(checkedAt(database, 'gone')).toBeNull()
    expect(refreshCatalogSnapshot).not.toHaveBeenCalled()
    database.close()
  })

  it('writes when a found package becomes absent (a real transition, not churn)', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'x', { npmStatus: 'found', npmVersion: '1.0.0', npmEtag: '"x1"' })
    database.prepare(
      `UPDATE catalog_plugins
          SET npm_package_name = 'pkg-x', npm_downloads_7d = 99,
              npm_downloads_status = 'found', npm_downloads_checked_at = ?
        WHERE plugin_path = 'x'`,
    ).run(NOW)
    probeNpmPackage.mockImplementation(async () => absent())

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result).toMatchObject({ absent: 1, skippedUnchanged: 0 })
    // The package was unpublished: status flips and the version clears.
    expect(pluginRow(database, 'x')).toMatchObject({ npm_status: 'absent', npm_version: null, npm_etag: null })
    expect(database.prepare(
      `SELECT npm_downloads_7d, npm_downloads_checked_at FROM catalog_plugins WHERE plugin_path = 'x'`,
    ).get()).toEqual({ npm_downloads_7d: null, npm_downloads_checked_at: null })
    expect(refreshCatalogSnapshot).toHaveBeenCalledTimes(1)
    database.close()
  })

  it('leaves an error result as bookkeeping without clobbering the version', async () => {
    const database = catalogDatabase()
    seedPlugin(database, 'a', { npmEtag: '"a1"', npmVersion: '1.0.0' })
    probeNpmPackage.mockImplementation(async () => ({
      status: 'error', httpStatus: 503, version: null, repositoryUrl: null, repositoryDirectory: null,
      bundleDeclared: false, entryPoint: null, tarballUrl: null, integrity: null, binding: 'unknown', etag: null,
    }))

    const result = await runNpmRefreshTask(envFor(database), SCHEDULED_AT)

    expect(result).toMatchObject({ errors: 1, found: 0 })
    // Version and ETag survive a registry outage; only the status flips.
    expect(pluginRow(database, 'a')).toMatchObject({ npm_version: '1.0.0', npm_etag: '"a1"', npm_status: 'error' })
    expect(refreshCatalogSnapshot).not.toHaveBeenCalled()
    database.close()
  })
})
