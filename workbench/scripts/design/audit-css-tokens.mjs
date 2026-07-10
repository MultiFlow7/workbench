import fs from 'node:fs'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const failOnFindings = args.has('--fail-on-findings')

function findWorkbenchRoot() {
  const cwd = process.cwd()
  if (fs.existsSync(path.join(cwd, 'src')) && fs.existsSync(path.join(cwd, 'package.json'))) {
    return cwd
  }
  const wb = path.join(cwd, 'workbench')
  if (fs.existsSync(path.join(wb, 'src')) && fs.existsSync(path.join(wb, 'package.json'))) {
    return wb
  }
  throw new Error('Cannot locate workbench root. Run from repo root or workbench/.')
}

function walk(dir, predicate) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, predicate))
    else if (predicate(full)) out.push(full)
  }
  return out.sort()
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

const workbench = findWorkbenchRoot()
const workspaceRoot = path.resolve(workbench, '..')
const generatedDir = path.join(workspaceRoot, 'docs/stitch-context/generated')
fs.mkdirSync(generatedDir, { recursive: true })
const src = path.join(workbench, 'src')
const tokensPath = path.join(src, 'styles/tokens.css')
const tokensCss = fs.readFileSync(tokensPath, 'utf8')
const knownTokens = new Set([...tokensCss.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1]))

const files = walk(src, (file) => /\.(css|tsx)$/.test(file))
const hardcodedColorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|hsla?\([^)]+\)/g
const varPattern = /var\(\s*(--[a-zA-Z0-9-]+)/g
const inlineStylePattern = /style=\{\{/g
const importantPattern = /!important\b/g
const transitionAllPattern = /transition(?:-[a-z-]+)?\s*:\s*all\b/g
const hardcodedShadowPattern = /box-shadow\s*:\s*(?!var\()[^;]+/g
const zIndexPattern = /z-index\s*:\s*(-?\d+)/g

const findings = []

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const fileRel = rel(workbench, file)
  const isTokensFile = fileRel === 'src/styles/tokens.css'

  if (!isTokensFile) {
    for (const match of text.matchAll(hardcodedColorPattern)) {
      findings.push({
        type: 'hardcoded-color',
        file: fileRel,
        line: lineNumber(text, match.index ?? 0),
        value: match[0],
      })
    }
  }

  for (const match of text.matchAll(varPattern)) {
    const token = match[1]
    if (!knownTokens.has(token)) {
      findings.push({
        type: 'unknown-token',
        file: fileRel,
        line: lineNumber(text, match.index ?? 0),
        value: token,
      })
    }
  }

  if (/\.tsx$/.test(file)) {
    for (const match of text.matchAll(inlineStylePattern)) {
      findings.push({
        type: 'inline-style',
        file: fileRel,
        line: lineNumber(text, match.index ?? 0),
        value: 'style={{...}}',
      })
    }
  }

  for (const match of text.matchAll(importantPattern)) {
    findings.push({
      type: 'important',
      file: fileRel,
      line: lineNumber(text, match.index ?? 0),
      value: '!important',
    })
  }

  for (const match of text.matchAll(transitionAllPattern)) {
    findings.push({
      type: 'transition-all',
      file: fileRel,
      line: lineNumber(text, match.index ?? 0),
      value: match[0],
    })
  }

  for (const match of text.matchAll(hardcodedShadowPattern)) {
    findings.push({
      type: 'hardcoded-shadow',
      file: fileRel,
      line: lineNumber(text, match.index ?? 0),
      value: match[0].trim(),
    })
  }

  for (const match of text.matchAll(zIndexPattern)) {
    const value = Number(match[1])
    if (Math.abs(value) >= 100) {
      findings.push({
        type: 'large-z-index',
        file: fileRel,
        line: lineNumber(text, match.index ?? 0),
        value: match[0],
      })
    }
  }
}

const groups = findings.reduce((acc, item) => {
  acc[item.type] = (acc[item.type] ?? 0) + 1
  return acc
}, {})

const summaryLines = [
  '# Design Token Audit',
  '',
  `Generated at: ${new Date().toISOString()}`,
  '',
  `Known tokens: ${knownTokens.size}`,
  `Scanned files: ${files.length}`,
  `Findings: ${findings.length}`,
  '',
]

for (const [type, count] of Object.entries(groups)) {
  summaryLines.push(`- ${type}: ${count}`)
}

if (findings.length > 0) {
  summaryLines.push('', '## Findings')
  for (const item of findings.slice(0, 200)) {
    summaryLines.push(`- \`${item.type}\` ${item.file}:${item.line} \`${item.value.replace(/`/g, '\\`')}\``)
  }
  if (findings.length > 200) {
    summaryLines.push(`- ${findings.length - 200} more findings omitted`)
  }
}

const auditJson = {
  generated_at: new Date().toISOString(),
  known_tokens: knownTokens.size,
  scanned_files: files.length,
  finding_count: findings.length,
  groups,
  findings,
}

const jsonFile = path.join(generatedDir, 'style-audit.json')
const mdFile = path.join(generatedDir, 'style-audit.md')
fs.writeFileSync(jsonFile, `${JSON.stringify(auditJson, null, 2)}\n`, 'utf8')
fs.writeFileSync(mdFile, `${summaryLines.join('\n')}\n`, 'utf8')

console.log(summaryLines.join('\n'))
console.log('')
console.log(`Wrote ${rel(workspaceRoot, jsonFile)}`)
console.log(`Wrote ${rel(workspaceRoot, mdFile)}`)

if (findings.length > 0 && failOnFindings) {
  process.exitCode = 1
}
