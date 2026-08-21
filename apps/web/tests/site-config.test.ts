import { describe, expect, it } from 'vitest'
import {
  COMPANY_MARKET_BUILTIN_KEY,
  DEFAULT_PUBLIC_API_HOST,
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_NAME_ZH,
  DEFAULT_SITE_ORIGIN,
  isTopicDiscoveryEnabled,
  publishedPluginPredicate,
} from '../worker/lib/site-config'

describe('site-config company fork defaults', () => {
  it('keeps topic discovery off unless explicitly enabled', () => {
    expect(isTopicDiscoveryEnabled()).toBe(false)
    expect(isTopicDiscoveryEnabled({})).toBe(false)
    expect(isTopicDiscoveryEnabled({ TOPIC_DISCOVERY_ENABLED: '0' })).toBe(false)
    expect(isTopicDiscoveryEnabled({ TOPIC_DISCOVERY_ENABLED: '1' })).toBe(true)
    expect(isTopicDiscoveryEnabled({ TOPIC_DISCOVERY_ENABLED: 'true' })).toBe(true)
  })

  it('publishes curated-only SQL when topic scan is off', () => {
    expect(publishedPluginPredicate(false)).toContain('from_pr = 1')
    expect(publishedPluginPredicate(false)).not.toContain('from_topic')
    expect(publishedPluginPredicate(true)).toContain('from_topic')
  })

  it('exposes company Market placeholders without colliding with dsh-1024store', () => {
    expect(COMPANY_MARKET_BUILTIN_KEY).toBe('company-store')
    expect(COMPANY_MARKET_BUILTIN_KEY).not.toBe('dsh-1024store')
    expect(DEFAULT_SITE_ORIGIN).toBe('https://plugins.company.example')
    expect(DEFAULT_PUBLIC_API_HOST).toBe('api.plugins.company.example')
    expect(DEFAULT_SITE_NAME).toBe('Company Store')
    expect(DEFAULT_SITE_NAME_ZH).toBe('公司插件目录')
  })
})
