import fs from 'node:fs'
import path from 'node:path'

function findWorkspaceRoot() {
  const cwd = process.cwd()
  if (fs.existsSync(path.join(cwd, 'workbench')) && fs.existsSync(path.join(cwd, 'docs'))) {
    return cwd
  }
  const parent = path.resolve(cwd, '..')
  if (fs.existsSync(path.join(parent, 'workbench')) && fs.existsSync(path.join(parent, 'docs'))) {
    return parent
  }
  throw new Error('Cannot locate workspace root. Run from repo root or workbench/.')
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

const root = findWorkspaceRoot()
const generatedDir = path.join(root, 'docs/stitch-context/generated')
const required = [
  'stitch-context.md',
  'tokens.json',
  'manifest.json',
  'style-audit.json',
  'style-audit.md',
]

const errors = []

for (const file of required) {
  const full = path.join(generatedDir, file)
  if (!fs.existsSync(full)) errors.push(`Missing required file: ${rel(root, full)}`)
}

const forbiddenPathPatterns = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)release(\/|$)/,
  /\.(dmg|exe|appimage|sqlite|sqlite3|db|log|jsonl)$/i,
]

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /anthropic[a-zA-Z0-9_-]*key/i,
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
  /\/Users\/[^/\s]+/,
]

for (const file of walk(generatedDir)) {
  const fileRel = rel(root, file)
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(fileRel)) {
      errors.push(`Forbidden generated path: ${fileRel}`)
    }
  }

  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) {
      errors.push(`Potential sensitive content in ${fileRel}: ${pattern}`)
    }
  }
}

if (errors.length > 0) {
  console.error('# Stitch Context Verification Failed')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('# Stitch Context Verification Passed')
  console.log(`Checked ${walk(generatedDir).length} generated files.`)
}
