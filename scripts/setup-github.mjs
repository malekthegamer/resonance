#!/usr/bin/env node
/**
 * One-time GitHub setup.
 *
 *   node scripts/setup-github.mjs <github-username> [repo-name]
 *
 * Does three things that are fiddly and easy to get wrong by hand:
 *
 *  1. Rewrites the author/committer email on every existing commit to a GitHub
 *     noreply address, so a personal email is never published. This is only
 *     safe before the first push — rewriting history afterwards breaks every
 *     clone — so the script refuses to run once a remote exists.
 *  2. Points `repository` in package.json at the new repo, which is where
 *     electron-builder reads the publish target from. Auto-update silently
 *     looks at the wrong place if this is wrong.
 *  3. Adds the `origin` remote.
 *
 * It deliberately does NOT push. Creating the repo and pushing stay in your
 * hands.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [username, repoArg] = process.argv.slice(2)
const repo = repoArg ?? 'resonance'

if (!username) {
  console.error('Usage: node scripts/setup-github.mjs <github-username> [repo-name]')
  process.exit(1)
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(username)) {
  console.error(`"${username}" is not a valid GitHub username.`)
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')

/** Captures stdout. */
const git = (args, opts = {}) =>
  (execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }) ?? '').trim()

/**
 * Runs git for its side effect, letting output through.
 * Kept separate from `git()` because redirecting stdio makes execFileSync return
 * null, and calling .trim() on that throws.
 */
const gitRun = (args, opts = {}) =>
  execFileSync('git', args, { cwd: root, stdio: 'inherit', ...opts })

// --- guard: filter-branch refuses to rewrite over uncommitted work ----------
const dirty = git(['status', '--porcelain'])
if (dirty) {
  console.error('Working tree has uncommitted changes:\n')
  console.error(dirty)
  console.error(
    '\nCommit them first — rewriting history requires a clean tree:\n' +
      '  git add -A && git commit -m "Add GitHub release setup"'
  )
  process.exit(1)
}

// --- guard: never rewrite history that someone may already have cloned -------
const remotes = git(['remote']).split('\n').filter(Boolean)
if (remotes.length > 0) {
  console.error(
    `This repo already has a remote (${remotes.join(', ')}).\n` +
      'Rewriting history now would break anyone who has cloned it, so this script stops here.'
  )
  process.exit(1)
}

const noreply = `${username}@users.noreply.github.com`
const url = `https://github.com/${username}/${repo}.git`

console.log(`Rewriting commit email  -> ${noreply}`)
console.log(`Setting repository      -> ${url}\n`)

// --- 1. rewrite author/committer email on every commit ----------------------
const oldEmail = git(['log', '-1', '--format=%ae'])
const env =
  `if [ "$GIT_AUTHOR_EMAIL" = "${oldEmail}" ]; then export GIT_AUTHOR_EMAIL="${noreply}"; fi; ` +
  `if [ "$GIT_COMMITTER_EMAIL" = "${oldEmail}" ]; then export GIT_COMMITTER_EMAIL="${noreply}"; fi`

gitRun(['filter-branch', '-f', '--env-filter', env, '--', '--all'], {
  env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' },
  stdio: ['ignore', 'ignore', 'inherit']
})

// Future commits from this clone use the noreply address too.
git(['config', 'user.email', noreply])

// --- 2. point package.json at the repo --------------------------------------
const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.repository = { type: 'git', url }
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// --- 3. add the remote ------------------------------------------------------
git(['remote', 'add', 'origin', url])

// --- verify -----------------------------------------------------------------
const emails = [...new Set(git(['log', '--format=%ae']).split('\n').filter(Boolean))]
const commits = git(['rev-list', '--count', 'HEAD'])

console.log(`Rewrote ${commits} commits.`)
console.log(`Author emails now in history: ${emails.join(', ')}`)

if (emails.some((e) => e !== noreply)) {
  console.error('\nWARNING: some commits still carry a different email. Check `git log` before pushing.')
  process.exit(1)
}

// The script itself edits package.json, so that change still needs committing.
console.log('\nDone. Next:')
console.log(`  1. Create an EMPTY repo at https://github.com/new`)
console.log(`     Name it "${repo}". Do NOT add a README, .gitignore or licence.`)
console.log('  2. git add -A && git commit -m "Point at GitHub repo"')
console.log('  3. git push -u origin master')
console.log('\nAfter that, shipping a new version is one command:')
console.log('  npm run release -- patch')
