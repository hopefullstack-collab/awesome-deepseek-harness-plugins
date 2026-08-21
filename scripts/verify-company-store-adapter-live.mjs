#!/usr/bin/env node
/**
 * Stage 2 adapter wire verification against a live Company Store origin.
 *
 * Desktop `DSH_COMPANY_STORE_LOCAL_ENDPOINT` only allows loopback, so this
 * script does not retarget production constants. Instead it:
 *  1. GETs `${ORIGIN}/api/v1/plugins` anonymously
 *  2. Feeds the JSON through `createDsh1024StyleStoreAdapter` with a stub
 *     HTTP client (same parser the company-store built-in uses)
 *  3. Asserts browse-only github items parse without inventing npm identity
 *
 * Usage:
 *   COMPANY_STORE_ORIGIN=https://….trycloudflare.com \
 *     DESKTOP_MARKET_PATH=/path/to/dsh-community-market \
 *     node scripts/verify-company-store-adapter-live.mjs
 *
 * Defaults DESKTOP_MARKET_PATH to common cloud-agent clones when present.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = (
  process.env.COMPANY_STORE_ORIGIN || process.env.SMOKE_BASE_URL || ''
).trim().replace(/\/$/, '')
const evidenceDir = resolve(
  process.env.SMOKE_EVIDENCE_DIR || join(root, 'docs/examples/smoke-evidence'),
)

const candidateMarkets = [
  process.env.DESKTOP_MARKET_PATH,
  '/tmp/desktop-fork/dsh-community-market',
  '/tmp/desktop-remote-tip/dsh-community-market',
  '/tmp/stage2-clone-selftest/dsh-community-market',
].filter(Boolean)

function fail(message) {
  console.error(`verify-company-store-adapter-live: FAIL — ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`verify-company-store-adapter-live: ${message}`)
}

function findMarket() {
  for (const candidate of candidateMarkets) {
    const adapter = join(candidate, 'src/adapters/dsh-1024-style-store.ts')
    if (existsSync(adapter)) return resolve(candidate)
  }
  return null
}

async function loadAdapterFactory(marketPath) {
  // Prefer compiled/tsx path via vitest-less dynamic import of .ts through
  // Node's experimental strip-types when available; else shell out to a tiny
  // vitest/tsx runner. Try native .ts import first (Node 22+).
  const modulePath = join(marketPath, 'src/adapters/dsh-1024-style-store.ts')
  try {
    const mod = await import(pathToFileURL(modulePath).href)
    if (typeof mod.createDsh1024StyleStoreAdapter === 'function') {
      return mod.createDsh1024StyleStoreAdapter
    }
  } catch (error) {
    ok(`native .ts import failed (${error instanceof Error ? error.message : error}); trying tsx`)
  }

  // Fallback: evaluate via npx tsx in a child that prints JSON summary.
  return null
}

async function runViaTsx(marketPath, catalog) {
  const runner = `
import { createDsh1024StyleStoreAdapter } from './src/adapters/dsh-1024-style-store.ts'
const catalog = ${JSON.stringify(catalog)}
const endpoint = 'https://plugins.company.example/api/v1/plugins'
const adapter = createDsh1024StyleStoreAdapter({
  key: 'company-store',
  endpoint,
  hostname: 'plugins.company.example',
  providerId: 'com.company.store.catalog',
  adapterId: 'market.company-store-v1',
  errorLabel: 'Company Store',
})
const http = {
  async getJson(url) {
    const requested = new URL(url)
    const expected = new URL(endpoint)
    if (requested.origin !== expected.origin || requested.pathname !== expected.pathname) {
      throw new Error('origin mismatch')
    }
    return { value: catalog, finalUrl: endpoint }
  },
}
const media = { register() { throw new Error('no media') }, unregisterSource() {} }
const source = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120099',
  registrationKind: 'built-in',
  adapterId: 'market.company-store-v1',
  providerId: 'com.company.store.catalog',
  builtInProviderKey: 'company-store',
  enabled: true,
  order: 0,
}
const snapshot = await adapter.fetch({ limit: 50 }, {
  signal: new AbortController().signal,
  source,
  http,
  media,
})
const items = snapshot.items || []
const browseOnly = items.filter((item) => !item.package)
const withRepo = items.filter((item) => item.repository?.url?.startsWith('https://github.com/'))
const inventedNpm = items.filter((item) => item.package?.registry === 'npm')
console.log(JSON.stringify({
  itemCount: items.length,
  browseOnlyCount: browseOnly.length,
  githubRepoCount: withRepo.length,
  npmCount: inventedNpm.length,
  sampleIds: items.slice(0, 5).map((i) => i.id),
  providerId: snapshot.source?.providerId,
  adapterId: snapshot.source?.adapterId,
}))
`
  const tmp = join(marketPath, '.tmp-adapter-live-runner.mjs')
  writeFileSync(tmp, runner, 'utf8')
  const result = spawnSync(
    'npx',
    ['--yes', 'tsx', tmp],
    { cwd: marketPath, encoding: 'utf8', env: process.env, timeout: 120_000 },
  )
  try {
    // best-effort cleanup
    spawnSync('rm', ['-f', tmp])
  } catch {
    // ignore
  }
  if (result.status !== 0) {
    throw new Error(`tsx runner failed: ${result.stderr || result.stdout}`)
  }
  const line = (result.stdout || '').trim().split('\n').filter(Boolean).at(-1)
  return JSON.parse(line)
}

async function main() {
  if (!origin) {
    fail('Set COMPANY_STORE_ORIGIN or SMOKE_BASE_URL')
    return
  }
  const marketPath = findMarket()
  if (!marketPath) {
    fail('No dsh-community-market checkout found (set DESKTOP_MARKET_PATH)')
    return
  }
  ok(`market=${marketPath}`)
  ok(`origin=${origin}`)

  const response = await fetch(`${origin}/api/v1/plugins?limit=50`, {
    headers: { Accept: 'application/json' },
  })
  const text = await response.text()
  if (!response.ok) {
    fail(`GET plugins HTTP ${response.status}: ${text.slice(0, 200)}`)
    return
  }
  const catalog = JSON.parse(text)
  if (!Array.isArray(catalog.packages) || catalog.packages.length === 0) {
    fail('live catalog packages empty')
    return
  }

  let createFactory = await loadAdapterFactory(marketPath)
  let parsed
  if (createFactory) {
    const endpoint = 'https://plugins.company.example/api/v1/plugins'
    const adapter = createFactory({
      key: 'company-store',
      endpoint,
      hostname: 'plugins.company.example',
      providerId: 'com.company.store.catalog',
      adapterId: 'market.company-store-v1',
      errorLabel: 'Company Store',
    })
    const snapshot = await adapter.fetch({ limit: 50 }, {
      signal: new AbortController().signal,
      source: {
        sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120099',
        registrationKind: 'built-in',
        adapterId: 'market.company-store-v1',
        providerId: 'com.company.store.catalog',
        builtInProviderKey: 'company-store',
        enabled: true,
        order: 0,
      },
      http: {
        async getJson(url) {
          const requested = new URL(url)
          const expected = new URL(endpoint)
          if (requested.origin !== expected.origin) throw new Error('origin mismatch')
          return { value: catalog, finalUrl: endpoint }
        },
      },
      media: {
        register() {
          throw new Error('no media')
        },
        unregisterSource() {},
      },
    })
    const items = snapshot.items || []
    parsed = {
      itemCount: items.length,
      browseOnlyCount: items.filter((item) => !item.package).length,
      githubRepoCount: items.filter((item) =>
        item.repository?.url?.startsWith('https://github.com/'),
      ).length,
      npmCount: items.filter((item) => item.package?.registry === 'npm').length,
      sampleIds: items.slice(0, 5).map((i) => i.id),
      providerId: snapshot.source?.providerId,
      adapterId: snapshot.source?.adapterId,
    }
  } else {
    parsed = await runViaTsx(marketPath, catalog)
  }

  const pass =
    parsed.itemCount >= 1
    && parsed.githubRepoCount >= 1
    && parsed.browseOnlyCount === parsed.itemCount
    && parsed.npmCount === 0
    && parsed.providerId === 'com.company.store.catalog'
    && parsed.adapterId === 'market.company-store-v1'

  const evidence = {
    capturedAt: new Date().toISOString(),
    kind: 'company-store-adapter-live-wire',
    origin,
    marketPath,
    packageCount: catalog.packages.length,
    parsed,
    pass,
    note: 'Parser fed live Market JSON via stub HTTP client. Does not pin COMPANY_STORE_* and does not use trycloudflare as production endpoint.',
  }
  mkdirSync(evidenceDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(evidenceDir, `adapter-live-${stamp}.json`)
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  ok(`wrote ${file}`)

  if (pass) {
    ok(
      `PASS — items=${parsed.itemCount} browseOnly=${parsed.browseOnlyCount} github=${parsed.githubRepoCount} npm=${parsed.npmCount}`,
    )
  } else {
    fail(`adapter parse assertions failed: ${JSON.stringify(parsed)}`)
  }
}

await main()
