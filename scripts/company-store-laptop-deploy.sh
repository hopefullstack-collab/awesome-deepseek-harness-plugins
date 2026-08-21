#!/usr/bin/env bash
# One-command durable Company Store deploy for a laptop with wrangler logged in.
#
# Intended for maintainers (local Cloudflare session). Not for cloud-agent
# device-login polls — if whoami fails, stop and run `wrangler login` on your
# machine, then re-run this script.
#
# Default path: create D1/KV when placeholders remain → strip *.company.example
# routes for workers.dev → put minimum secrets → remote migrate → deploy →
# curl anonymous /api/v1/health and /api/v1/plugins → print desktop pin steps.
#
# Usage (repo root, after npm ci):
#   ./scripts/company-store-laptop-deploy.sh
#   npm run deploy:company-store-laptop
#   ./scripts/company-store-laptop-deploy.sh --check-only   # plan only (still needs whoami)
#   ./scripts/company-store-laptop-deploy.sh --print-edits-only
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_ROOT="${STORE_ROOT}/apps/web"
WRANGLER_JSONC="${WEB_ROOT}/wrangler.jsonc"
WRANGLER_BACKUP=""

WORKERS_DEV=1
CREATE_RESOURCES=1
APPLY_MIGRATIONS=1
PUT_SECRETS=1
CHECK_ONLY=0
PRINT_EDITS_ONLY=0
SKIP_BUILD=0
BASE_URL_OVERRIDE=""
D1_NAME="company-store-catalog"
KV_TITLE="CATALOG_CACHE"

usage() {
  cat <<'EOF'
Company Store laptop deploy (requires wrangler login on THIS machine).

Usage:
  ./scripts/company-store-laptop-deploy.sh
  npm run deploy:company-store-laptop

Options:
  --check-only          Verify whoami + print plan; do not create/migrate/deploy
  --print-edits-only    Print exact wrangler.jsonc edits; exit 0 (no CF calls)
  --no-workers-dev      Do not strip routes[] (use when real custom domains are set)
  --no-create           Do not create D1/KV; require non-zero ids already present
  --no-migrate          Skip remote D1 migrations
  --no-secrets          Skip wrangler secret put
  --skip-build          Skip npm run build / predeploy (use only if dist is fresh)
  --base-url URL        Override public origin for post-deploy curls
  --d1-name NAME        D1 database name (default: company-store-catalog)
  --kv-title TITLE      KV namespace title (default: CATALOG_CACHE)
  -h, --help            Show help

Env (optional):
  INSTALL_CLIENT_HASH_SECRET   If unset, generated with openssl and uploaded
  CATALOG_SYNC_TOKEN           If unset, generated with openssl and uploaded
  GITHUB_TOKEN / GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET
                               Uploaded when set; otherwise skipped
EOF
}

log() { printf 'company-store-laptop-deploy: %s\n' "$*"; }
err() { printf 'company-store-laptop-deploy: ERROR — %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only) CHECK_ONLY=1; shift ;;
    --print-edits-only) PRINT_EDITS_ONLY=1; shift ;;
    --no-workers-dev) WORKERS_DEV=0; shift ;;
    --no-create) CREATE_RESOURCES=0; shift ;;
    --no-migrate) APPLY_MIGRATIONS=0; shift ;;
    --no-secrets) PUT_SECRETS=0; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --base-url) BASE_URL_OVERRIDE="${2:?}"; shift 2 ;;
    --d1-name) D1_NAME="${2:?}"; shift 2 ;;
    --kv-title) KV_TITLE="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

cd "${STORE_ROOT}"

[[ -f "${WRANGLER_JSONC}" ]] || die "missing ${WRANGLER_JSONC}"
[[ -f "${STORE_ROOT}/package.json" ]] || die "run from Store repo root"

ZERO_D1='00000000-0000-0000-0000-000000000000'
ZERO_KV='00000000000000000000000000000000'

has_zero_d1() {
  grep -Eq "\"database_id\"[[:space:]]*:[[:space:]]*\"${ZERO_D1}\"" "${WRANGLER_JSONC}"
}

has_zero_kv() {
  grep -Eq "\"id\"[[:space:]]*:[[:space:]]*\"${ZERO_KV}\"" "${WRANGLER_JSONC}"
}

has_placeholder_routes() {
  grep -q 'plugins.company.example' "${WRANGLER_JSONC}"
}

print_exact_edits() {
  cat <<EOF

=== Exact wrangler.jsonc edits (apps/web/wrangler.jsonc) ===

1) D1 — replace all-zero database_id after:
     cd apps/web && npx wrangler d1 create ${D1_NAME}
   Set:
     "database_id": "<printed-uuid>"

2) KV — replace all-zero id after:
     cd apps/web && npx wrangler kv namespace create ${KV_TITLE}
   Set (under kv_namespaces / CATALOG_CACHE):
     "id": "<printed-32-hex>"

3) First workers.dev land — delete or comment out the entire "routes": [ ... ],
   block (placeholder plugins.company.example is not a real zone). Keep
   TOPIC_DISCOVERY_ENABLED "0". Restore three routes only when real DNS exists.

4) Secrets (from apps/web):
     openssl rand -hex 32   # INSTALL_CLIENT_HASH_SECRET
     openssl rand -hex 32   # CATALOG_SYNC_TOKEN
     printf '%s' '<value>' | npx wrangler secret put INSTALL_CLIENT_HASH_SECRET
     printf '%s' '<value>' | npx wrangler secret put CATALOG_SYNC_TOKEN

5) Then:
     npm run db:migrate:remote --workspace @dsh-1024store/web
     npm run deploy

Or re-run: npm run deploy:company-store-laptop
EOF
}

if [[ "${PRINT_EDITS_ONLY}" -eq 1 ]]; then
  print_exact_edits
  exit 0
fi

require_wrangler_auth() {
  log "Checking Cloudflare auth (wrangler whoami)…"
  local out
  if ! out="$(cd "${WEB_ROOT}" && npx wrangler whoami 2>&1)"; then
    err "wrangler whoami failed."
    err "This script expects an interactive Cloudflare session on YOUR laptop."
    err "Run:  npx wrangler login"
    err "Then:  npx wrangler whoami   # confirm company account"
    err "Then re-run:  npm run deploy:company-store-laptop"
    err "Do not start long device-login polls in cloud agents — deploy from local CF login."
    printf '%s\n' "${out}" >&2
    exit 1
  fi
  if printf '%s' "${out}" | grep -qiE 'not authenticated|Please run `?wrangler login`?'; then
    err "Cloudflare session missing (wrangler whoami → not authenticated)."
    err "On your laptop (browser login available):"
    err "  npx wrangler login"
    err "  npx wrangler whoami"
    err "  npm run deploy:company-store-laptop"
    err "Cloud agents should not poll device codes for this — local-first is the unblock."
    printf '%s\n' "${out}" >&2
    exit 1
  fi
  printf '%s\n' "${out}"
  log "whoami OK"
}

backup_wrangler() {
  WRANGLER_BACKUP="${WRANGLER_JSONC}.laptop-deploy.bak.$(date +%Y%m%d-%H%M%S)"
  cp "${WRANGLER_JSONC}" "${WRANGLER_BACKUP}"
  log "backed up wrangler.jsonc → ${WRANGLER_BACKUP}"
}

set_d1_id() {
  local id="$1"
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const id = process.argv[2];
    let text = fs.readFileSync(path, "utf8");
    const next = text.replace(
      /("database_id"\s*:\s*)"00000000-0000-0000-0000-000000000000"/,
      `$1"${id}"`,
    );
    if (next === text) throw new Error("could not replace zero D1 database_id");
    fs.writeFileSync(path, next);
  ' "${WRANGLER_JSONC}" "${id}"
}

set_kv_id() {
  local id="$1"
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const id = process.argv[2];
    let text = fs.readFileSync(path, "utf8");
    const next = text.replace(
      /("id"\s*:\s*)"00000000000000000000000000000000"/,
      `$1"${id}"`,
    );
    if (next === text) throw new Error("could not replace zero KV id");
    fs.writeFileSync(path, next);
  ' "${WRANGLER_JSONC}" "${id}"
}

strip_placeholder_routes() {
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    let text = fs.readFileSync(path, "utf8");
    if (!text.includes("plugins.company.example")) {
      console.log("routes do not contain plugins.company.example — leave unchanged");
      process.exit(0);
    }
    const stripped = text.replace(/\n\s*"routes"\s*:\s*\[[\s\S]*?\],\n/, "\n");
    if (stripped === text) {
      console.error("Could not locate routes[] block to strip");
      process.exit(2);
    }
    fs.writeFileSync(path, stripped);
    console.log("Removed placeholder routes[] for workers.dev-only deploy");
  ' "${WRANGLER_JSONC}"
}

refuse_zero_ids() {
  if has_zero_d1; then
    die "D1 database_id is still ${ZERO_D1}. Re-run without --no-create, or paste a real id (see --print-edits-only)."
  fi
  if has_zero_kv; then
    die "KV id is still ${ZERO_KV}. Re-run without --no-create, or paste a real id (see --print-edits-only)."
  fi
}

create_resources_if_needed() {
  local out m
  if has_zero_d1; then
    if [[ "${CREATE_RESOURCES}" -ne 1 ]]; then
      die "D1 id is still zero and --no-create was set"
    fi
    log "Creating D1 database ${D1_NAME}…"
    out="$(cd "${WEB_ROOT}" && npx wrangler d1 create "${D1_NAME}")"
    printf '%s\n' "${out}"
    m="$(printf '%s' "${out}" | grep -Eo '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1 || true)"
    [[ -n "${m}" ]] || die "Could not parse D1 database_id from wrangler output"
    set_d1_id "${m}"
    log "Wrote D1 database_id=${m} into wrangler.jsonc (commit or keep local)"
  else
    log "D1 database_id already set — skip create"
  fi

  if has_zero_kv; then
    if [[ "${CREATE_RESOURCES}" -ne 1 ]]; then
      die "KV id is still zero and --no-create was set"
    fi
    log "Creating KV namespace ${KV_TITLE}…"
    out="$(cd "${WEB_ROOT}" && npx wrangler kv namespace create "${KV_TITLE}")"
    printf '%s\n' "${out}"
    m="$(printf '%s' "${out}" | grep -Eo '[0-9a-fA-F]{32}' | head -1 || true)"
    [[ -n "${m}" ]] || die "Could not parse KV id from wrangler output"
    set_kv_id "${m}"
    log "Wrote KV id=${m} into wrangler.jsonc (commit or keep local)"
  else
    log "KV id already set — skip create"
  fi
}

maybe_strip_routes() {
  if [[ "${WORKERS_DEV}" -ne 1 ]]; then
    log "--no-workers-dev: leaving routes[] unchanged"
    if has_placeholder_routes; then
      err "WARNING: wrangler.jsonc still lists plugins.company.example — deploy will fail until you strip routes or bind real DNS."
      print_exact_edits
    fi
    return 0
  fi
  if has_placeholder_routes; then
    log "Stripping placeholder custom_domain routes for workers.dev…"
    strip_placeholder_routes
  else
    # Auto-strip too risky when routes look real / already removed.
    log "No plugins.company.example routes found — not auto-editing routes[]"
    if grep -Eq '"routes"[[:space:]]*:' "${WRANGLER_JSONC}"; then
      log "routes[] present without .example host — assuming intentional custom domains"
    fi
  fi
}

put_worker_secrets() {
  local install_secret sync_token
  install_secret="${INSTALL_CLIENT_HASH_SECRET:-}"
  sync_token="${CATALOG_SYNC_TOKEN:-}"
  if [[ -z "${install_secret}" ]]; then
    install_secret="$(openssl rand -hex 32)"
    log "Generated INSTALL_CLIENT_HASH_SECRET (not printed; uploaded to Worker)"
  fi
  if [[ -z "${sync_token}" ]]; then
    sync_token="$(openssl rand -hex 32)"
    log "Generated CATALOG_SYNC_TOKEN"
  fi
  # Persist sync token under gitignored .env.* so the operator can sync catalog.
  local secrets_file="${WEB_ROOT}/.env.laptop-deploy"
  umask 077
  cat > "${secrets_file}" <<EOF
# Generated by company-store-laptop-deploy.sh — DO NOT COMMIT (.env.* is gitignored)
# $(date -u +%Y-%m-%dT%H:%M:%SZ)
INSTALL_CLIENT_HASH_SECRET=${install_secret}
CATALOG_SYNC_TOKEN=${sync_token}
EOF
  log "Wrote secrets to ${secrets_file} (gitignored)"

  (
    cd "${WEB_ROOT}"
    printf '%s' "${install_secret}" | npx wrangler secret put INSTALL_CLIENT_HASH_SECRET
    printf '%s' "${sync_token}" | npx wrangler secret put CATALOG_SYNC_TOKEN
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
      printf '%s' "${GITHUB_TOKEN}" | npx wrangler secret put GITHUB_TOKEN
    else
      log "skip GITHUB_TOKEN (env unset)"
    fi
    if [[ -n "${GITHUB_OAUTH_CLIENT_ID:-}" ]]; then
      printf '%s' "${GITHUB_OAUTH_CLIENT_ID}" | npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
    else
      log "skip GITHUB_OAUTH_CLIENT_ID (env unset)"
    fi
    if [[ -n "${GITHUB_OAUTH_CLIENT_SECRET:-}" ]]; then
      printf '%s' "${GITHUB_OAUTH_CLIENT_SECRET}" | npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
    else
      log "skip GITHUB_OAUTH_CLIENT_SECRET (env unset)"
    fi
  )
  # Export for later sync hint
  export CATALOG_SYNC_TOKEN="${sync_token}"
}

parse_workers_dev_url() {
  local deploy_log="$1"
  # Prefer company-store.<subdomain>.workers.dev
  local url
  url="$(printf '%s' "${deploy_log}" | grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1 || true)"
  if [[ -n "${url}" ]]; then
    printf '%s' "${url}"
    return 0
  fi
  return 1
}

verify_anonymous() {
  local apex="$1"
  local health plugins
  log "GET ${apex}/api/v1/health"
  health="$(curl -sS --max-time 30 "${apex}/api/v1/health")"
  printf '%s\n' "${health}"
  printf '%s' "${health}" | grep -q '"status"' || die "health response missing status"
  log "GET ${apex}/api/v1/plugins?limit=1"
  plugins="$(curl -sS --max-time 60 "${apex}/api/v1/plugins?limit=1")"
  printf '%s\n' "${plugins}" | head -c 2000
  printf '\n'
  printf '%s' "${plugins}" | grep -q '"packages"' || die "plugins response missing packages"
  printf '%s' "${plugins}" | grep -q '"meta"' || die "plugins response missing meta"
  log "Anonymous HTTPS Market wire shape OK (packages + meta present)"
}

print_pin_next_steps() {
  local apex="$1"
  local host
  host="$(printf '%s' "${apex}" | sed -E 's#^https?://##; s#/.*##')"
  cat <<EOF

========================================================================
PUBLIC ORIGIN (durable workers.dev or apex):
  ${apex}

Anonymous checks:
  curl -sS '${apex}/api/v1/health'
  curl -sS '${apex}/api/v1/plugins?limit=1' | jq 'keys, .meta'

Optional catalog sync (token in apps/web/.env.laptop-deploy):
  set -a && source apps/web/.env.laptop-deploy && set +a
  node scripts/company-fork-e2e-install-check.mjs --base-url '${apex}' --sync

========================================================================
PASTE ORIGIN BACK (or pin yourself) — required for Stage 2 / goal close

1) Preferred — one-shot pin helper (prints exact desktop PR #19 edits):

     COMPANY_STORE_ORIGIN='${apex}' npm run pin:company-store-origin -- --verify

   Apply into a local desktop checkout (cursor/company-store-builtin-cb2c):

     COMPANY_STORE_ORIGIN='${apex}' npm run pin:company-store-origin -- \\
       --apply --verify --desktop-path /path/to/deepseek-harness-desktop

2) Or paste this origin into the Store cloud agent / PR #1 thread so it can
   pin desktop PR #19 (hopefullstack-collab/deepseek-harness-desktop#19).

EXACT constants (also printed by the pin script):
  COMPANY_STORE_PLACEHOLDER_ENDPOINT = '${apex}/api/v1/plugins'
  COMPANY_STORE_PLACEHOLDER_HOSTNAME = '${host}'
  (resolved COMPANY_STORE_ENDPOINT / HOSTNAME when local env unset)

Do NOT pin trycloudflare or localhost into production constants.
Follow dsh-community-market/docs/company-store-endpoint-swap.md
Maintainer Stage 2 apply from this Store repo:
  npm run apply:company-store-stage2

If wrangler.jsonc was edited locally (D1/KV ids, stripped routes), either:
  - keep those ids as repo vars / commit intentionally, or
  - restore from backup: ${WRANGLER_BACKUP:-<none>}
========================================================================
EOF
}

# --- main ---

require_wrangler_auth

log "Plan:"
log "  create_resources=${CREATE_RESOURCES} workers_dev=${WORKERS_DEV} migrate=${APPLY_MIGRATIONS} secrets=${PUT_SECRETS}"
log "  wrangler=${WRANGLER_JSONC}"
if has_zero_d1; then log "  D1 id: PLACEHOLDER (will create)"; else log "  D1 id: set"; fi
if has_zero_kv; then log "  KV id: PLACEHOLDER (will create)"; else log "  KV id: set"; fi
if has_placeholder_routes; then log "  routes: placeholder .example (will strip if workers_dev)"; else log "  routes: no .example placeholder"; fi

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  log "CHECK-ONLY — stopping before create/migrate/deploy"
  print_exact_edits
  log "PASS — auth present; re-run without --check-only to deploy"
  exit 0
fi

backup_wrangler
create_resources_if_needed
maybe_strip_routes
refuse_zero_ids

if [[ "${PUT_SECRETS}" -eq 1 ]]; then
  # Secrets can be uploaded after first deploy for a brand-new Worker; wrangler
  # secret put needs the Worker to exist. We put secrets after deploy below.
  :
fi

if [[ "${SKIP_BUILD}" -eq 1 ]]; then
  log "Skipping build (--skip-build)"
else
  log "Building (npm run build)…"
  npm run build
fi

if [[ "${APPLY_MIGRATIONS}" -eq 1 ]]; then
  log "Remote D1 migrations…"
  # Empty DB export may fail on first land — ignore.
  (cd "${WEB_ROOT}" && npx wrangler d1 export CATALOG_DB --remote \
    --output="catalog-backup-$(date +%Y%m%d-%H%M).sql") || log "D1 export skipped/failed (ok on first empty DB)"
  npm run db:migrate:remote --workspace @dsh-1024store/web
fi

log "Deploying Worker…"
DEPLOY_LOG="$(mktemp)"
set +e
npm run deploy 2>&1 | tee "${DEPLOY_LOG}"
DEPLOY_EC=${PIPESTATUS[0]}
set -e
[[ "${DEPLOY_EC}" -eq 0 ]] || die "npm run deploy failed (exit ${DEPLOY_EC})"

APEX="${BASE_URL_OVERRIDE:-}"
if [[ -z "${APEX}" ]]; then
  if APEX="$(parse_workers_dev_url "$(cat "${DEPLOY_LOG}")")"; then
    log "Parsed workers.dev origin: ${APEX}"
  else
    err "Could not parse *.workers.dev URL from deploy output."
    err "Pass --base-url https://company-store.<subdomain>.workers.dev and re-verify curls."
    APEX=""
  fi
fi

if [[ "${PUT_SECRETS}" -eq 1 ]]; then
  log "Uploading Worker secrets…"
  put_worker_secrets
fi

if [[ -n "${APEX}" ]]; then
  verify_anonymous "${APEX}"
  print_pin_next_steps "${APEX}"
else
  print_exact_edits
  die "Deploy finished but public origin unknown — set --base-url and curl health/plugins manually"
fi

log "DONE — durable public HTTPS verified; pin COMPANY_STORE_* next"
