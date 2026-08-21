/**
 * Snippet for dsh-community-market/src/host/routes.ts
 *
 * Pin a restricted HTTP client to the company hostname (same pattern as
 * DSH_1024STORE_HOSTNAME / DSHFIND_HOSTNAME). Pass it via adapterHttpClients
 * when constructing DefaultCatalogService.
 */

import {
  COMPANY_STORE_ADAPTER_ID,
  COMPANY_STORE_HOSTNAME,
} from '../adapters/company-store.js'

const MAX_COMPANY_STORE_BODY_BYTES = 16 * 1024 * 1024

// Beside dsh1024StoreHttpClient / dshfindHttpClient:
// const companyStoreHttpClient = createCachedCatalogHttpClient(
//   createRestrictedHttpClient({
//     syntheticProxyHostnames: [COMPANY_STORE_HOSTNAME],
//     maxBodyBytes: MAX_COMPANY_STORE_BODY_BYTES,
//   }),
// )
//
// adapterHttpClients: new Map([
//   [DSH_1024STORE_ADAPTER_ID, dsh1024StoreHttpClient],
//   [DSHFIND_ADAPTER_ID, dshfindHttpClient],
//   [COMPANY_STORE_ADAPTER_ID, companyStoreHttpClient],
// ])

void COMPANY_STORE_ADAPTER_ID
void COMPANY_STORE_HOSTNAME
void MAX_COMPANY_STORE_BODY_BYTES
