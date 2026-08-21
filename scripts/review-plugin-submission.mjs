#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { assert, isObject, parsePluginId, repositoryUrl, validateCatalogEntry } from './lib/catalog-entry.mjs'

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(process.env.PLUGIN_REVIEW_ROOT ?? scriptRoot)
const catalogPrefix = 'catalog/plugins/'
const catalogFilePattern = /^catalog\/plugins\/[^/]+\.json$/
const reviewCommentMarker = '<!-- dsh-plugin-submission-review -->'

export { validateCatalogEntry }

function repositoryParts(id) {
  // subPath stays raw: it is compared against git tree paths and later feeds
  // the pnpm `#path:` install spec; only owner/repository enter API URLs.
  const { owner, repository, subPath } = parsePluginId(id)
  return { owner: encodeURIComponent(owner), repository: encodeURIComponent(repository), subPath }
}

function decodeBlob(blob, packagePath) {
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') {
    throw new Error(`${packagePath} could not be read as text`)
  }
  return Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf8')
}

function resolvePatchPath(packagePath, patch) {
  if (path.posix.isAbsolute(patch) || patch.includes('\\')) {
    throw new Error(`${packagePath} has an invalid dsh.bundle.patch path: ${patch}`)
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(packagePath), patch))
  if (resolved === '..' || resolved.startsWith('../')) {
    throw new Error(`${packagePath} has a dsh.bundle.patch path outside the repository: ${patch}`)
  }
  return resolved
}

/**
 * The entry point a git install has to be able to import, taken from the
 * manifest's `exports["."]` or `main`. Returns undefined when the manifest
 * declares none — Node then falls back to `index.js`, but a bundle may load
 * purely through its patch, so an undeclared entry is not treated as a defect.
 */
export function declaredEntryPoint(manifest) {
  const exported = manifest.exports
  if (typeof exported === 'string') return exported
  if (isObject(exported)) {
    const root = exported['.']
    if (typeof root === 'string') return root
    if (isObject(root)) {
      for (const condition of ['default', 'import', 'node', 'require']) {
        if (typeof root[condition] === 'string') return root[condition]
      }
    }
  }
  return typeof manifest.main === 'string' ? manifest.main : undefined
}

/**
 * Classifies whether a git install of this manifest yields a loadable package.
 *
 * pnpm runs `prepare` after a git install and otherwise ships only what is
 * committed. A plugin whose entry point is a build artifact that is neither
 * committed nor produced by `prepare` installs successfully and then fails at
 * profile boot with a module-not-found error — the failure surfaces far from
 * its cause, so the gate names it here.
 *
 * This is a LABEL, not an admission test: the submission is still accepted and
 * the plugin still gets catalogued. The website derives the same verdict from
 * its own crawl (apps/web/worker/lib/install-methods.ts); the two must agree,
 * or the pull-request advisory contradicts the published badge.
 *
 * A committed entry wins the loadability verdict, while the presence of a
 * prepare script independently determines whether the install command needs
 * pnpm's `--allow-build` option.
 *
 * @returns `{ code, entryPoint, requiresBuildAllowance }`; never throws.
 */
export function classifyGitInstall(packagePath, manifest, files) {
  const prepare = isObject(manifest.scripts) ? manifest.scripts.prepare : undefined
  const requiresBuildAllowance = typeof prepare === 'string' && prepare.trim().length > 0
  const entry = declaredEntryPoint(manifest)

  if (entry === undefined) {
    return { code: 'no_entry_declared', entryPoint: undefined, requiresBuildAllowance }
  }
  let entryPath
  try {
    entryPath = resolvePatchPath(packagePath, entry)
  } catch {
    return { code: 'entry_outside_repository', entryPoint: entry, requiresBuildAllowance }
  }
  if (files.has(entryPath)) {
    return { code: 'entry_committed', entryPoint: entry, requiresBuildAllowance }
  }
  if (requiresBuildAllowance) {
    return { code: 'prepare_builds_entry', entryPoint: entry, requiresBuildAllowance }
  }
  return { code: 'entry_missing_no_prepare', entryPoint: entry, requiresBuildAllowance }
}

/** The author-facing advisory for a classification, or undefined when clean. */
export function gitInstallAdvisory(code, entryPoint, requiresBuildAllowance, packageName) {
  const lines = []
  if (code === 'entry_missing_no_prepare') {
    lines.push(
      `The GitHub install method will be published as UNVERIFIED: the entry point ${entryPoint} is not committed `
      + 'and the package has no prepare script, so `dsh plugin add github:…` installs cleanly and then fails at '
      + 'startup with ERR_MODULE_NOT_FOUND. Your plugin is catalogued either way. To clear the label, commit the '
      + 'built entry point, add a self-contained prepare script, or publish a package with `dsh.bundle` to npm.',
    )
  }
  if (code === 'entry_outside_repository') {
    lines.push(`The entry point ${entryPoint} resolves outside the repository; the GitHub install method will be published as UNVERIFIED.`)
  }
  if (code === 'no_entry_declared') {
    lines.push('This package declares no entry point. That is expected for a bundle whose patch only mounts other packages, but it cannot be confirmed statically, so the GitHub install method will be published as UNKNOWN.')
  }
  if (requiresBuildAllowance) {
    lines.push(
      packageName
        ? `This package builds on source install. Use \`dsh plugin --profile web add --allow-build=${packageName} github:…\`; pnpm grants and persists the build permission during that first successful install. Publishing prebuilt code to npm avoids the source build.`
        : 'This package builds on source install. The install command must pass pnpm’s `--allow-build=<package-name>` option so the first install can run the build script successfully.',
    )
  }
  return lines.length === 0 ? undefined : lines.join('\n\n')
}

export async function findHarnessBundle(tree, readBlob, subPath = '') {
  const files = new Map(tree.filter(item => item.type === 'blob').map(item => [item.path, item]))
  const allPackages = [...files.values()]
    .filter(item => item.path === 'package.json' || item.path.endsWith('/package.json'))
    .filter(item => !item.path.split('/').includes('node_modules'))
    .sort((left, right) => left.path.split('/').length - right.path.split('/').length || left.path.localeCompare(right.path))

  // A subdirectory id pins the manifest to exactly that directory: the id's
  // path becomes the pnpm `#path:` install spec, so a bundle anywhere else in
  // the repository would not be what the derived install command installs.
  const requiredPackagePath = subPath.length === 0 ? undefined : `${subPath}/package.json`
  const packages = requiredPackagePath === undefined
    ? allPackages
    : allPackages.filter(item => item.path === requiredPackagePath)

  if (packages.length === 0) {
    if (requiredPackagePath !== undefined) {
      const declared = allPackages.map(item => item.path)
      throw new Error([
        `Repository has no ${requiredPackagePath}; the id's subdirectory path must contain the plugin's package.json.`,
        ...(declared.length > 0 ? [`package.json files found: ${declared.slice(0, 20).join(', ')}`] : []),
      ].join('\n'))
    }
    throw new Error('Repository contains no package.json')
  }

  const invalidBundles = []
  for (const packageFile of packages) {
    let manifest
    try {
      manifest = JSON.parse(decodeBlob(await readBlob(packageFile.sha), packageFile.path))
    } catch (error) {
      invalidBundles.push(`${packageFile.path}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const bundle = isObject(manifest) && isObject(manifest.dsh) && isObject(manifest.dsh.bundle)
      ? manifest.dsh.bundle
      : undefined
    if (bundle === undefined) continue
    if (typeof bundle.patch !== 'string' || bundle.patch.trim().length === 0) {
      invalidBundles.push(`${packageFile.path}: dsh.bundle.patch must be a non-empty string`)
      continue
    }

    try {
      const patchPath = resolvePatchPath(packageFile.path, bundle.patch.trim())
      if (!files.has(patchPath)) {
        invalidBundles.push(`${packageFile.path}: dsh.bundle.patch does not exist: ${patchPath}`)
        continue
      }
      // Classification never rejects: the entry point being unobtainable is a
      // published label, not grounds for refusing the submission. Bundle
      // selection therefore stays independent of the verdict — the first
      // manifest declaring dsh.bundle wins, matching what the website's crawler
      // picks for the same repository.
      const gitInstall = classifyGitInstall(packageFile.path, manifest, files)
      return {
        packagePath: packageFile.path,
        patchPath,
        packageName: typeof manifest.name === 'string' ? manifest.name : undefined,
        packageVersion: typeof manifest.version === 'string' ? manifest.version : undefined,
        gitInstall,
      }
    } catch (error) {
      invalidBundles.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (invalidBundles.length > 0) throw new Error(invalidBundles.join('\n'))
  throw new Error(requiredPackagePath === undefined
    ? 'No package.json declares dsh.bundle.patch'
    : `${requiredPackagePath} does not declare dsh.bundle.patch`)
}

export function createGitHubClient(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-1024store-plugin-review',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token === undefined || token.length === 0 ? {} : { Authorization: `Bearer ${token}` }),
  }

  async function request(apiPath, options = {}) {
    const response = await fetch(`https://api.github.com${apiPath}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    })
    const detail = await response.text()
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${apiPath}: ${detail.slice(0, 300)}`)
    }
    return detail.length === 0 ? undefined : JSON.parse(detail)
  }

  return { request }
}

function validatePullContext(repository, pullNumber) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('Missing or invalid pull request repository')
  }
  if (!/^[1-9]\d*$/.test(pullNumber ?? '')) throw new Error('Missing or invalid pull request number')
}

export function reviewComment(status, message) {
  const diagnostic = message.slice(0, 6000).replaceAll('```', '` ` `')
  if (status === 'passed') {
    return `${reviewCommentMarker}\n## Plugin submission review passed\n\n${diagnostic}`
  }
  if (status === 'manual-review') {
    return `${reviewCommentMarker}\n## Plugin submission review passed — maintainer review required\n\n${diagnostic}\n\nThis pull request modifies or removes existing catalog entries, so it will not be merged automatically. A maintainer will review the change set and merge it manually.`
  }
  return `${reviewCommentMarker}\n## Plugin submission review failed\n\n\`\`\`text\n${diagnostic}\n\`\`\`\n\nPush a correction to this pull request. The review will run again automatically. Failed reviews never close the pull request.`
}

export async function upsertReviewComment(repository, pullNumber, client, body) {
  validatePullContext(repository, pullNumber)
  const comments = await client.request(`/repos/${repository}/issues/${pullNumber}/comments?per_page=100`)
  if (!Array.isArray(comments)) throw new Error('Pull request comments are unavailable')
  const existing = comments.find(comment => (
    comment?.user?.login === 'github-actions[bot]'
    && typeof comment?.body === 'string'
    && comment.body.includes(reviewCommentMarker)
  ))
  if (existing === undefined) {
    await client.request(`/repos/${repository}/issues/${pullNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
    return
  }
  await client.request(`/repos/${repository}/issues/comments/${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  })
}

export async function pullRequestChanges(repository, pullNumber, client) {
  validatePullContext(repository, pullNumber)

  const files = await client.request(`/repos/${repository}/pulls/${pullNumber}/files?per_page=100`)
  if (!Array.isArray(files)) throw new Error('Pull request file list is unavailable')
  if (files.length === 100) {
    throw new Error('Plugin submission PRs may not contain 100 or more changed files')
  }

  const statuses = {
    added: 'A',
    modified: 'M',
    removed: 'D',
    renamed: 'R',
    copied: 'C',
  }
  return files.map(file => {
    const status = statuses[file?.status]
    if (status === undefined || typeof file?.filename !== 'string') {
      throw new Error('Pull request contains an unsupported file change')
    }
    if (status === 'R' || status === 'C') {
      if (typeof file.previous_filename !== 'string') throw new Error('Pull request contains an incomplete renamed path')
      return { status, oldPath: file.previous_filename, file: file.filename }
    }
    return { status, file: file.filename }
  })
}

export async function reviewRepository(entry, client) {
  if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.repository !== 'string') {
    throw new Error('Catalog entry must contain string id and repository fields')
  }
  if (entry.repository !== repositoryUrl(entry.id)) {
    throw new Error(`repository must be ${repositoryUrl(entry.id)}`)
  }

  const { owner, repository, subPath } = repositoryParts(entry.id)
  const base = `/repos/${owner}/${repository}`
  const metadata = await client.request(base)
  if (typeof metadata.default_branch !== 'string' || metadata.default_branch.length === 0) {
    throw new Error('Repository has no default branch')
  }
  const commit = await client.request(`${base}/commits/${encodeURIComponent(metadata.default_branch)}`)
  const treeSha = commit?.commit?.tree?.sha
  if (typeof treeSha !== 'string') throw new Error('Default branch commit has no tree')
  const tree = await client.request(`${base}/git/trees/${treeSha}?recursive=1`)
  if (!Array.isArray(tree.tree)) throw new Error('Repository tree is unavailable')
  if (tree.truncated === true) throw new Error('Repository tree is too large to inspect completely')

  return findHarnessBundle(tree.tree, sha => client.request(`${base}/git/blobs/${sha}`), subPath)
}

export function parseNameStatus(output) {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()

  const changes = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (status === undefined || status.length === 0) throw new Error('Git returned an invalid change status')
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[index++]
      const file = fields[index++]
      if (oldPath === undefined || file === undefined) throw new Error('Git returned an incomplete renamed or copied path')
      changes.push({ status, oldPath, file })
    } else {
      const file = fields[index++]
      if (file === undefined) throw new Error('Git returned an incomplete changed path')
      changes.push({ status, file })
    }
  }
  return changes
}

function describeChange(change) {
  return change.oldPath === undefined
    ? `${change.status} ${change.file}`
    : `${change.status} ${change.oldPath} -> ${change.file}`
}

export function validateSubmissionChanges(changes) {
  if (changes.length === 0) {
    throw new Error(`Plugin submission PRs must change at least one ${catalogPrefix}*.json file`)
  }

  const problems = []
  const reviewables = []
  const deletions = []
  let additions = 0
  let catalogTouches = 0
  for (const change of changes) {
    // git reports rename/copy statuses with a similarity score (R100, C75).
    const status = change.status[0]
    const paths = change.oldPath === undefined ? [change.file] : [change.oldPath, change.file]
    const touchesCatalog = paths.some(
      candidate => candidate === catalogPrefix.slice(0, -1) || candidate.startsWith(catalogPrefix),
    )
    if (touchesCatalog) catalogTouches += 1
    if (!['A', 'M', 'D', 'R', 'C'].includes(status)) {
      problems.push(`unsupported change: ${describeChange(change)}`)
      continue
    }
    if (!paths.every(candidate => catalogFilePattern.test(candidate))) {
      // Paths under catalog/plugins/ that are not a single-level *.json still
      // count as catalog intent (nested dirs, wrong extension) so mixed /
      // malformed catalog PRs keep failing closed.
      problems.push(`unexpected change: ${describeChange(change)}`)
      continue
    }
    if (status === 'D') deletions.push(change.file)
    else reviewables.push(change.file)
    if (status === 'A') additions += 1
  }
  // Maintenance / company-fork PRs that never touch the plugin catalog are not
  // submissions. Skip (exit green) so static-review stays required for real
  // catalog PRs without forcing an emergency bypass for Store work. Any catalog
  // touch — including mixed catalog+code — still runs the strict gate below.
  if (catalogTouches === 0) {
    return { verdict: 'skipped', reviewables: [], deletions: [], changes }
  }
  if (problems.length > 0) {
    throw new Error([
      `Plugin submission PRs may only add, modify, or delete ${catalogPrefix}*.json files.`,
      ...problems,
    ].join('\n'))
  }

  const verdict = changes.length === 1 && additions === 1 ? 'auto-merge' : 'manual-review'
  return { verdict, reviewables, deletions, changes }
}

export async function readCatalogEntry(rootDirectory, file) {
  const target = path.join(rootDirectory, file)
  const metadata = await lstat(target)
  assert(metadata.isFile(), `${file} must be a regular file`)
  return JSON.parse(await readFile(target, 'utf8'))
}

function changedFiles(base, head) {
  for (const [name, value] of [['base', base], ['head', head]]) {
    if (!/^[0-9a-f]{40}$/i.test(value ?? '')) throw new Error(`Missing or invalid ${name} commit SHA`)
  }
  const output = execFileSync('git', [
    'diff', '--name-status', '-z', base, head,
  ], { cwd: root, encoding: 'utf8' })
  return parseNameStatus(output)
}

function workflowError(file, message) {
  const escaped = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  process.stderr.write(`::error file=${file}::${escaped}\n`)
}

function publishVerdict(verdict) {
  console.log(`VERDICT ${verdict}`)
  const output = process.env.GITHUB_OUTPUT
  if (output === undefined || output.length === 0) return
  appendFileSync(output, `verdict=${verdict}\n`)
}

async function main() {
  const base = process.env.PLUGIN_REVIEW_BASE_SHA
  const head = process.env.PLUGIN_REVIEW_HEAD_SHA
  const client = createGitHubClient(process.env.GITHUB_TOKEN)
  const repository = process.env.PLUGIN_REVIEW_REPOSITORY
  const pullNumber = process.env.PLUGIN_REVIEW_PULL_NUMBER
  let file = catalogPrefix
  try {
    const changes = repository === undefined && pullNumber === undefined
      ? changedFiles(base, head)
      : await pullRequestChanges(repository, pullNumber, client)
    const submission = validateSubmissionChanges(changes)
    if (submission.verdict === 'skipped') {
      publishVerdict('skipped')
      console.log(
        'SKIP not a catalog plugin submission '
        + `(no ${catalogPrefix}*.json changes); static-review does not apply.`,
      )
      return
    }
    // Read the category allow-list from the trusted checkout this script was
    // loaded from, never from the submitted tree: it decides which categories a
    // submission may claim, so it must not be attacker-controlled.
    const categories = JSON.parse(await readFile(path.join(scriptRoot, 'catalog/categories.json'), 'utf8'))
    const categoryIds = new Set(categories?.categories?.map(category => category?.id))
    // Upstream's change-set loop stays; the install classification rides along
    // per reviewed entry and is reported, never enforced.
    const advisories = []
    for (const target of submission.reviewables) {
      file = target
      const entry = await readCatalogEntry(root, target)
      validateCatalogEntry(entry, target, categoryIds)
      const result = await reviewRepository(entry, client)
      const { code, entryPoint, requiresBuildAllowance } = result.gitInstall
      console.log(
        `PASS ${entry.id}: ${result.packagePath} -> ${result.patchPath}`
        + ` [git-install: ${code}${requiresBuildAllowance ? ', requires build allowance' : ''}]`,
      )
      const advisory = gitInstallAdvisory(code, entryPoint, requiresBuildAllowance, result.packageName)
      if (advisory !== undefined) advisories.push(`**${entry.id}** — ${advisory}`)
    }
    for (const target of submission.deletions) {
      console.log(`PASS delete ${target}`)
    }
    file = catalogPrefix
    publishVerdict(submission.verdict)
    if (repository !== undefined && pullNumber !== undefined) {
      const summary = submission.verdict === 'auto-merge'
        ? 'All static checks passed. The validated pull request will be squash-merged automatically.'
        : [
          'All static checks passed for this change set:',
          '',
          ...submission.changes.map(change => `- ${describeChange(change)}`),
        ].join('\n')
      const detail = [
        summary,
        ...(advisories.length === 0 ? [] : ['', '### Install method advisory', '', ...advisories]),
      ].join('\n')
      await upsertReviewComment(
        repository,
        pullNumber,
        client,
        reviewComment(submission.verdict === 'auto-merge' ? 'passed' : 'manual-review', detail),
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    publishVerdict('rejected')
    workflowError(file, message)
    console.error(`FAIL ${file}\n${message}`)
    if (repository !== undefined && pullNumber !== undefined) {
      try {
        await upsertReviewComment(repository, pullNumber, client, reviewComment('failed', message))
      } catch (commentError) {
        console.error(`Unable to report the failure on the pull request: ${commentError instanceof Error ? commentError.message : String(commentError)}`)
      }
    }
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
