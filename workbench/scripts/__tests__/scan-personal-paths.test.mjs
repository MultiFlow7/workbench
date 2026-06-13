#!/usr/bin/env node
/**
 * Self-test for scan-personal-paths.mjs（v0.16 节点 CI-1，req-063）
 *
 * 覆盖 technical.md「测试清单 · 单元测试」中：
 *   T-V016-U5 命中样本（macOS）
 *   T-V016-U6 clean fixture 通过
 *   T-V016-U7 三平台 pattern 同时识别
 *
 * 用 Node 内置 assert + child_process 子进程跑脚本，验证退出码与 stdout。
 * 不依赖 vitest——CI 上独立 `node scripts/__tests__/scan-personal-paths.test.mjs`
 * 即可跑通（保持 CI-1 脚本零外部依赖原则）。
 *
 * 退出码 0 = 全部 pass；非 0 = 至少一个用例失败。
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPT = join(__dirname, '..', 'scan-personal-paths.mjs')

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
    passed += 1
  } else {
    console.error(`  ✗ ${msg}`)
    failed += 1
  }
}

function runScan(targetDir) {
  try {
    const stdout = execFileSync('node', [SCRIPT, targetDir], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    }
  }
}

function setupFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-scan-fixture-'))
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

// ─── T-V016-U6: clean fixture 通过 ─────────────────────────────────────────
console.log('T-V016-U6 clean fixture 通过')
{
  const dir = setupFixture()
  writeFileSync(join(dir, 'clean.js'), 'const x = "no personal data here"\nexport default x')
  writeFileSync(join(dir, 'clean.html'), '<!doctype html><body>OK</body>')
  const result = runScan(dir)
  assert(result.code === 0, '退出码 0')
  assert(result.stdout.includes('[scan] OK'), 'stdout 含 OK 提示')
  cleanup(dir)
}

// ─── T-V016-U5: 含 macOS 个人路径命中 ──────────────────────────────────────
console.log('T-V016-U5 命中样本（macOS）')
{
  const dir = setupFixture()
  writeFileSync(join(dir, 'dirty.js'), 'const path = "/Users/testuser/Desktop/foo.md"\nexport default path')
  const result = runScan(dir)
  assert(result.code === 1, '退出码 1')
  assert(result.stdout.includes('/Users/testuser'), 'stdout 含命中字符串')
  assert(result.stdout.includes('personal_path'), 'stdout 含 personal_path 规则')
  assert(/dirty\.js:\d+/.test(result.stdout), 'stdout 含文件名:偏移格式')
  cleanup(dir)
}

// ─── Python sidecar: .py 文件个人路径命中 ─────────────────────────────────
console.log('Python sidecar .py 文件命中')
{
  const dir = setupFixture()
  writeFileSync(join(dir, 'service.py'), 'DEFAULT_MODEL_PATH = "/Users/pythonuser/models/local"\n')
  const result = runScan(dir)
  assert(result.code === 1, '退出码 1')
  assert(result.stdout.includes('/Users/pythonuser'), 'stdout 含 Python 文件命中字符串')
  assert(/service\.py:\d+/.test(result.stdout), 'stdout 含 .py 文件名:偏移格式')
  cleanup(dir)
}

// ─── T-V016-U7: 三平台 pattern 同时识别 ────────────────────────────────────
console.log('T-V016-U7 三平台 pattern')
{
  const dir = setupFixture()
  const triple = [
    'const a = "/Users/alice/foo"',
    'const b = "C:\\\\Users\\\\bob\\\\bar"',
    'const c = "/home/charlie/baz"',
  ].join('\n')
  writeFileSync(join(dir, 'triple.js'), triple)
  const result = runScan(dir)
  assert(result.code === 1, '退出码 1')
  assert(result.stdout.includes('macOS home path'), 'macOS 平台被识别')
  assert(result.stdout.includes('Windows home path'), 'Windows 平台被识别')
  assert(result.stdout.includes('Linux home path'), 'Linux 平台被识别')
  cleanup(dir)
}

// ─── 边界：跳过二进制扩展名 ────────────────────────────────────────────────
console.log('扩展名白名单：跳过二进制')
{
  const dir = setupFixture()
  // .png 不在白名单 — 即使含命中字符串也不扫
  writeFileSync(join(dir, 'image.png'), '/Users/should-be-ignored')
  // .js 应当扫
  writeFileSync(join(dir, 'real.js'), 'const x = "/Users/should-be-found"')
  const result = runScan(dir)
  assert(result.code === 1, '退出码 1（.js 命中）')
  assert(!result.stdout.includes('should-be-ignored'), 'png 内容未被扫')
  assert(result.stdout.includes('should-be-found'), '.js 内容被扫')
  cleanup(dir)
}

// ─── 边界：递归子目录 ──────────────────────────────────────────────────────
console.log('递归子目录')
{
  const dir = setupFixture()
  mkdirSync(join(dir, 'nested', 'deep'), { recursive: true })
  writeFileSync(join(dir, 'nested', 'deep', 'leak.js'), 'export default "/Users/leakuser"')
  const result = runScan(dir)
  assert(result.code === 1, '退出码 1')
  assert(result.stdout.includes('nested/deep/leak.js') || result.stdout.includes('nested\\deep\\leak.js'), '相对路径含子目录')
  cleanup(dir)
}

// ─── 边界：target 不存在 ──────────────────────────────────────────────────
console.log('错误处理：target 不存在')
{
  const result = runScan(join(tmpdir(), 'does-not-exist-' + Date.now()))
  assert(result.code === 2, '退出码 2 表示用户错误（非泄露）')
  assert(result.stderr.includes('ENOENT') || result.stderr.includes('not found'), 'stderr 含友好错误')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
