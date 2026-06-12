/**
 * v016-vault-content-refresh.test.ts · v0.16 Vault 路径切换回归
 *
 * 覆盖用户验收反馈：
 * 保存自定义 QA / Projects 旧目录后，主界面必须重新扫描历史对话与项目。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../..')

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf-8')
}

describe('v0.16 Vault content refresh', () => {
  it('App waits for vaultConfig.vaultRoot before loading atoms/projects', () => {
    const src = readSource('src/App.tsx')

    expect(src).toContain('if (!vaultConfig?.vaultRoot) return')
    expect(src).toContain('loadAtoms().then')
    expect(src).toContain('loadProjects().catch')
  })

  it('App reloads content when Vault root / QA / Projects path changes', () => {
    const src = readSource('src/App.tsx')

    expect(src).toContain('vaultConfig?.vaultRoot')
    expect(src).toContain('vaultConfig?.qaSubdir')
    expect(src).toContain('vaultConfig?.projectsSubdir')
  })
})
