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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const kind = process.argv[2] ?? 'patch'
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: npm run release -- <patch|minor|major>')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()

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
// `npm version` creates the commit and the vX.Y.Z tag in one step.
const tag = run('npm', ['version', kind, '-m', 'Release %s'])
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
