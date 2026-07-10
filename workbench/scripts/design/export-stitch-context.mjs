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

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : ''
}

function listFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...listFiles(full, predicate))
    } else if (predicate(full)) {
      out.push(full)
    }
  }
  return out.sort()
}

function extractTokens(tokensCss) {
  const tokenPattern = /^\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/gm
  const tokens = []
  let match
  while ((match = tokenPattern.exec(tokensCss)) !== null) {
    tokens.push({ name: match[1], value: match[2].trim() })
  }
  return tokens
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

const root = findWorkspaceRoot()
const workbench = path.join(root, 'workbench')
const docs = path.join(root, 'docs')
const stitchDir = path.join(docs, 'stitch-context')
const generatedDir = path.join(stitchDir, 'generated')
fs.mkdirSync(generatedDir, { recursive: true })

const tokensCssPath = path.join(workbench, 'src/styles/tokens.css')
const tokensCss = readIfExists(tokensCssPath)
const tokens = extractTokens(tokensCss)

const componentFiles = listFiles(path.join(workbench, 'src/components'), (file) =>
  /\.(tsx|css)$/.test(file)
)

const packageJson = JSON.parse(readIfExists(path.join(workbench, 'package.json')) || '{}')

const manifest = {
  generated_at: new Date().toISOString(),
  package: packageJson.name ?? 'unknown',
  version: packageJson.version ?? 'unknown',
  source_files: [
    'docs/design-system.md',
    'docs/stitch-context/DESIGN.md',
    'docs/stitch-context/stitch-brief.md',
    'docs/stitch-context/component-map.md',
    'workbench/src/styles/tokens.css',
    'workbench/package.json',
  ],
  outputs: [
    'docs/stitch-context/generated/stitch-context.md',
    'docs/stitch-context/generated/tokens.json',
    'docs/stitch-context/generated/manifest.json',
  ],
  boundaries: [
    'visual-refresh-only',
    'no-product-redefinition',
    'no-full-repo-export',
    'map-output-to-existing-components',
  ],
}

const sections = [
  '# Stitch Context Pack: 工作台 GUI 视觉翻新',
  '',
  '> 自动生成文件。不要手工编辑；请运行 `pnpm design:stitch-context` 重新生成。',
  '',
  `Generated at: ${manifest.generated_at}`,
  '',
  '## 1. Product Brief',
  '',
  readIfExists(path.join(stitchDir, 'stitch-brief.md')),
  '',
  '## 2. Design System',
  '',
  readIfExists(path.join(docs, 'design-system.md')),
  '',
  '## 3. Stitch Visual Rules',
  '',
  readIfExists(path.join(stitchDir, 'DESIGN.md')),
  '',
  '## 4. Component Map',
  '',
  readIfExists(path.join(stitchDir, 'component-map.md')),
  '',
  '## 5. Token Snapshot',
  '',
  `Source: \`${relative(root, tokensCssPath)}\``,
  '',
  '| Token | Value |',
  '|---|---|',
  ...tokens.map((token) => `| \`${token.name}\` | \`${token.value.replace(/\|/g, '\\|')}\` |`),
  '',
  '## 6. Frontend Stack',
  '',
  `- Package: \`${packageJson.name ?? 'unknown'}\``,
  `- Version: \`${packageJson.version ?? 'unknown'}\``,
  '- Runtime: Electron + React + Zustand',
  '- Styling: component CSS + global design tokens',
  '',
  '## 7. Component File Inventory',
  '',
  ...componentFiles.map((file) => `- \`${relative(root, file)}\``),
  '',
  '## 8. Use With Stitch',
  '',
  'Ask Stitch to treat this file as design context only. It may propose visual refreshes, but all output must map back to the component map and design system above.',
]

const outFile = path.join(generatedDir, 'stitch-context.md')
fs.writeFileSync(outFile, sections.join('\n'), 'utf8')

const tokensFile = path.join(generatedDir, 'tokens.json')
fs.writeFileSync(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8')

const manifestFile = path.join(generatedDir, 'manifest.json')
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`Wrote ${relative(root, outFile)}`)
console.log(`Wrote ${relative(root, tokensFile)}`)
console.log(`Wrote ${relative(root, manifestFile)}`)
console.log(`Tokens: ${tokens.length}`)
console.log(`Component files: ${componentFiles.length}`)
