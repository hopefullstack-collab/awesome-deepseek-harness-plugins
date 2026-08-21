#!/usr/bin/env node
/**
 * Dry-run / static validation for the company-fork Cloudflare deploy workflow.
 * Does not call Cloudflare. Safe in CI without secrets.
 *
 * Usage: node scripts/company-fork-deploy-dry-run.mjs
 *        npm run check:company-deploy-workflow
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = join(root, '.github/workflows/company-fork-deploy.yml')
const readinessPath = join(root, '.github/workflows/company-fork-deploy-readiness.yml')

function fail(msg) {
  console.error(`company-fork-deploy-dry-run: FAIL — ${msg}`)
  process.exitCode = 1
}

function ok(msg) {
  console.log(`company-fork-deploy-dry-run: ${msg}`)
}

function mustInclude(text, needle, label) {
  if (!text.includes(needle)) fail(`${label}: missing ${JSON.stringify(needle)}`)
  else ok(`${label}: has ${JSON.stringify(needle)}`)
}

if (!existsSync(workflowPath)) fail(`missing ${workflowPath}`)
if (!existsSync(readinessPath)) fail(`missing ${readinessPath}`)

const deploy = readFileSync(workflowPath, 'utf8')
const ready = readFileSync(readinessPath, 'utf8')

mustInclude(deploy, 'CLOUDFLARE_API_TOKEN', 'deploy')
mustInclude(deploy, 'CLOUDFLARE_ACCOUNT_ID', 'deploy')
mustInclude(deploy, 'workflow_dispatch', 'deploy')
mustInclude(deploy, 'missing=true', 'deploy soft-skip gate')
mustInclude(deploy, 'refusing silent skip', 'deploy loud fail on dispatch')
mustInclude(deploy, 'create_resources', 'deploy')
mustInclude(deploy, 'workers_dev_only', 'deploy')
mustInclude(deploy, 'npm run deploy', 'deploy')
mustInclude(deploy, 'COMPANY_D1_DATABASE_ID', 'deploy')
mustInclude(deploy, 'COMPANY_KV_NAMESPACE_ID', 'deploy')
mustInclude(deploy, 'put_secret GITHUB_TOKEN', 'deploy worker secrets')
mustInclude(deploy, 'put_secret CATALOG_SYNC_TOKEN', 'deploy worker secrets')

mustInclude(ready, 'test:api-contract', 'readiness')
mustInclude(ready, 'company-fork-invariants.test.ts', 'readiness')
mustInclude(ready, 'smoke:company-plugins-api', 'readiness')

const laptopScript = join(root, 'scripts/company-store-laptop-deploy.sh')
if (!existsSync(laptopScript)) fail(`missing ${laptopScript}`)
else ok('laptop deploy script present')
const pinScript = join(root, 'scripts/pin-company-store-origin.sh')
const pinApply = join(root, 'scripts/pin-company-store-origin-apply.mjs')
if (!existsSync(pinScript)) fail(`missing ${pinScript}`)
else ok('pin-company-store-origin script present')
if (!existsSync(pinApply)) fail(`missing ${pinApply}`)
else ok('pin-company-store-origin-apply helper present')
const pkg = readFileSync(join(root, 'package.json'), 'utf8')
mustInclude(pkg, 'deploy:company-store-laptop', 'package.json')
mustInclude(pkg, 'pin:company-store-origin', 'package.json')
mustInclude(readFileSync(laptopScript, 'utf8'), 'wrangler whoami', 'laptop deploy')
mustInclude(readFileSync(laptopScript, 'utf8'), 'wrangler login', 'laptop deploy')
mustInclude(readFileSync(laptopScript, 'utf8'), 'COMPANY_STORE_ENDPOINT', 'laptop deploy pin hint')
mustInclude(readFileSync(laptopScript, 'utf8'), 'pin:company-store-origin', 'laptop deploy paste-back')
mustInclude(readFileSync(laptopScript, 'utf8'), 'PASTE ORIGIN BACK', 'laptop deploy paste-back')
mustInclude(readFileSync(pinScript, 'utf8'), 'COMPANY_STORE_PLACEHOLDER_ENDPOINT', 'pin script')
mustInclude(readFileSync(pinScript, 'utf8'), 'trycloudflare', 'pin script refuse')

// Soft-skip vs hard-fail contract: push may soft-skip; dispatch must hard-fail.
if (!/workflow_dispatch[\s\S]*exit 1/.test(deploy) && !deploy.includes('refusing silent skip')) {
  fail('deploy: expected hard-fail path for workflow_dispatch without secrets')
} else {
  ok('deploy: soft-skip (push) + hard-fail (dispatch) contract present')
}

if (!process.exitCode) {
  ok('PASS — workflow files look deploy-ready once CLOUDFLARE_* secrets exist')
  ok('Optional: actionlint .github/workflows/company-fork-deploy.yml')
}
