#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPT = join(__dirname, '..', 'scan-public-cleanliness.mjs')

let passed = 0
let failed = 0

function assert(cond, message) {
  if (cond) {
    console.log(`  ✓ ${message}`)
    passed += 1
  } else {
    console.error(`  ✗ ${message}`)
    failed += 1
  }
}

function tmpFixture() {
  return mkdtempSync(join(tmpdir(), 'wb-clean-scan-'))
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true })
}

function runScan(args) {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    code: result.status ?? 1,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  }
}

console.log('clean fixture')
{
  const dir = tmpFixture()
  writeFileSync(join(dir, 'clean.js'), 'const host = "127.0.0.1"\n')
  const result = runScan(['--path', dir])
  assert(result.code === 0, 'clean dir passes')
  assert(result.stdout.includes('OK'), 'prints OK')
  cleanup(dir)
}

console.log('personal path')
{
  const dir = tmpFixture()
  writeFileSync(join(dir, 'dirty.js'), 'const p = "/Users/testuser/Desktop/file.md"\n')
  const result = runScan(['--path', dir])
  assert(result.code === 1, 'personal path fails')
  assert(result.stdout.includes('personal_path'), 'reports personal_path')
  cleanup(dir)
}

console.log('public IP')
{
  const dir = tmpFixture()
  writeFileSync(join(dir, 'ip.md'), 'server = "8.8.8.8"\nlocalhost = "127.0.0.1"\n')
  const result = runScan(['--path', dir])
  assert(result.code === 1, 'public IP fails')
  assert(result.stdout.includes('8.8.8.8'), 'reports public IP')
  assert(!result.stdout.includes('[public_ip/public IPv4] localhost'), 'allows localhost')
  cleanup(dir)
}

console.log('secret pattern')
{
  const dir = tmpFixture()
  writeFileSync(join(dir, 'secret.txt'), 'Authorization: Bearer very-secret-token-value\n')
  const result = runScan(['--path', dir])
  assert(result.code === 1, 'secret fails')
  assert(result.stdout.includes('secret_pattern'), 'reports secret pattern')
  cleanup(dir)
}

console.log('forbidden file')
{
  const dir = tmpFixture()
  writeFileSync(join(dir, '.env'), 'TOKEN=placeholder\n')
  const result = runScan(['--path', dir])
  assert(result.code === 1, 'forbidden file fails')
  assert(result.stdout.includes('forbidden_file'), 'reports forbidden file')
  cleanup(dir)
}

console.log('private keyword')
{
  const dir = tmpFixture()
  writeFileSync(join(dir, 'internal.md'), 'docs/superpowers/plans should not be public\n')
  const result = runScan(['--path', dir])
  assert(result.code === 1, 'private keyword fails')
  assert(result.stdout.includes('private_keyword'), 'reports private keyword')
  cleanup(dir)
}

console.log('private config')
{
  const dir = tmpFixture()
  const config = join(dir, 'private.json')
  writeFileSync(config, JSON.stringify({ groups: [{ label: 'private', keywords: ['PRIVATE_LOCAL_WORD'] }] }))
  writeFileSync(join(dir, 'doc.md'), 'PRIVATE_LOCAL_WORD\n')
  const result = runScan(['--path', dir, '--private-config', config])
  assert(result.code === 1, 'private config keyword fails')
  assert(result.stderr.includes('private keyword config loaded sha256='), 'prints private config digest')
  cleanup(dir)
}

console.log('allowlist metadata')
{
  const dir = tmpFixture()
  const allowlist = join(dir, 'allow.json')
  writeFileSync(join(dir, 'dirty.js'), 'const p = "/Users/testuser/Desktop/file.md"\n')
  writeFileSync(allowlist, JSON.stringify([
    {
      ruleId: 'personal_path',
      path: 'dirty.js',
      reason: 'fixture',
      owner: 'release-security',
      reviewedAt: '2026-06-13',
    },
  ]))
  const result = runScan(['--path', dir, '--allowlist', allowlist])
  assert(result.code === 0, 'allowlisted finding passes')
  assert(result.stderr.includes('suppressed 1'), 'prints suppression count')
  cleanup(dir)
}

console.log('recursive dirs')
{
  const dir = tmpFixture()
  mkdirSync(join(dir, 'nested'), { recursive: true })
  writeFileSync(join(dir, 'nested', 'leak.py'), 'HOME = "/home/example/project"\n')
  const result = runScan(['--path', dir])
  assert(result.code === 1, 'recursive finding fails')
  assert(result.stdout.includes('nested'), 'reports nested path')
  cleanup(dir)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
