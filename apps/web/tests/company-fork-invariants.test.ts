import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../worker/app'
import { PUBLIC_API_HOST, PUBLIC_API_PATHS, WWW_HOST } from '../worker/public-api'
import {
  COMPANY_MARKET_BUILTIN_KEY,
  DEFAULT_PUBLIC_API_HOST,
  DEFAULT_SITE_ORIGIN,
  DEFAULT_WWW_HOST,
  isTopicDiscoveryEnabled,
  publishedPluginPredicate,
} from '../worker/lib/site-config'
import { testCatalogResult } from './fixtures'

function contractApp() {
  return createApp({
    catalogLoader: vi.fn(async () => testCatalogResult()),
    clock: () => Date.parse('2026-08-16T08:00:30Z'),
  })
}

describe('company fork M1 invariants', () => {
  it('keeps wrangler custom domains aligned with site-config placeholders', () => {
    const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    // Strip // comments for a coarse parse of the routes block.
    const stripped = wrangler.replace(/^\s*\/\/.*$/gm, '')
    expect(stripped).toContain(`"pattern": "plugins.company.example"`)
    expect(stripped).toContain(`"pattern": "${DEFAULT_WWW_HOST}"`)
    expect(stripped).toContain(`"pattern": "${DEFAULT_PUBLIC_API_HOST}"`)
    expect(stripped).toContain('"TOPIC_DISCOVERY_ENABLED": "0"')
    expect(stripped).toMatch(/"crons"\s*:\s*\[\s*\]/)

    expect(new URL(DEFAULT_SITE_ORIGIN).hostname).toBe('plugins.company.example')
    expect(WWW_HOST).toBe(DEFAULT_WWW_HOST)
    expect(PUBLIC_API_HOST).toBe(DEFAULT_PUBLIC_API_HOST)
    expect(Object.keys(PUBLIC_API_PATHS).sort()).toEqual(['/v1/health', '/v1/plugins/search'])
  })

  it('defaults to curated-only publication and a distinct Market built-in key', () => {
    expect(isTopicDiscoveryEnabled({ TOPIC_DISCOVERY_ENABLED: '0' })).toBe(false)
    expect(publishedPluginPredicate(false)).toBe('(p.from_pr = 1)')
    expect(COMPANY_MARKET_BUILTIN_KEY).toBe('company-store')
  })

  it('preserves GET /api/v1/plugins wire shape for AI Buddy adapters', async () => {
    const registry = await contractApp().request('https://plugins.company.example/api/v1/registry')
    await expect(registry.json()).resolves.toMatchObject({ name: 'dsh-1024store-catalog' })

    const response = await contractApp().request('https://plugins.company.example/api/v1/plugins')
    expect(response.status).toBe(200)
    const body = await response.json() as {
      packages: Array<{
        id: string
        name: string
        owner: string
        url: string
        category: string
        description: { en: string; zh: string }
        install?: string
        installMethods?: unknown
      }>
      rankings: Record<string, unknown>
      categories: unknown[]
      meta: {
        total: number
        catalogTotal: number
        updated: string
        generatedAt: string
        revision: string
        source: string
        metricCoverage: number
      }
    }

    // Market adapters read packages + meta (not registry.name) from this route.
    expect(Array.isArray(body.packages)).toBe(true)
    expect(body.packages.length).toBeGreaterThan(0)
    expect(body.rankings).toMatchObject({
      stars: expect.any(Array),
      installs: expect.any(Array),
      newest: expect.any(Array),
    })
    expect(Array.isArray(body.categories)).toBe(true)
    expect(body.meta).toMatchObject({
      total: expect.any(Number),
      catalogTotal: expect.any(Number),
      updated: expect.any(String),
      generatedAt: expect.any(String),
      revision: expect.any(String),
      source: expect.any(String),
      metricCoverage: expect.any(Number),
    })

    const first = body.packages[0]!
    expect(first).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      owner: expect.any(String),
      url: expect.stringMatching(/^https:\/\/github\.com\//),
      category: expect.any(String),
      description: { en: expect.any(String), zh: expect.any(String) },
    })
    // List rows may omit heavy installMethods; presence is optional but when
    // present must be an array (AI Buddy treats missing as browse-only).
    if (first.installMethods !== undefined) {
      expect(Array.isArray(first.installMethods)).toBe(true)
    }
  })

  it('documents curated sample entries that validate against the plugin schema shape', () => {
    const samples = [
      'anweat--dsh-restart.json',
      'jesse-njx--dsh-crosstalk.json',
      'awesome-dsh-plugin--dsh-find-plugin.json',
    ]
    for (const file of samples) {
      const raw = readFileSync(
        new URL(`../../../docs/examples/curated-reviewed/${file}`, import.meta.url),
        'utf8',
      )
      const entry = JSON.parse(raw) as {
        $schema: string
        id: string
        name: string
        repository: string
        category: string
        description: { en: string; zh: string }
        added: string
      }
      expect(entry.$schema).toBe('../schema/plugin.schema.json')
      expect(entry.id).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/)
      expect(entry.repository).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)
      expect(entry.description.en.length).toBeGreaterThan(0)
      expect(entry.description.zh.length).toBeGreaterThan(0)
      expect(entry.added).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
