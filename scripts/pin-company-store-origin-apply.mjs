#!/usr/bin/env node
/**
 * Apply COMPANY_STORE placeholder pin edits in a desktop checkout.
 * Invoked by scripts/pin-company-store-origin.sh --apply.
 *
 * Args: <desktopRoot> <endpoint> <hostname>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [root, endpoint, host] = process.argv.slice(2)
if (!root || !endpoint || !host) {
  console.error('usage: pin-company-store-origin-apply.mjs <desktopRoot> <endpoint> <hostname>')
  process.exit(2)
}

const PLACEHOLDER_HOST = 'plugins.company.example'
const adapterRel = 'dsh-community-market/src/adapters/company-store.ts'
const specRel = 'dsh-community-market/tests/company-store-adapter.spec.ts'
const swapRel = 'dsh-community-market/docs/company-store-endpoint-swap.md'

const adapterPath = join(root, adapterRel)
const specPath = join(root, specRel)
const swapPath = join(root, swapRel)

if (!existsSync(adapterPath)) {
  console.error(`missing ${adapterPath}`)
  process.exit(1)
}
if (!existsSync(specPath)) {
  console.error(`missing ${specPath}`)
  process.exit(1)
}

let adapter = readFileSync(adapterPath, 'utf8')
const nextAdapter = adapter
  .replace(
    /export const COMPANY_STORE_PLACEHOLDER_ENDPOINT\s*=\s*\n?\s*['"][^'"]+['"]/,
    `export const COMPANY_STORE_PLACEHOLDER_ENDPOINT =\n  '${endpoint}'`,
  )
  .replace(
    /export const COMPANY_STORE_PLACEHOLDER_HOSTNAME\s*=\s*['"][^'"]+['"]/,
    `export const COMPANY_STORE_PLACEHOLDER_HOSTNAME = '${host}'`,
  )
if (nextAdapter === adapter) {
  console.error('adapter: PLACEHOLDER constants not replaced (already pinned or unexpected format)')
  process.exit(1)
}
if (!nextAdapter.includes(endpoint) || !nextAdapter.includes(`'${host}'`)) {
  console.error('adapter: expected endpoint/host missing after replace')
  process.exit(1)
}
writeFileSync(adapterPath, nextAdapter)
console.log(`Wrote ${adapterRel}`)

let spec = readFileSync(specPath, 'utf8')
const hardcoded = /expect\(COMPANY_STORE_HOSTNAME\)\.toBe\(['"]plugins\.company\.example['"]\)/
if (hardcoded.test(spec)) {
  spec = spec.replace(hardcoded, `expect(COMPANY_STORE_HOSTNAME).toBe('${host}')`)
  writeFileSync(specPath, spec)
  console.log(`Wrote ${specRel}`)
} else if (
  spec.includes(`toBe('${host}')`)
  || spec.includes(`toBe("${host}")`)
  || /expect\(COMPANY_STORE_HOSTNAME\)\.toBe\(COMPANY_STORE_PLACEHOLDER_HOSTNAME\)/.test(spec)
) {
  console.log(`${specRel}: hostname assertion already aligned`)
} else {
  console.warn(`${specRel}: hardcoded ${PLACEHOLDER_HOST} assertion not found — check manually`)
}

if (existsSync(swapPath)) {
  let swap = readFileSync(swapPath, 'utf8')
  const next = swap
    .replace(/COMPANY_STORE_ENDPOINT = https:\/\/\S+/g, `COMPANY_STORE_ENDPOINT = ${endpoint}`)
    .replace(/COMPANY_STORE_HOSTNAME = \S+/g, `COMPANY_STORE_HOSTNAME = ${host}`)
  if (next !== swap) {
    writeFileSync(swapPath, next)
    console.log(`Wrote ${swapRel}`)
  } else {
    console.log(`${swapRel}: no placeholder lines matched (ok)`)
  }
}
