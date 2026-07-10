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

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

const root = findWorkspaceRoot()
const outDir = path.join(root, 'docs/stitch-context/screenshots')
fs.mkdirSync(outDir, { recursive: true })

const manifest = {
  generated_at: new Date().toISOString(),
  status: 'manual-capture-required',
  reason: 'Playwright/Electron screenshot capture is not configured in this workspace yet.',
  recommended_screens: [
    'dashboard',
    'chat',
    'decisions',
    'console_tasks',
    'tools_registry',
    'analytics',
    'settings_vault',
  ],
  next_step: 'Install/configure a browser automation runner, then replace this script with deterministic captures.',
}

const manifestPath = path.join(outDir, 'manifest.json')
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`Wrote ${rel(root, manifestPath)}`)
console.log('Screenshot capture is not automated yet; manifest lists required screens.')
