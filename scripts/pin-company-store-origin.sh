#!/usr/bin/env bash
# Pin desktop Stage 2 COMPANY_STORE_* placeholders to a durable public Store origin.
#
# Run AFTER durable HTTPS deploy (laptop script or Actions) proves anonymous
# GET /api/v1/plugins. Does NOT open dirty upstream desktop PRs.
#
# Usage (Store repo root):
#   COMPANY_STORE_ORIGIN=https://company-store.<subdomain>.workers.dev \
#     npm run pin:company-store-origin
#   COMPANY_STORE_ORIGIN=https://… ./scripts/pin-company-store-origin.sh --dry-run
#   COMPANY_STORE_ORIGIN=https://… ./scripts/pin-company-store-origin.sh --apply \
#     --desktop-path /path/to/deepseek-harness-desktop
#
# Env:
#   COMPANY_STORE_ORIGIN   Required. https:// apex (no path). Trailing slash OK.
#   DESKTOP_PATH           Optional checkout of hopefullstack-collab/deepseek-harness-desktop
#                          (branch cursor/company-store-builtin-cb2c / PR #19)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DRY_RUN=1
APPLY=0
VERIFY=0
SKIP_VERIFY=0
DESKTOP_PATH="${DESKTOP_PATH:-}"
ORIGIN_RAW="${COMPANY_STORE_ORIGIN:-}"

PLACEHOLDER_HOST='plugins.company.example'
ADAPTER_REL='dsh-community-market/src/adapters/company-store.ts'
SPEC_REL='dsh-community-market/tests/company-store-adapter.spec.ts'
SWAP_DOC_REL='dsh-community-market/docs/company-store-endpoint-swap.md'

usage() {
  cat <<'EOF'
Pin desktop COMPANY_STORE placeholders to a durable public Store origin.

Usage:
  COMPANY_STORE_ORIGIN=https://company-store.<account>.workers.dev \
    npm run pin:company-store-origin
  COMPANY_STORE_ORIGIN=https://… ./scripts/pin-company-store-origin.sh [options]

Options:
  --dry-run           Print exact edits + commit message; do not write files (default)
  --apply             Write edits under --desktop-path (implies not dry-run)
  --desktop-path DIR  Path to deepseek-harness-desktop checkout (or set DESKTOP_PATH)
  --verify            curl anonymous /api/v1/health + /api/v1/plugins before printing
  --skip-verify       Do not curl (use when offline; still refuses trycloudflare/http)
  -h, --help          Show help

Env:
  COMPANY_STORE_ORIGIN   https:// origin (required unless passed as sole arg)
  DESKTOP_PATH           Desktop fork checkout for --apply

Refuses: http://, localhost, 127.0.0.1, *.trycloudflare.com, empty host.
Target PR: hopefullstack-collab/deepseek-harness-desktop#19
EOF
}

log() { printf 'pin-company-store-origin: %s\n' "$*"; }
err() { printf 'pin-company-store-origin: ERROR — %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; APPLY=0; shift ;;
    --apply) APPLY=1; DRY_RUN=0; shift ;;
    --desktop-path) DESKTOP_PATH="${2:?}"; shift 2 ;;
    --verify) VERIFY=1; shift ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    https://*|http://*)
      if [[ -z "${ORIGIN_RAW}" ]]; then ORIGIN_RAW="$1"; else die "unexpected arg: $1"; fi
      shift
      ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

[[ -n "${ORIGIN_RAW}" ]] || die "Set COMPANY_STORE_ORIGIN=https://… (or pass URL as arg)"

# Normalize: strip trailing slash and optional /api/v1/plugins path
normalize_origin() {
  local raw="$1"
  raw="$(printf '%s' "${raw}" | sed -E 's#[[:space:]]+##g')"
  # Allow pasting full plugins URL
  raw="$(printf '%s' "${raw}" | sed -E 's#/api/v1/plugins/?$##')"
  raw="$(printf '%s' "${raw}" | sed -E 's#/$##')"
  printf '%s' "${raw}"
}

ORIGIN="$(normalize_origin "${ORIGIN_RAW}")"

case "${ORIGIN}" in
  https://*) ;;
  http://*) die "Refuse non-HTTPS origin: ${ORIGIN}" ;;
  *) die "Origin must start with https:// — got: ${ORIGIN_RAW}" ;;
esac

HOST="$(printf '%s' "${ORIGIN}" | sed -E 's#^https://##; s#/.*##')"
[[ -n "${HOST}" ]] || die "Could not parse hostname from ${ORIGIN}"

case "${HOST}" in
  localhost|127.0.0.1|\[::1\]) die "Refuse loopback pin (use DSH_COMPANY_STORE_LOCAL_ENDPOINT for local)" ;;
  *.trycloudflare.com) die "Refuse trycloudflare (ephemeral). Deploy durable workers.dev/apex first." ;;
  "${PLACEHOLDER_HOST}") die "Origin is still the placeholder ${PLACEHOLDER_HOST}" ;;
esac

ENDPOINT="${ORIGIN}/api/v1/plugins"

verify_anonymous() {
  local apex="$1"
  local health plugins
  log "VERIFY GET ${apex}/api/v1/health"
  health="$(curl -sS --max-time 30 "${apex}/api/v1/health")" || die "health curl failed"
  printf '%s\n' "${health}"
  printf '%s' "${health}" | grep -q '"status"' || die "health missing status"
  log "VERIFY GET ${apex}/api/v1/plugins?limit=1"
  plugins="$(curl -sS --max-time 60 "${apex}/api/v1/plugins?limit=1")" || die "plugins curl failed"
  printf '%s\n' "${plugins}" | head -c 1500
  printf '\n'
  printf '%s' "${plugins}" | grep -q '"packages"' || die "plugins missing packages"
  printf '%s' "${plugins}" | grep -q '"meta"' || die "plugins missing meta"
  log "Anonymous HTTPS Market wire OK"
}

if [[ "${SKIP_VERIFY}" -eq 1 ]]; then
  log "skip-verify: not curling ${ORIGIN}"
elif [[ "${VERIFY}" -eq 1 ]] || [[ "${APPLY}" -eq 1 ]]; then
  verify_anonymous "${ORIGIN}"
else
  log "dry-run default: not curling (pass --verify to check live origin)"
fi

COMMIT_MSG="fix(market): pin company-store to ${HOST}

Stage 2 production placeholders → durable public Store origin after anonymous
GET /api/v1/plugins succeeded.

COMPANY_STORE_PLACEHOLDER_ENDPOINT = ${ENDPOINT}
COMPANY_STORE_PLACEHOLDER_HOSTNAME = ${HOST}

Store origin: ${ORIGIN}
Desktop PR: https://github.com/hopefullstack-collab/deepseek-harness-desktop/pull/19
"

print_edits() {
  cat <<EOF

========================================================================
PIN TARGET — desktop PR #19 (cursor/company-store-builtin-cb2c)

Public origin:  ${ORIGIN}
ENDPOINT:       ${ENDPOINT}
HOSTNAME:       ${HOST}

=== Exact file edits ===

1) ${ADAPTER_REL}

   Replace placeholder constants:

   export const COMPANY_STORE_PLACEHOLDER_ENDPOINT =
     'https://${PLACEHOLDER_HOST}/api/v1/plugins'
   export const COMPANY_STORE_PLACEHOLDER_HOSTNAME = '${PLACEHOLDER_HOST}'

   With:

   export const COMPANY_STORE_PLACEHOLDER_ENDPOINT =
     '${ENDPOINT}'
   export const COMPANY_STORE_PLACEHOLDER_HOSTNAME = '${HOST}'

2) ${SPEC_REL}

   In the 'does not collide with the official built-in key' test, change:

     expect(COMPANY_STORE_HOSTNAME).toBe('${PLACEHOLDER_HOST}')

   To:

     expect(COMPANY_STORE_HOSTNAME).toBe('${HOST}')

   (Other assertions already compare against COMPANY_STORE_PLACEHOLDER_*.)

3) ${SWAP_DOC_REL} (optional but recommended)

   Update the "Current placeholder (committed)" block to the new endpoint/host.

=== Suggested commit message (desktop PR #19) ===

${COMMIT_MSG}
=== Commands (desktop checkout on cursor/company-store-builtin-cb2c) ===

  # After edits (or after this script --apply):
  cd dsh-community-market
  node ./assemble-default-service.mjs
  node ./apply-company-store-wiring.mjs
  node ./apply-company-store-docs.mjs
  yarn vitest run

  git add ${ADAPTER_REL} ${SPEC_REL} ${SWAP_DOC_REL}
  git commit -m "fix(market): pin company-store to ${HOST}"
  git push -u origin cursor/company-store-builtin-cb2c

=== Paste-back (this Store cloud agent / PR #1) ===

  Reply with the origin (or re-run):

    COMPANY_STORE_ORIGIN='${ORIGIN}' npm run pin:company-store-origin -- --verify

  Or apply locally against a desktop clone:

    COMPANY_STORE_ORIGIN='${ORIGIN}' npm run pin:company-store-origin -- \\
      --apply --desktop-path /path/to/deepseek-harness-desktop --verify
========================================================================
EOF
}

apply_edits() {
  local root="$1"
  local apply_mjs="${SCRIPT_DIR}/pin-company-store-origin-apply.mjs"

  [[ -d "${root}" ]] || die "desktop path not a directory: ${root}"
  [[ -f "${apply_mjs}" ]] || die "missing ${apply_mjs}"
  [[ -f "${root}/${ADAPTER_REL}" ]] || die "missing ${root}/${ADAPTER_REL} (wrong checkout / branch?)"

  node "${apply_mjs}" "${root}" "${ENDPOINT}" "${HOST}"

  log "Applied pin under ${root}"
  log "Commit message:"
  printf '%s\n' "${COMMIT_MSG}"
  log "Next: assemble + wiring + yarn vitest run, then push PR #19"
}

print_edits

if [[ "${APPLY}" -eq 1 ]]; then
  [[ -n "${DESKTOP_PATH}" ]] || die "--apply requires --desktop-path or DESKTOP_PATH"
  apply_edits "${DESKTOP_PATH}"
elif [[ "${DRY_RUN}" -eq 1 ]]; then
  log "DRY-RUN complete — no files written. Re-run with --apply --desktop-path … to edit."
fi
