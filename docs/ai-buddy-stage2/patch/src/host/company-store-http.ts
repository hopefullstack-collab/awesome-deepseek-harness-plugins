import http from 'node:http'
import {
  COMPANY_STORE_ADAPTER_ID,
  COMPANY_STORE_HOSTNAME,
  COMPANY_STORE_LOCAL_DEV,
} from '../adapters/company-store.js'
import type { CatalogHttpClient, CatalogHttpResponse } from '../contracts/types.js'
import {
  CatalogNetworkError,
  createCachedCatalogHttpClient,
  createRestrictedHttpClient,
} from '../network/restricted-http.js'

const MAX_COMPANY_STORE_BODY_BYTES = 16 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 8_000
const FIRST_BYTE_TIMEOUT_MS = 12_000
const TOTAL_TIMEOUT_MS = 30_000

/**
 * Dev-only HTTP client for `http://127.0.0.1` when
 * `DSH_COMPANY_STORE_LOCAL_ENDPOINT` is set. Production path keeps the
 * restricted HTTPS client (loopback / plain HTTP blocked).
 */
function createCompanyStoreLoopbackHttpClient(): CatalogHttpClient {
  return {
    async getJson(start, signal, policy = {}): Promise<CatalogHttpResponse> {
      if (signal.aborted) throw new CatalogNetworkError('timeout')
      let url: URL
      try {
        url = new URL(start)
      } catch {
        throw new CatalogNetworkError('invalid-url')
      }
      if (
        url.protocol !== 'http:'
        || url.hostname !== '127.0.0.1'
        || url.username
        || url.password
        || url.hash
      ) {
        throw new CatalogNetworkError('invalid-url')
      }
      if (policy.allowedOrigin !== undefined && url.origin !== policy.allowedOrigin) {
        throw new CatalogNetworkError('redirect')
      }

      const totalController = new AbortController()
      const onAbort = () => {
        totalController.abort(signal.reason ?? new CatalogNetworkError('timeout'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      const totalTimer = setTimeout(() => {
        totalController.abort(new CatalogNetworkError('timeout'))
      }, TOTAL_TIMEOUT_MS)

      try {
        const body = await new Promise<Buffer>((resolve, reject) => {
          let settled = false
          let firstByteTimer: NodeJS.Timeout | undefined
          const finish = (callback: () => void) => {
            if (settled) return
            settled = true
            if (firstByteTimer !== undefined) clearTimeout(firstByteTimer)
            callback()
          }
          const request = http.request(
            url,
            {
              method: 'GET',
              headers: {
                accept: 'application/json',
                'accept-encoding': 'identity',
                'user-agent': 'dsh-community-market/0.1-company-store-local',
              },
              timeout: CONNECT_TIMEOUT_MS,
            },
            response => {
              firstByteTimer = setTimeout(() => {
                request.destroy(new CatalogNetworkError('timeout'))
              }, FIRST_BYTE_TIMEOUT_MS)
              const status = response.statusCode ?? 0
              if (status < 200 || status >= 300) {
                response.resume()
                finish(() => reject(new CatalogNetworkError('http')))
                return
              }
              const contentType = response.headers['content-type'] ?? ''
              const encoding = response.headers['content-encoding']
              if (
                !/^(?:application\/json|application\/[^;]+\+json)(?:;|$)/iu.test(contentType)
                || (encoding !== undefined && encoding !== 'identity')
              ) {
                response.resume()
                finish(() => reject(new CatalogNetworkError('response')))
                return
              }
              const chunks: Buffer[] = []
              let size = 0
              response.on('data', (chunk: Buffer | string) => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                size += buffer.length
                if (size > MAX_COMPANY_STORE_BODY_BYTES) {
                  response.destroy(new CatalogNetworkError('response'))
                } else {
                  chunks.push(buffer)
                }
              })
              response.once('end', () => finish(() => resolve(Buffer.concat(chunks))))
              response.once('error', cause => finish(() => reject(cause)))
            },
          )
          const abortLocal = () => {
            request.destroy(new CatalogNetworkError('timeout'))
          }
          if (totalController.signal.aborted) abortLocal()
          else totalController.signal.addEventListener('abort', abortLocal, { once: true })
          request.once('error', cause => finish(() => reject(cause)))
          request.once('timeout', () => request.destroy(new CatalogNetworkError('timeout')))
          request.end()
        })

        let value: unknown
        try {
          value = JSON.parse(body.toString('utf8')) as unknown
        } catch {
          throw new CatalogNetworkError('response')
        }
        return { value, finalUrl: url.href }
      } finally {
        clearTimeout(totalTimer)
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

export const companyStoreHttpClient = createCachedCatalogHttpClient(
  COMPANY_STORE_LOCAL_DEV
    ? createCompanyStoreLoopbackHttpClient()
    : createRestrictedHttpClient({
        syntheticProxyHostnames: [COMPANY_STORE_HOSTNAME],
        maxBodyBytes: MAX_COMPANY_STORE_BODY_BYTES,
      }),
)

export { COMPANY_STORE_ADAPTER_ID, COMPANY_STORE_HOSTNAME, COMPANY_STORE_LOCAL_DEV }
