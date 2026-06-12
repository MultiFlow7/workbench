#!/usr/bin/env node
/**
 * scan-personal-paths.mjs · 个人化路径扫描器（v0.16 节点 CI-1，req-063）
 *
 * 递归扫描构建产物中是否含三大平台的用户家目录前缀。命中即非零退出，
 * 用于 CI verification step 卡住「OSS 零个人信息泄露」原则破坏。
 *
 * 用法：
 *   node scan-personal-paths.mjs [targetDir]
 *
 * 默认 targetDir = <脚本所在目录>/../out （即 workbench/out/）。
 * dmg 解包验证场景手动传 Resources 路径。
 *
 * 退出码：
 *   0 = 无命中（OK）
 *   1 = 有命中（FAIL，stdout 列出文件路径 + 字节偏移 + 60 字符上下文）
 *   2 = 参数 / IO 错误（用户错误，非 OSS 泄露）
 *
 * 实现原则：
 * - 零外部依赖（仅 Node 18+ 内置 fs / path / process / url）
 * - 仅扫文本文件（按扩展名白名单），跳过二进制
 * - 跨平台一致行为：纯 JS 正则，不调 grep / shell
 *
 * 已知豁免：初版不引入 allowlist。若 CI 运行中遇到 source map 含 GitHub
 * Actions `/home/runner/` 等运行环境路径，按下方 KNOWN_FALSE_POSITIVES
 * 数组手工添加豁免（首次构建后视情况再决策）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── 配置 ───────────────────────────────────────────────────────────────────

// 仅扫描文本文件（按扩展名白名单），跳过二进制如 .ico / .png / .so / .node
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.html',
  '.css',
  '.json',
  '.txt',
  '.md',
  '.map',
  '.py',
  '.toml',
  '.yaml',
  '.yml',
  '.ini',
  '.cfg',
])

// 三平台用户家目录前缀正则
// macOS: /Users/<name>
// Windows: C:\Users\<name>（双反斜杠在 JS 字符串中表示单个反斜杠）
// Linux: /home/<name>
// <name> 段允许的字符：除路径分隔符与典型 token 终止符（空格、引号、括号、反引号、方括号）
// Windows 注意：build 产物（JS / source map）中的 Windows 路径常被 JSON 转义为
// 双反斜杠（如 `"C:\\Users\\name"`）；同时部分 source map 包含 forward-slash 形式
// （如 `C:/Users/name`）。本 regex 同时覆盖三种形态：
//   C:\Users\name        （raw 单反斜杠）
//   C:\\Users\\name      （JSON 转义双反斜杠）
//   C:/Users/name        （Unix-style forward-slash）
const PATTERNS = [
  { name: 'macOS', regex: /\/Users\/[^/\s'"`)\]<>]+/g },
  { name: 'Windows', regex: /[A-Z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s'"`)\]<>]+/g },
  { name: 'Linux', regex: /\/home\/[^/\s'"`)\]<>]+/g },
]

// 已知误报豁免（初版为空）
const KNOWN_FALSE_POSITIVES = []

// ─── 工具函数 ───────────────────────────────────────────────────────────────

function isTextFile(filePath) {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot < 0) return false
  const ext = filePath.slice(lastDot).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    console.error(`[scan] cannot read dir ${dir}: ${e.message}`)
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

function snippet(content, offset, hitLen) {
  const start = Math.max(0, offset - 20)
  const end = Math.min(content.length, offset + hitLen + 40)
  return content
    .slice(start, end)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 60)
}

function isFalsePositive(hit) {
  return KNOWN_FALSE_POSITIVES.some((rule) => rule.test(hit))
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

function main() {
  const argTarget = process.argv[2]
  const targetDir = argTarget
    ? pathResolve(argTarget)
    : pathResolve(__dirname, '..', 'out')

  let dirStat
  try {
    dirStat = statSync(targetDir)
  } catch {
    console.error(`[scan] target dir not found: ${targetDir}`)
    process.exit(2)
  }
  if (!dirStat.isDirectory()) {
    console.error(`[scan] target is not a directory: ${targetDir}`)
    process.exit(2)
  }

  let totalHits = 0
  let totalFalsePositives = 0

  for (const filePath of walk(targetDir)) {
    if (!isTextFile(filePath)) continue
    let content
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      continue // 跳过读取失败（可能是 dangling symlink 等）
    }
    for (const { name, regex } of PATTERNS) {
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(content)) !== null) {
        const hit = match[0]
        if (isFalsePositive(hit)) {
          totalFalsePositives += 1
          continue
        }
        const rel = relative(targetDir, filePath)
        const ctx = snippet(content, match.index, hit.length)
        // eslint-disable-next-line no-console
        console.log(`${rel}:${match.index} [${name}] ${ctx}`)
        totalHits += 1
      }
    }
  }

  if (totalFalsePositives > 0) {
    console.error(`[scan] suppressed ${totalFalsePositives} false-positive(s) by allowlist`)
  }

  if (totalHits > 0) {
    console.error(`[scan] FAIL: found ${totalHits} personal path(s) in ${targetDir}`)
    process.exit(1)
  }

  console.log(`[scan] OK: no personal paths found in ${targetDir}`)
  process.exit(0)
}

main()
