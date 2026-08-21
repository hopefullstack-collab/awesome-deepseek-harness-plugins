/**
 * Company Store built-in adapter for dsh-community-market.
 *
 * NEW key `company-store` — do not replace or retarget `dsh-1024store`.
 * Placeholder domain matches the company Store fork until DNS is real.
 *
 * Dev-only local override: set `DSH_COMPANY_STORE_LOCAL_ENDPOINT=1` (or an
 * explicit `http://127.0.0.1[:port]/api/v1/plugins` URL) on the Market host
 * process. Unset for normal / production runs. Never commit a localhost pin.
 */
import { createDsh1024StyleStoreAdapter } from './dsh-1024-style-store.js'

export const COMPANY_STORE_KEY = 'company-store'
export const COMPANY_STORE_PROVIDER_ID = 'com.company.store.catalog'
export const COMPANY_STORE_ADAPTER_ID = 'market.company-store-v1'

/** Committed production / release placeholder — swap only after durable HTTPS. */
export const COMPANY_STORE_PLACEHOLDER_ENDPOINT =
  'https://plugins.company.example/api/v1/plugins'
export const COMPANY_STORE_PLACEHOLDER_HOSTNAME = 'plugins.company.example'

const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:8787/api/v1/plugins'

export interface CompanyStoreTarget {
  readonly endpoint: string
  readonly hostname: string
  /** True only when `DSH_COMPANY_STORE_LOCAL_ENDPOINT` is set. */
  readonly localDev: boolean
}

/**
 * Resolve company-store endpoint/hostname.
 * Default (env unset): placeholder HTTPS apex.
 * Local e2e: `DSH_COMPANY_STORE_LOCAL_ENDPOINT=1` or `http://127.0.0.1…` only.
 */
export function resolveCompanyStoreTarget(
  env: NodeJS.ProcessEnv = process.env,
): CompanyStoreTarget {
  const raw = env.DSH_COMPANY_STORE_LOCAL_ENDPOINT?.trim()
  if (!raw) {
    return {
      endpoint: COMPANY_STORE_PLACEHOLDER_ENDPOINT,
      hostname: COMPANY_STORE_PLACEHOLDER_HOSTNAME,
      localDev: false,
    }
  }
  if (raw === '1' || raw === 'true') {
    return {
      endpoint: DEFAULT_LOCAL_ENDPOINT,
      hostname: '127.0.0.1',
      localDev: true,
    }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      'DSH_COMPANY_STORE_LOCAL_ENDPOINT must be "1", "true", or http://127.0.0.1[:port]/path',
    )
  }
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error(
      'DSH_COMPANY_STORE_LOCAL_ENDPOINT allows only http://127.0.0.1[:port]/path (no credentials)',
    )
  }
  const path = url.pathname === '/' || url.pathname === ''
    ? '/api/v1/plugins'
    : url.pathname
  return {
    endpoint: `http://127.0.0.1${url.port ? `:${url.port}` : ''}${path}`,
    hostname: '127.0.0.1',
    localDev: true,
  }
}

const resolved = resolveCompanyStoreTarget()

/** Placeholder — swap with the real public company Store apex before release. */
export const COMPANY_STORE_ENDPOINT = resolved.endpoint
export const COMPANY_STORE_HOSTNAME = resolved.hostname
/** True when host was started with the local-dev env override. */
export const COMPANY_STORE_LOCAL_DEV = resolved.localDev

export const companyStoreAdapter = createDsh1024StyleStoreAdapter({
  key: COMPANY_STORE_KEY,
  endpoint: COMPANY_STORE_ENDPOINT,
  hostname: COMPANY_STORE_HOSTNAME,
  providerId: COMPANY_STORE_PROVIDER_ID,
  adapterId: COMPANY_STORE_ADAPTER_ID,
  errorLabel: 'Company Store',
})
