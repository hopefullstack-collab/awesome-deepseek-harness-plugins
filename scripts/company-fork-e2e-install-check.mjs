#!/usr/bin/env node
/**
 * Stage 3 helper: verify a durable company Store HTTPS origin for Market e2e.
 *
 * Usage:
 *   node scripts/company-fork-e2e-install-check.mjs --base-url https://company-store.example.workers.dev
 *   node scripts/company-fork-e2e-install-check.mjs --base-url https://… --sync
 *
 * Env:
 *   CATALOG_SYNC_TOKEN  required with --sync
 *   COMPANY_STORE_BASE_URL  alternative to --base-url
 *
 * Does NOT treat trycloudflare / localhost as Stage 3 complete — prints a warning.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const samplesDir = join(root, 'docs/examples/curated-reviewed')

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const baseUrl = (arg('--base-url') || process.env.COMPANY_STORE_BASE_URL || '')
  .replace(/\/$/, '')
const doSync = process.argv.includes('--sync')

if (!baseUrl) {
  console.error('usage: node scripts/company-fork-e2e-install-check.mjs --base-url https://<durable-origin> [--sync]')
  process.exit(2)
}

const host = new URL(baseUrl).hostname
if (host.includes('trycloudflare.com') || host === '127.0.0.1' || host === 'localhost') {
  console.warn(`WARN: ${host} is not a durable M1/Stage 3 origin — evidence only; do not pin desktop COMPANY_STORE_*.`)
}

function fail(msg) {
  console.error(`e2e-install-check: FAIL — ${msg}`)
  process.exitCode = 1
}

function ok(msg) {
  console.log(`e2e-install-check: ${msg}`)
}

function loadSamples() {
  return [
    'anweat--dsh-restart.json',
    'jesse-njx--dsh-crosstalk.json',
    'awesome-dsh-plugin--dsh-find-plugin.json',
  ].map((name) => {
    const raw = JSON.parse(readFileSync(join(samplesDir, name), 'utf8'))
    return {
      id: raw.id,
      name: raw.name,
      repository: raw.repository,
      category: raw.category,
      description: { en: raw.description.en, zh: raw.description.zh },
      added: raw.added,
    }
  })
}

function isVerifiedNpm(method) {
  if (!method || typeof method !== 'object') return false
  const code = method.code
  return (
    method.kind === 'npm'
    && method.verification === 'verified'
    && (code === 'repository_backlink' || code === 'published_package')
    && method.requiresBuildAllowance === false
    && typeof method.spec === 'string'
    && typeof method.revision === 'string'
    && /^\d+\.\d+\.\d+/.test(method.revision)
  )
}

async function main() {
  const health = await fetch(`${baseUrl}/api/v1/health`)
  if (!health.ok) return fail(`health ${health.status}`)
  ok(`health ${JSON.stringify(await health.json())}`)

  const registry = await fetch(`${baseUrl}/api/v1/registry`)
  if (!registry.ok) return fail(`registry ${registry.status}`)
  const reg = await registry.json()
  if (reg.name !== 'dsh-1024store-catalog') {
    return fail(`registry name ${reg.name} (expected dsh-1024store-catalog)`)
  }
  ok('registry name dsh-1024store-catalog')

  if (doSync) {
    const token = process.env.CATALOG_SYNC_TOKEN
    if (!token || token.length < 32) {
      return fail('CATALOG_SYNC_TOKEN env (≥32 chars) required with --sync')
    }
    const syncRes = await fetch(`${baseUrl}/api/v1/catalog/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ entries: loadSamples() }),
    })
    const syncText = await syncRes.text()
    if (!syncRes.ok) return fail(`sync ${syncRes.status}: ${syncText.slice(0, 400)}`)
    ok(`sync ok (${syncRes.status})`)
  }

  const plugins = await fetch(`${baseUrl}/api/v1/plugins?limit=20`)
  if (!plugins.ok) return fail(`plugins ${plugins.status}`)
  const body = await plugins.json()
  if (!Array.isArray(body.packages) || !body.meta) {
    return fail('plugins body missing packages/meta')
  }
  ok(`packages=${body.packages.length} meta.total=${body.meta.total}`)

  let installable = 0
  let browseOnly = 0
  for (const pkg of body.packages) {
    const methods = Array.isArray(pkg.installMethods) ? pkg.installMethods : []
    const verified = methods.filter(isVerifiedNpm)
    if (verified.length === 1) installable += 1
    else browseOnly += 1
  }
  ok(`installable(verified npm)=${installable} browse-or-unverified=${browseOnly}`)
  if (installable === 0) {
    console.warn(
      'WARN: no Installable rows yet — run Store npm probe / publish snapshot against public npm, then re-check. Browse-only is valid interim evidence.',
    )
  }

  if (!process.exitCode) {
    ok(`PASS against ${baseUrl}`)
    ok('Next: pin desktop COMPANY_STORE_ENDPOINT/HOSTNAME to this durable origin (not trycloudflare).')
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err))
})
