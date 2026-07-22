#!/usr/bin/env node
/**
 * Cuts a release.
 *
 *   npm run release -- patch     0.1.0 -> 0.1.1   (bug fixes)
 *   npm run release -- minor     0.1.0 -> 0.2.0   (new features)
 *   npm run release -- major     0.1.0 -> 1.0.0   (breaking changes)
 *
 * Bumps the version, tags it, and pushes. The GitHub Actions workflow does the
 * rest: tests, builds the installer, and publishes it to a GitHub Release —
 * which is what installed copies check for updates.
 *
 * Refuses to run on a dirty tree. A release built from uncommitted changes is
 * not reproducible from the tag, and there is no way to tell afterwards.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const kind = process.argv[2] ?? 'patch'
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: npm run release -- <patch|minor|major>')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')

const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()

/**
 * Bumps a semver string.
 *
 * Done here rather than by shelling out to `npm version`, because npm on Windows
 * is a .cmd shim and Node refuses to spawn .bat/.cmd without a shell (a CVE
 * fix), while running it *through* a shell would need fragile quoting for the
 * commit message. This is deterministic and has no such hazards.
 */
function bump(version, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!m) throw new Error(`package.json version "${version}" is not semver`)
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (kind === 'major') { major++; minor = 0; patch = 0 }
  else if (kind === 'minor') { minor++; patch = 0 }
  else patch++
  return `${major}.${minor}.${patch}`
}

/** Keeps package-lock in step, or `npm ci` on the runner fails. */
function writeVersion(file, version, alsoRootPackage) {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  json.version = version
  if (alsoRootPackage && json.packages?.['']) json.packages[''].version = version
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
}

// --- preflight --------------------------------------------------------------
const dirty = run('git', ['status', '--porcelain'])
if (dirty) {
  console.error('Working tree has uncommitted changes:\n')
  console.error(dirty)
  console.error('\nCommit or stash them first — a release must match its tag exactly.')
  process.exit(1)
}

const remotes = run('git', ['remote']).split('\n').filter(Boolean)
if (!remotes.includes('origin')) {
  console.error('No "origin" remote. Run: npm run setup-github -- <your-github-username>')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
if (pkg.repository?.url?.includes('YOUR_GITHUB_USERNAME')) {
  console.error('package.json still has the placeholder repository URL.')
  console.error('Run: npm run setup-github -- <your-github-username>')
  process.exit(1)
}

console.log(`Current version: ${pkg.version}`)

// --- bump, tag, push --------------------------------------------------------
const next = bump(pkg.version, kind)
const tag = `v${next}`

writeVersion(resolve(root, 'package.json'), next, false)
writeVersion(resolve(root, 'package-lock.json'), next, true)

run('git', ['add', 'package.json', 'package-lock.json'])
run('git', ['commit', '-m', `Release ${tag}`])
run('git', ['tag', '-a', tag, '-m', `Release ${tag}`])

console.log(`New version:     ${tag}`)

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
console.log(`\nPushing ${branch} and ${tag}…`)
execFileSync('git', ['push', 'origin', branch, '--follow-tags'], {
  cwd: root,
  stdio: 'inherit'
})

const repoUrl = pkg.repository.url.replace(/\.git$/, '')
console.log(`\nReleased ${tag}.`)
console.log(`Actions will build and publish the installer in a few minutes:`)
console.log(`  ${repoUrl}/actions`)
console.log(`  ${repoUrl}/releases`)
console.log('\nInstalled copies will offer the update automatically on next launch.')
