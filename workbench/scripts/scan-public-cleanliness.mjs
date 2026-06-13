#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  forbiddenFilePatterns,
  ignoredPathParts,
  privateKeywordGroups,
  textExtensions,
} from './public-cleanliness.config.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const WORKBENCH_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(WORKBENCH_ROOT, '..')
const DEFAULT_ALLOWLIST = resolve(__dirname, 'public-cleanliness.allowlist.json')

const TEXT_EXTENSIONS = new Set(textExtensions.map((ext) => ext.toLowerCase()))

const PERSONAL_PATH_PATTERNS = [
  { label: 'macOS home path', regex: /\/Users\/[^/\s'"`)\]<>]+/g },
  { label: 'Windows home path', regex: /[A-Z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s'"`)\]<>]+/g },
  { label: 'Linux home path', regex: /\/home\/[^/\s'"`)\]<>]+/g },
]

const SECRET_PATTERNS = [
  { label: 'OpenAI key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { label: 'Anthropic key', regex: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/g },
  { label: 'Gemini key', regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { label: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { label: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { label: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'Authorization bearer', regex: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { label: 'private key header', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
]

function usage() {
  console.error(`Usage:
  node scripts/scan-public-cleanliness.mjs --tracked [--ref HEAD]
  node scripts/scan-public-cleanliness.mjs --staged
  node scripts/scan-public-cleanliness.mjs --history [--all-refs]
  node scripts/scan-public-cleanliness.mjs --path <dir>
  node scripts/scan-public-cleanliness.mjs --dmg-resources <dir>

Options:
  --private-config <path>    Load private keyword config without committing secrets.
  --allowlist <path>         Override allowlist JSON.
`)
}

function parseArgs(argv) {
  const args = {
    mode: null,
    ref: 'HEAD',
    allRefs: false,
    path: null,
    privateConfig: null,
    allowlistPath: DEFAULT_ALLOWLIST,
    respectGitignore: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--tracked') args.mode = 'tracked'
    else if (arg === '--staged') args.mode = 'staged'
    else if (arg === '--history') args.mode = 'history'
    else if (arg === '--all-refs') args.allRefs = true
    else if (arg === '--respect-gitignore') args.respectGitignore = true
    else if (arg === '--path') args.path = argv[++i]
    else if (arg === '--dmg-resources') {
      args.mode = 'path'
      args.path = argv[++i]
    } else if (arg === '--ref') args.ref = argv[++i]
    else if (arg === '--private-config') args.privateConfig = argv[++i]
    else if (arg === '--allowlist') args.allowlistPath = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else {
      console.error(`[scan] unknown argument: ${arg}`)
      usage()
      process.exit(2)
    }
  }
  if (!args.mode && args.path) args.mode = 'path'
  if (!args.mode) {
    usage()
    process.exit(2)
  }
  return args
}

function repoRelative(inputPath) {
  const abs = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath)
  return relative(REPO_ROOT, abs).replaceAll('\\', '/')
}

function workbenchRelative(inputPath) {
  const abs = isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath)
  return relative(WORKBENCH_ROOT, abs).replaceAll('\\', '/')
}

function isIgnoredPath(relPath) {
  const parts = relPath.split('/')
  return ignoredPathParts.some((part) => parts.includes(part))
}

function isTextFile(relPath) {
  return TEXT_EXTENSIONS.has(extname(relPath).toLowerCase())
}

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    throw new Error(`cannot read dir ${dir}: ${err.message}`)
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    const rel = workbenchRelative(full)
    if (isIgnoredPath(rel)) continue
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

function readJsonFile(path, fallback) {
  if (!path || !existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function loadAllowlist(path) {
  const rows = readJsonFile(path, [])
  return rows.map((row) => {
    if (!row.ruleId || !row.path || !row.reason || !row.owner || !(row.expires || row.reviewedAt)) {
      throw new Error(`invalid allowlist entry: ${JSON.stringify(row)}`)
    }
    return row
  })
}

function loadPrivateKeywords(path) {
  if (!path) return { loaded: false, digest: null, groups: [] }
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path)
  const raw = readFileSync(abs, 'utf-8')
  const parsed = JSON.parse(raw)
  const groups = Array.isArray(parsed.groups) ? parsed.groups : []
  const digest = createHash('sha256').update(raw).digest('hex')
  return { loaded: true, digest, groups }
}

function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*')
  return new RegExp(`^${escaped}$`)
}

function pathMatches(pattern, relPath) {
  const normalized = relPath.replaceAll('\\', '/')
  if (pattern.includes('*')) return globToRegex(pattern).test(normalized)
  return normalized === pattern || normalized.includes(pattern)
}

function isAllowed(hit, allowlist) {
  return allowlist.some((row) => row.ruleId === hit.ruleId && pathMatches(row.path, hit.path))
}

function snippet(content, offset, length) {
  const start = Math.max(0, offset - 24)
  const end = Math.min(content.length, offset + length + 48)
  return content.slice(start, end).replace(/[\r\n\t]+/g, ' ').slice(0, 96)
}

function lineForOffset(content, offset) {
  return content.slice(0, offset).split('\n').length
}

function makeHit({ ruleId, severity = 'error', path, line = 0, offset = 0, label, context = '' }) {
  return { ruleId, severity, path, line, offset, label, context }
}

function checkForbiddenFile(relPath, mode) {
  const normalized = relPath.replaceAll('\\', '/')
  const workbenchRel = normalized.startsWith('workbench/')
    ? normalized.slice('workbench/'.length)
    : normalized
  const hits = []
  for (const { label, regex } of forbiddenFilePatterns) {
    if (mode === 'path' && (label === 'build output' || label === 'release artifact dir')) {
      continue
    }
    if (regex.test(workbenchRel) || regex.test(normalized)) {
      hits.push(makeHit({
        ruleId: 'forbidden_file',
        path: normalized,
        label,
        context: normalized,
      }))
    }
  }
  return hits
}

function isAllowedIp(octets) {
  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && b === 51) return true
  if (a === 203 && b === 0) return true
  if (a >= 224) return true
  return false
}

function scanContent(relPath, content, privateGroups) {
  const hits = []
  for (const { label, regex } of PERSONAL_PATH_PATTERNS) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(content)) !== null) {
      hits.push(makeHit({
        ruleId: 'personal_path',
        path: relPath,
        line: lineForOffset(content, match.index),
        offset: match.index,
        label,
        context: snippet(content, match.index, match[0].length),
      }))
    }
  }

  const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
  let ipMatch
  while ((ipMatch = ipRegex.exec(content)) !== null) {
    const octets = ipMatch[0].split('.').map(Number)
    if (octets.some((n) => Number.isNaN(n) || n > 255)) continue
    if (isAllowedIp(octets)) continue
    hits.push(makeHit({
      ruleId: 'public_ip',
      path: relPath,
      line: lineForOffset(content, ipMatch.index),
      offset: ipMatch.index,
      label: 'public IPv4',
      context: snippet(content, ipMatch.index, ipMatch[0].length),
    }))
  }

  for (const { label, regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(content)) !== null) {
      hits.push(makeHit({
        ruleId: 'secret_pattern',
        path: relPath,
        line: lineForOffset(content, match.index),
        offset: match.index,
        label,
        context: snippet(content, match.index, match[0].length),
      }))
    }
  }

  for (const group of privateGroups) {
    for (const keyword of group.keywords ?? []) {
      if (!keyword) continue
      let index = content.indexOf(keyword)
      while (index >= 0) {
        hits.push(makeHit({
          ruleId: 'private_keyword',
          path: relPath,
          line: lineForOffset(content, index),
          offset: index,
          label: group.label ?? 'private keyword',
          context: snippet(content, index, keyword.length),
        }))
        index = content.indexOf(keyword, index + keyword.length)
      }
    }
  }

  return hits
}

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function nulList(output) {
  return output.split('\0').filter(Boolean)
}

function* trackedFiles(ref) {
  const files = nulList(git(['ls-tree', '-r', '-z', '--name-only', ref]))
  for (const file of files) {
    if (isIgnoredPath(file)) continue
    let content = null
    if (isTextFile(file)) {
      try {
        content = git(['show', `${ref}:${file}`])
      } catch {
        content = null
      }
    }
    yield { path: file, content }
  }
}

function* stagedFiles() {
  const files = nulList(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT']))
  for (const file of files) {
    if (isIgnoredPath(file)) continue
    let content = null
    if (isTextFile(file)) {
      try {
        content = git(['show', `:${file}`])
      } catch {
        content = null
      }
    }
    yield { path: file, content }
  }
}

function isGitIgnored(absPath) {
  const rel = repoRelative(absPath)
  try {
    execFileSync('git', ['check-ignore', '-q', rel], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function* pathFiles(targetPath, respectGitignore) {
  const abs = isAbsolute(targetPath) ? targetPath : resolve(process.cwd(), targetPath)
  const st = statSync(abs)
  if (!st.isDirectory()) throw new Error(`target is not a directory: ${abs}`)
  for (const file of walk(abs)) {
    if (respectGitignore && isGitIgnored(file)) continue
    const rel = repoRelative(file)
    let content = null
    if (isTextFile(rel)) content = readFileSync(file, 'utf-8')
    yield { path: rel, content }
  }
}

function* historyFiles(allRefs) {
  const refsArgs = allRefs ? ['--all'] : ['HEAD']
  const commits = git(['rev-list', ...refsArgs]).split('\n').filter(Boolean)
  const seen = new Set()
  for (const commit of commits) {
    const files = nulList(git(['ls-tree', '-r', '-z', '--name-only', commit]))
    for (const file of files) {
      if (isIgnoredPath(file)) continue
      const key = `${commit}:${file}`
      if (seen.has(key)) continue
      seen.add(key)
      let content = null
      if (isTextFile(file)) {
        try {
          content = git(['show', `${commit}:${file}`])
        } catch {
          content = null
        }
      }
      yield { path: `${commit.slice(0, 12)}:${file}`, content, filePathOnly: file }
    }
  }
}

function runScan(args) {
  const allowlist = loadAllowlist(args.allowlistPath)
  const privateConfig = loadPrivateKeywords(args.privateConfig)
  const privateGroups = [...privateKeywordGroups, ...privateConfig.groups]
  const allHits = []

  let files
  if (args.mode === 'tracked') files = trackedFiles(args.ref)
  else if (args.mode === 'staged') files = stagedFiles()
  else if (args.mode === 'path') files = pathFiles(args.path, args.respectGitignore)
  else if (args.mode === 'history') files = historyFiles(args.allRefs)
  else throw new Error(`unsupported mode: ${args.mode}`)

  for (const file of files) {
    const displayPath = file.path
    const pathOnly = file.filePathOnly ?? displayPath
    allHits.push(...checkForbiddenFile(pathOnly, args.mode))
    if (file.content !== null) {
      allHits.push(...scanContent(displayPath, file.content, privateGroups))
    }
  }

  const activeHits = []
  let allowed = 0
  for (const hit of allHits) {
    if (isAllowed(hit, allowlist)) allowed += 1
    else activeHits.push(hit)
  }

  for (const hit of activeHits) {
    const location = hit.line ? `${hit.path}:${hit.line}` : hit.path
    console.log(`${location} [${hit.ruleId}/${hit.label}] ${hit.context}`)
  }
  if (allowed > 0) console.error(`[scan] suppressed ${allowed} allowlisted finding(s)`)
  if (privateConfig.loaded) {
    console.error(`[scan] private keyword config loaded sha256=${privateConfig.digest}`)
  }
  if (activeHits.length > 0) {
    console.error(`[scan] FAIL: ${activeHits.length} public cleanliness finding(s)`)
    return 1
  }
  console.log('[scan] OK: no public cleanliness findings')
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2))
    process.exit(runScan(args))
  } catch (err) {
    console.error(`[scan] ${err.message}`)
    process.exit(2)
  }
}

export { parseArgs, runScan, scanContent, checkForbiddenFile }
