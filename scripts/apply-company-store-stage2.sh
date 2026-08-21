#!/usr/bin/env bash
# One-command Stage 2 apply for Desktop maintainers.
#
# Clones (or uses) anywhere-labs/deepseek-harness-desktop, checks out master,
# applies docs/ai-buddy-stage2/company-store-stage2-on-9d18856.patch via git am
# (falls back to git apply --3way), runs vitest in dsh-community-market, and
# prints next steps for opening an upstream PR.
#
# Does NOT push and does NOT open a PR (avoids dirty upstream PRs from agents).
#
# Usage:
#   ./scripts/apply-company-store-stage2.sh
#   ./scripts/apply-company-store-stage2.sh --desktop-path /path/to/deepseek-harness-desktop
#   ./scripts/apply-company-store-stage2.sh --clone-dir /tmp/desktop-stage2 --skip-tests
#
set -euo pipefail

REPO_DEFAULT="https://github.com/anywhere-labs/deepseek-harness-desktop.git"
REF_DEFAULT="master"
BRANCH_DEFAULT="cursor/company-store-builtin-cb2c"
CLONE_DEFAULT="/tmp/deepseek-harness-desktop-stage2-apply"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_DEFAULT="${STORE_ROOT}/docs/ai-buddy-stage2/company-store-stage2-on-9d18856.patch"

DESKTOP_PATH=""
CLONE_DIR="${CLONE_DEFAULT}"
REPO_URL="${REPO_DEFAULT}"
REF="${REF_DEFAULT}"
BRANCH="${BRANCH_DEFAULT}"
PATCH_FILE="${PATCH_DEFAULT}"
SKIP_TESTS=0
SKIP_INSTALL=0
DRY_RUN_APPLY=0

usage() {
  cat <<'EOF'
One-command Stage 2 apply for Desktop maintainers.

Clones (or uses) anywhere-labs/deepseek-harness-desktop, checks out master,
applies docs/ai-buddy-stage2/company-store-stage2-on-9d18856.patch via git am
(falls back to git apply --3way), runs vitest in dsh-community-market, and
prints next steps for opening an upstream PR.

Does NOT push and does NOT open a PR.

Usage:
  ./scripts/apply-company-store-stage2.sh
  ./scripts/apply-company-store-stage2.sh --desktop-path /path/to/deepseek-harness-desktop
  ./scripts/apply-company-store-stage2.sh --clone-dir /tmp/desktop-stage2 --skip-tests

Options:
  --desktop-path PATH   Existing desktop checkout (skip clone)
  --clone-dir PATH      Clone destination (default: /tmp/deepseek-harness-desktop-stage2-apply)
  --repo URL            Upstream git URL
  --ref REF             Branch/ref to base on (default: master)
  --branch NAME         Local branch to create for the apply (default: cursor/company-store-builtin-cb2c)
  --patch FILE          Path to mailbox patch (default: docs/ai-buddy-stage2/company-store-stage2-on-9d18856.patch)
  --skip-tests          Apply only; do not run vitest
  --skip-install        Do not run yarn/npm install in dsh-community-market
  --check-only          Verify patch applies with --check; do not modify the tree
  -h, --help            Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --desktop-path) DESKTOP_PATH="${2:?}"; shift 2 ;;
    --clone-dir) CLONE_DIR="${2:?}"; shift 2 ;;
    --repo) REPO_URL="${2:?}"; shift 2 ;;
    --ref) REF="${2:?}"; shift 2 ;;
    --branch) BRANCH="${2:?}"; shift 2 ;;
    --patch) PATCH_FILE="${2:?}"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --check-only) DRY_RUN_APPLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }

[[ -f "${PATCH_FILE}" ]] || die "patch not found: ${PATCH_FILE}"

resolve_desktop() {
  if [[ -n "${DESKTOP_PATH}" ]]; then
    [[ -d "${DESKTOP_PATH}/.git" ]] || die "not a git checkout: ${DESKTOP_PATH}"
    [[ -d "${DESKTOP_PATH}/dsh-community-market" ]] || die "missing dsh-community-market in ${DESKTOP_PATH}"
    cd "${DESKTOP_PATH}"
    log "Using existing desktop checkout: $(pwd)"
    return
  fi

  if [[ -d "${CLONE_DIR}/.git" ]]; then
    log "Reusing clone at ${CLONE_DIR}"
    cd "${CLONE_DIR}"
  else
    log "Cloning ${REPO_URL} → ${CLONE_DIR}"
    mkdir -p "$(dirname "${CLONE_DIR}")"
    git clone -- "${REPO_URL}" "${CLONE_DIR}"
    cd "${CLONE_DIR}"
  fi
}

resolve_base_ref() {
  # Prefer a remote-tracking tip that matches REF. Fork checkouts often have
  # anywhere-labs as `upstream` and the fork as `origin` (no origin/master).
  local candidate
  for candidate in "origin/${REF}" "upstream/${REF}" "${REF}"; do
    if git rev-parse --verify "${candidate}" >/dev/null 2>&1; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  return 1
}

prepare_tree() {
  log "Fetching ${REF} (best-effort from origin/upstream)…"
  git fetch --quiet origin "${REF}" 2>/dev/null || git fetch --quiet origin 2>/dev/null || true
  if git remote get-url upstream >/dev/null 2>&1; then
    git fetch --quiet upstream "${REF}" 2>/dev/null || git fetch --quiet upstream 2>/dev/null || true
  fi

  local base
  if ! base="$(resolve_base_ref)"; then
    die "cannot resolve ref ${REF} (tried origin/${REF}, upstream/${REF}, ${REF})"
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "working tree dirty in $(pwd); commit/stash local changes, or use --clone-dir for a fresh apply"
  fi

  log "Checking out clean base ${base} ($(git rev-parse --short "${base}"))"
  # Detach first so we can recreate the apply branch even if it already exists.
  # reset --hard restores tracked files; do not git-clean — preserve node_modules.
  git checkout --quiet --detach "${base}"
  git reset --hard --quiet "${base}"

  if [[ "${DRY_RUN_APPLY}" -eq 1 ]]; then
    return
  fi

  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    log "Deleting existing local branch ${BRANCH}"
    git branch -D "${BRANCH}" >/dev/null
  fi
  git checkout --quiet -b "${BRANCH}"
  log "Created branch ${BRANCH} at $(git rev-parse --short HEAD)"
}

apply_patch() {
  if [[ "${DRY_RUN_APPLY}" -eq 1 ]]; then
    log "Check-only: git apply --check"
    git apply --check "${PATCH_FILE}"
    log "Patch applies cleanly (check-only)."
    return
  fi

  log "Applying patch via git am: ${PATCH_FILE}"
  if git am --3way -- "${PATCH_FILE}"; then
    log "git am succeeded → $(git rev-parse --short HEAD)"
    return
  fi

  log "git am failed; aborting and falling back to git apply --3way"
  git am --abort 2>/dev/null || true
  git apply --3way -- "${PATCH_FILE}" || die "git apply --3way failed"
  git add -A
  if git diff --cached --quiet; then
    die "patch produced no staged changes"
  fi
  git commit -m "$(sed -n 's/^Subject: \[PATCH\] //p' "${PATCH_FILE}" | head -1 | sed 's/^$/feat(market): optional company-store built-in partner source/')"
  log "git apply + commit succeeded → $(git rev-parse --short HEAD)"
}

run_tests() {
  [[ "${SKIP_TESTS}" -eq 1 ]] && { log "Skipping tests (--skip-tests)"; return; }
  [[ "${DRY_RUN_APPLY}" -eq 1 ]] && return

  local market
  market="$(pwd)/dsh-community-market"
  [[ -d "${market}" ]] || die "missing ${market}"

  if [[ "${SKIP_INSTALL}" -eq 0 ]]; then
    if [[ ! -x "${market}/node_modules/.bin/vitest" && ! -d "${market}/node_modules/vitest" ]]; then
      log "Installing dsh-community-market deps (yarn from repo root, then package)"
      if [[ -f "$(pwd)/yarn.lock" || -f "$(pwd)/.yarnrc.yml" ]]; then
        (cd "$(pwd)" && yarn install --frozen-lockfile 2>/dev/null || yarn install) || true
      fi
      (cd "${market}" && yarn install --frozen-lockfile 2>/dev/null || yarn install || npm install)
    else
      log "vitest already present; skipping install"
    fi
  fi

  log "Running vitest in dsh-community-market"
    (
    cd "${market}"
    # Prefer yarn when the workspace is intact; fall back to the local binary
    # (Yarn Berry fails with a missing node_modules state file in partial checkouts).
    if yarn vitest run 2>/tmp/stage2-yarn-vitest.err; then
      :
    elif [[ -x ./node_modules/.bin/vitest ]]; then
      log "yarn vitest unavailable; using ./node_modules/.bin/vitest run"
      ./node_modules/.bin/vitest run
    elif command -v npm >/dev/null 2>&1; then
      npm test -- --run 2>/dev/null || npx vitest run
    else
      die "cannot run vitest (no yarn/npm/local binary)"
    fi
  )
}

print_next_steps() {
  [[ "${DRY_RUN_APPLY}" -eq 1 ]] && return
  local tip
  tip="$(git rev-parse HEAD)"
  cat <<EOF

------------------------------------------------------------
Stage 2 apply complete (local only — nothing pushed).

Desktop checkout: $(pwd)
Branch:           ${BRANCH}
Tip:              ${tip}

Next steps (maintainer with push rights to a writable fork/remote):

  1. Add your push remote if needed, then:
       git push -u <writable-remote> ${BRANCH}

  2. Open a PR against anywhere-labs/deepseek-harness-desktop:master
       Title: feat(market): optional company-store built-in partner source
       Body:  Built-in key company-store (does not retarget dsh-1024store).
              Placeholder endpoint https://plugins.company.example/api/v1/plugins
              ZH disclaimer: 公司目录，收录≠安全审核
              Tests: yarn vitest run in dsh-community-market

  3. Do NOT pin COMPANY_STORE_* hostnames until a durable public Store HTTPS
     origin exists.

Patch kit / product rules:
  ${STORE_ROOT}/docs/ai-buddy-stage2/README.md
  ${STORE_ROOT}/docs/ai-buddy-stage2/patch/APPLY.md
------------------------------------------------------------
EOF
}

main() {
  log "Store root: ${STORE_ROOT}"
  log "Patch:      ${PATCH_FILE}"
  resolve_desktop
  prepare_tree
  apply_patch
  run_tests
  print_next_steps
}

main
