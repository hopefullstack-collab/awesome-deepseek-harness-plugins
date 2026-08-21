#!/usr/bin/env node
/**
 * Live-origin Company Store Market smoke (no Worker boot).
 *
 * Fetches an already-running origin (interim trycloudflare, localhost, or
 * durable workers.dev) and asserts Market wire shape + q filter + search
 * pagination. Does **not** pin desktop constants; trycloudflare remains
 * pin-ineligible.
 *
 * Usage (repo root):
 *   COMPANY_STORE_ORIGIN=https://….trycloudflare.com npm run smoke:company-store-live
 *   COMPANY_STORE_ORIGIN=http://127.0.0.1:8787 npm run smoke:company-store-live
 *
 * Env:
 *   COMPANY_STORE_ORIGIN / SMOKE_BASE_URL  required (no trailing slash)
 *   SMOKE_EVIDENCE_DIR                    default docs/examples/smoke-evidence
 *   SMOKE_TIMEOUT_MS                      default 30000
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDir = resolve(
  process.env.SMOKE_EVIDENCE_DIR || join(root, 'docs/examples/smoke-evidence'),
)
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 30_000)
const rawOrigin = (
  process.env.COMPANY_STORE_ORIGIN || process.env.SMOKE_BASE_URL || ''
).trim().replace(/\/$/, '')

const checks = []

function fail(message) {
  console.error(`smoke-company-store-live: FAIL — ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`smoke-company-store-live: ${message}`)
}

function record(name, pass, detail = '') {
  checks.push({ name, pass, detail })
  if (pass) ok(`✓ ${name}${detail ? ` — ${detail}` : ''}`)
  else fail(`${name}${detail ? ` — ${detail}` : ''}`)
}

function isTrycloudflare(origin) {
  try {
    return new URL(origin).hostname.endsWith('.trycloudflare.com')
  } catch {
    return false
  }
}

function isLocalhost(origin) {
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

async function getJson(path) {
  const url = `${rawOrigin}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'manual',
    })
    const text = await response.text()
    const challenge =
      /managed.challenge|cf-challenge|Just a moment/i.test(text)
      || response.headers.get('cf-mitigated') === 'challenge'
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { url, response, text, body, challenge, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}

function assertPackageRow(pkg, index) {
  for (const field of ['id', 'name', 'owner', 'url', 'category']) {
    if (typeof pkg[field] !== 'string' || pkg[field].length === 0) {
      throw new Error(`packages[${index}].${field} missing`)
    }
  }
  if (!String(pkg.id).includes('/')) {
    throw new Error(`packages[${index}].id must be owner/name`)
  }
  if (pkg.installMethods !== undefined) {
    if (!Array.isArray(pkg.installMethods)) {
      throw new Error(`packages[${index}].installMethods must be array`)
    }
    for (const [i, method] of pkg.installMethods.entries()) {
      if (typeof method !== 'object' || method === null) {
        throw new Error(`packages[${index}].installMethods[${i}] invalid`)
      }
      if (typeof method.kind !== 'string' || method.kind.length === 0) {
        throw new Error(`packages[${index}].installMethods[${i}].kind missing`)
      }
    }
  }
}

function pinRefuseCheck() {
  if (!isTrycloudflare(rawOrigin) && !isLocalhost(rawOrigin)) {
    record('pin-script-refuse', true, 'skipped (origin looks durable; not invoking pin)')
    return
  }
  const result = spawnSync(
    'bash',
    [join(root, 'scripts/pin-company-store-origin.sh')],
    {
      cwd: root,
      env: { ...process.env, COMPANY_STORE_ORIGIN: rawOrigin },
      encoding: 'utf8',
    },
  )
  const combined = `${result.stdout || ''}${result.stderr || ''}`
  const refused =
    result.status !== 0
    && /Refuse (trycloudflare|localhost|non-HTTPS|http\b)/i.test(combined)
  record(
    'pin-script-refuse',
    refused,
    refused ? 'correctly refused ephemeral/local origin' : combined.slice(0, 240),
  )
}

function writeEvidence(summary) {
  mkdirSync(evidenceDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const summaryFile = `live-smoke-${stamp}.json`
  const summaryPath = join(evidenceDir, summaryFile)
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  const latestLive = join(evidenceDir, 'LIVE.md')
  const lines = [
    '# Company Store live-origin smoke',
    '',
    `Captured: ${summary.capturedAt}`,
    `Origin: \`${summary.origin}\``,
    `Script: \`npm run smoke:company-store-live\``,
    `durable: **${summary.durable}** · pinAllowed: **${summary.pinAllowed}** · m1Complete: **${summary.m1Complete}**`,
    '',
    '## Checks',
    '',
    ...summary.checks.map(
      (c) => `- [${c.pass ? 'x' : ' '}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`,
    ),
    '',
    '## Wire snapshot',
    '',
    `- packages: ${summary.plugins?.packageCount ?? 'n/a'}`,
    `- meta.total: ${summary.plugins?.meta?.total ?? 'n/a'}`,
    `- meta.source: ${summary.plugins?.meta?.source ?? 'n/a'}`,
    `- q=crosstalk packages: ${summary.qHit?.packageCount ?? 'n/a'}`,
    `- search page1 limit2: ${summary.searchPage1?.resultCount ?? 'n/a'} / total ${summary.searchPage1?.total ?? 'n/a'}`,
    `- search page2 limit2: ${summary.searchPage2?.resultCount ?? 'n/a'}`,
    `- body sha256[0:16]: \`${summary.pluginsBodyDigest ?? ''}\``,
    `- Artifact: [\`${summaryFile}\`](./${summaryFile})`,
    '',
    'Do **not** treat trycloudflare as Stage 2 production pin evidence.',
    '',
  ]
  writeFileSync(latestLive, `${lines.join('\n')}\n`, 'utf8')

  // Append a short section to LATEST.md without wiping local M1 evidence.
  const latestPath = join(evidenceDir, 'LATEST.md')
  const marker = '## Live-origin smoke (`smoke:company-store-live`)'
  let previous = existsSync(latestPath) ? readFileSync(latestPath, 'utf8') : ''
  const block = [
    marker,
    '',
    `Captured: ${summary.capturedAt}`,
    `Origin: \`${summary.origin}\``,
    `PASS checks: ${summary.checks.filter((c) => c.pass).length}/${summary.checks.length}`,
    `durable=${summary.durable} pinAllowed=${summary.pinAllowed}`,
    `Details: [\`LIVE.md\`](./LIVE.md) · [\`${summaryFile}\`](./${summaryFile})`,
    '',
  ].join('\n')
  if (previous.includes(marker)) {
    previous = previous.replace(
      new RegExp(`${marker}[\\s\\S]*?(?=\\n## |$)`),
      `${block}\n`,
    )
  } else {
    previous = `${previous.trimEnd()}\n\n${block}\n`
  }
  writeFileSync(latestPath, previous, 'utf8')
  ok(`wrote ${summaryPath} and LIVE.md`)
}

async function main() {
  if (!rawOrigin) {
    fail('Set COMPANY_STORE_ORIGIN or SMOKE_BASE_URL to the live origin')
    return
  }
  let originUrl
  try {
    originUrl = new URL(rawOrigin)
  } catch {
    fail(`Invalid origin: ${rawOrigin}`)
    return
  }
  if (!['http:', 'https:'].includes(originUrl.protocol)) {
    fail(`Origin must be http(s): ${rawOrigin}`)
    return
  }

  const durable = originUrl.protocol === 'https:'
    && !isTrycloudflare(rawOrigin)
    && !isLocalhost(rawOrigin)
  const pinAllowed = durable
  ok(`origin=${rawOrigin} durable=${durable} pinAllowed=${pinAllowed}`)

  const health = await getJson('/api/v1/health')
  record(
    'health',
    health.status === 200
      && !health.challenge
      && health.body?.status === 'ok',
    `HTTP ${health.status} challenge=${health.challenge}`,
  )

  const plugins = await getJson('/api/v1/plugins?limit=5')
  let pluginsOk = false
  let pluginsDetail = `HTTP ${plugins.status}`
  try {
    if (plugins.status !== 200 || plugins.challenge || !plugins.body) {
      throw new Error(pluginsDetail + (plugins.challenge ? ' Managed Challenge' : ''))
    }
    const body = plugins.body
    if (!Array.isArray(body.packages)) throw new Error('packages missing')
    if (!body.meta || typeof body.meta !== 'object') throw new Error('meta missing')
    if (typeof body.meta.total !== 'number') throw new Error('meta.total missing')
    if (body.packages.length === 0) throw new Error('packages empty')
    body.packages.forEach(assertPackageRow)
    const withMethods = body.packages.filter((p) => Array.isArray(p.installMethods))
    if (withMethods.length === 0) {
      throw new Error('no package exposed installMethods')
    }
    pluginsOk = true
    pluginsDetail = `packages=${body.packages.length} meta.total=${body.meta.total} installMethods=${withMethods.length}`
  } catch (error) {
    pluginsDetail = error instanceof Error ? error.message : String(error)
  }
  record('plugins-packages-meta-installMethods', pluginsOk, pluginsDetail)

  const qHit = await getJson('/api/v1/plugins?q=crosstalk')
  record(
    'plugins-q-hit',
    qHit.status === 200
      && !qHit.challenge
      && Array.isArray(qHit.body?.packages)
      && qHit.body.packages.length >= 1
      && qHit.body.packages.every((p) =>
        JSON.stringify(p).toLowerCase().includes('crosstalk'),
      )
      && qHit.body.meta?.total === qHit.body.packages.length,
    `n=${qHit.body?.packages?.length ?? 'n/a'} meta.total=${qHit.body?.meta?.total ?? 'n/a'}`,
  )

  const qMiss = await getJson('/api/v1/plugins?q=zzzz-no-match-company-store-live')
  record(
    'plugins-q-miss',
    qMiss.status === 200
      && !qMiss.challenge
      && Array.isArray(qMiss.body?.packages)
      && qMiss.body.packages.length === 0
      && qMiss.body.meta?.total === 0,
    `n=${qMiss.body?.packages?.length ?? 'n/a'}`,
  )

  const search1 = await getJson('/api/v1/plugins/search?q=dsh&page=1&limit=2')
  const search2 = await getJson('/api/v1/plugins/search?q=dsh&page=2&limit=2')
  const searchOk =
    search1.status === 200
    && search2.status === 200
    && !search1.challenge
    && !search2.challenge
    && Array.isArray(search1.body?.results)
    && Array.isArray(search2.body?.results)
    && search1.body.page === 1
    && search1.body.limit === 2
    && typeof search1.body.total === 'number'
    && search1.body.total >= 2
    && search1.body.results.length === 2
    && search2.body.page === 2
    && search2.body.results.length >= 1
    && search1.body.results[0]?.id !== search2.body.results[0]?.id
  record(
    'search-pagination',
    searchOk,
    `p1=${search1.body?.results?.length ?? 'n/a'} p2=${search2.body?.results?.length ?? 'n/a'} total=${search1.body?.total ?? 'n/a'}`,
  )

  pinRefuseCheck()

  const allPass = checks.every((c) => c.pass)
  const pluginsBodyDigest = plugins.text
    ? createHash('sha256').update(plugins.text).digest('hex').slice(0, 16)
    : null

  const summary = {
    capturedAt: new Date().toISOString(),
    kind: 'company-store-live-smoke',
    origin: rawOrigin,
    durable,
    pinAllowed,
    m1Complete: durable && allPass,
    goalComplete: false,
    note: durable
      ? 'Durable HTTPS origin smoke. Still requires pin:company-store-origin apply + desktop PR update for Stage 2 complete.'
      : 'Interim/local origin only. Pin script refuses trycloudflare/localhost. Goal remains OPEN.',
    anonymousGet: true,
    managedChallenge: Boolean(
      health.challenge || plugins.challenge || qHit.challenge || search1.challenge,
    ),
    checks,
    health: health.body,
    plugins: plugins.body
      ? {
          packageCount: plugins.body.packages.length,
          keys: Object.keys(plugins.body).sort(),
          meta: plugins.body.meta,
          sampleNames: plugins.body.packages.slice(0, 5).map((p) => p.name),
          sampleHasInstallMethods: plugins.body.packages
            .slice(0, 5)
            .map((p) => Array.isArray(p.installMethods)),
        }
      : null,
    pluginsBodyDigest,
    qHit: qHit.body
      ? { packageCount: qHit.body.packages.length, meta: qHit.body.meta }
      : null,
    searchPage1: search1.body
      ? {
          resultCount: search1.body.results.length,
          page: search1.body.page,
          limit: search1.body.limit,
          total: search1.body.total,
          totalPages: search1.body.totalPages,
          names: search1.body.results.map((r) => r.name),
        }
      : null,
    searchPage2: search2.body
      ? {
          resultCount: search2.body.results.length,
          page: search2.body.page,
          names: search2.body.results.map((r) => r.name),
        }
      : null,
    httpStatus: {
      health: health.status,
      plugins: plugins.status,
      qHit: qHit.status,
      qMiss: qMiss.status,
      searchPage1: search1.status,
      searchPage2: search2.status,
    },
  }

  writeEvidence(summary)

  if (allPass) {
    ok(`PASS — ${checks.length}/${checks.length} checks (durable=${durable})`)
  } else {
    fail(`${checks.filter((c) => !c.pass).length} check(s) failed`)
  }
}

await main()
