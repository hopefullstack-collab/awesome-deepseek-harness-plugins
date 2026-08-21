/**
 * Snippet for dsh-community-market/src/catalog/service.ts
 *
 * 1. Import company-store constants + adapter beside dsh-1024store / dshfind.
 * 2. Append the company-store entry to BUILT_IN_PROVIDERS (do not remove others).
 * 3. Register companyStoreAdapter in the adapters Map.
 * 4. Keep partnership: true; do NOT select company-store by default (add-builtin
 *    still creates enabled: false — same as other built-ins).
 * 5. Never fall back to company-store when official dsh-1024store fails.
 */

import {
  COMPANY_STORE_ADAPTER_ID,
  COMPANY_STORE_ENDPOINT,
  COMPANY_STORE_KEY,
  COMPANY_STORE_PROVIDER_ID,
  companyStoreAdapter,
} from '../adapters/company-store.js'

// Inside BUILT_IN_PROVIDERS array, AFTER dshfind:
export const COMPANY_STORE_BUILT_IN = {
  key: COMPANY_STORE_KEY,
  name: 'Company Store',
  // ZH product disclaimer — also surface in UI when this source is selected.
  description: '公司目录，收录≠安全审核。需要用户明确添加并启用。',
  providerId: COMPANY_STORE_PROVIDER_ID,
  adapterId: COMPANY_STORE_ADAPTER_ID,
  endpoint: COMPANY_STORE_ENDPOINT,
  attribution: {
    name: '公司插件目录',
    url: 'https://plugins.company.example',
    notice: 'Company-reviewed catalog. Listing means inclusion only — not a security audit.',
  },
  partnership: true,
} as const

// adapters Map entry:
// [companyStoreAdapter.adapterId, companyStoreAdapter],

void COMPANY_STORE_BUILT_IN
void companyStoreAdapter
