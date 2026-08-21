/**
 * Company-fork site identity and catalog policy.
 *
 * Placeholders until the real public domain and display names are known.
 * Do not point these at intranet IPs — Market consumers need public HTTPS.
 */

/** TODO: replace with the company public apex hostname once DNS is ready. */
export const DEFAULT_SITE_ORIGIN = 'https://plugins.company.example'

/** TODO: finalize EN display name for the company Market source / site chrome. */
export const DEFAULT_SITE_NAME = 'Company Store'

/** TODO: finalize ZH display name (AI Buddy disclaimer / Market chrome). */
export const DEFAULT_SITE_NAME_ZH = '公司插件目录'

/** Public developer-API host (allow-listed paths only). */
export const DEFAULT_PUBLIC_API_HOST = 'api.plugins.company.example'

/** Bound www host that permanently redirects to the apex site. */
export const DEFAULT_WWW_HOST = 'www.plugins.company.example'

/**
 * Built-in key for AI Buddy `dsh-community-market` (NEW key — do not reuse
 * or replace `dsh-1024store`). Implemented in the AI Buddy repo when available.
 */
export const COMPANY_MARKET_BUILTIN_KEY = 'company-store'

/**
 * GitHub topic whole-network scan. Company fork default is OFF so the Market
 * catalog is company-reviewed `catalog/plugins/*.json` entries only.
 *
 * Set wrangler var `TOPIC_DISCOVERY_ENABLED` to `1` / `true` to re-enable.
 */
export function isTopicDiscoveryEnabled(
  env?: { TOPIC_DISCOVERY_ENABLED?: string } | null,
): boolean {
  const raw = env?.TOPIC_DISCOVERY_ENABLED
  if (raw === undefined || raw === null || raw === '') return false
  const normalized = raw.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

/** SQL predicate fragment matching which plugins appear in the published snapshot. */
export function publishedPluginPredicate(includeTopicDiscoveries: boolean): string {
  if (includeTopicDiscoveries) {
    return `(p.from_pr = 1 OR (r.from_topic = 1 AND p.validation_status = 'accepted'))`
  }
  return `(p.from_pr = 1)`
}
