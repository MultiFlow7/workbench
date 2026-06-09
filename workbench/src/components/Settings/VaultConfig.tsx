/**
 * VaultConfig · v0.16 节点 R-4
 *
 * Settings 视图「Vault 配置」分区（置顶第一项）。
 * - vaultRoot 输入框 + 「选择文件夹」按钮（vault:pick-folder IPC）
 * - qaSubdir / projectsSubdir 输入框（支持相对名或绝对路径）
 * - 「检测路径有效性」按钮（window.api.fsExists）
 * - 「保存」按钮（vault:set-config IPC，触发广播）
 * - fallback warning bar（vaultFallbackInfo.used 时显示）
 */

import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { useVaultConfig, useVaultConfigError } from '../../store/vaultSlice'

function isAbsolutePath(p: string): boolean {
  if (p.startsWith('/')) return true
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true
  return false
}

export function VaultConfig() {
  const config = useVaultConfig()
  const error = useVaultConfigError()
  const fallback = useStore((s) => s.vaultFallbackInfo)

  const [vaultRoot, setVaultRoot] = useState(config?.vaultRoot ?? '')
  const [qaSubdir, setQaSubdir] = useState(config?.qaSubdir ?? 'QA')
  const [projectsSubdir, setProjectsSubdir] = useState(config?.projectsSubdir ?? 'Projects')
  const [formError, setFormError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)

  // config 外部变化（IPC 广播 / 多窗口同步）时刷新本地态
  useEffect(() => {
    if (config) {
      setVaultRoot(config.vaultRoot)
      setQaSubdir(config.qaSubdir)
      setProjectsSubdir(config.projectsSubdir)
    }
  }, [config])

  async function handlePickFolder() {
    try {
      const result = await window.api.invoke<string | null>('vault:pick-folder', {
        title: '选择 Vault 根目录',
      })
      if (result && typeof result === 'string') setVaultRoot(result)
    } catch (e) {
      setFormError(`选择目录失败：${String(e)}`)
    }
  }

  function validateForm(): string | null {
    if (!vaultRoot.trim()) return 'Vault 根目录不能为空'
    if (qaSubdir.includes('..')) return 'QA 子目录不能含 ".." 段'
    if (projectsSubdir.includes('..')) return 'Projects 子目录不能含 ".." 段'
    return null
  }

  async function handleValidate() {
    const err = validateForm()
    if (err) {
      setValidateResult(`表单错误：${err}`)
      return
    }
    setValidating(true)
    setValidateResult(null)
    try {
      const qaDir = isAbsolutePath(qaSubdir) ? qaSubdir : `${vaultRoot}/${qaSubdir}`
      const projDir = isAbsolutePath(projectsSubdir)
        ? projectsSubdir
        : `${vaultRoot}/${projectsSubdir}`
      const targets = [
        { label: 'Vault 根目录', path: vaultRoot },
        { label: 'QA 目录', path: qaDir },
        { label: 'Projects 目录', path: projDir },
      ]
      const results: string[] = []
      for (const t of targets) {
        const exists = await window.api.fsExists(t.path)
        results.push(`${exists ? '✓' : '✗'} ${t.label}：${t.path}`)
      }
      setValidateResult(results.join('\n'))
    } catch (e) {
      setValidateResult(`检测失败：${String(e)}`)
    } finally {
      setValidating(false)
    }
  }

  async function handleSave() {
    const err = validateForm()
    if (err) {
      setFormError(err)
      setSaveOk(false)
      return
    }
    setFormError(null)
    setSaving(true)
    setSaveOk(false)
    try {
      await useStore.getState().setVaultConfig({
        vaultRoot: vaultRoot.trim(),
        qaSubdir: qaSubdir.trim() || 'QA',
        projectsSubdir: projectsSubdir.trim() || 'Projects',
      })
      setSaveOk(true)
    } catch (e) {
      setFormError(`保存失败：${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="settings-section-vault" className="settings-section vault-config">
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Vault 配置</h2>

      {fallback?.used && (
        <div
          role="alert"
          className="vault-fallback-warning"
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            background: '#fff7e6',
            border: '1px solid #ffd591',
            borderRadius: 4,
            color: '#874d00',
            fontSize: 12,
          }}
        >
          已使用 fallback 路径：{fallback.reason}
        </div>
      )}

      <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label htmlFor="vault-root" style={{ minWidth: 100, fontSize: 13 }}>
          Vault 根目录
        </label>
        <input
          id="vault-root"
          type="text"
          value={vaultRoot}
          onChange={(e) => setVaultRoot(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', fontSize: 13, border: '1px solid var(--bd, #e4e4e7)', borderRadius: 4 }}
        />
        <button type="button" onClick={handlePickFolder} style={{ padding: '4px 12px', fontSize: 13 }}>
          选择文件夹
        </button>
      </div>

      <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label htmlFor="qa-subdir" style={{ minWidth: 100, fontSize: 13 }}>
          QA 子目录
        </label>
        <input
          id="qa-subdir"
          type="text"
          value={qaSubdir}
          onChange={(e) => setQaSubdir(e.target.value)}
          placeholder="相对子目录名（推荐）或绝对路径"
          style={{ flex: 1, padding: '4px 8px', fontSize: 13, border: '1px solid var(--bd, #e4e4e7)', borderRadius: 4 }}
        />
      </div>

      <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <label htmlFor="projects-subdir" style={{ minWidth: 100, fontSize: 13 }}>
          Projects 子目录
        </label>
        <input
          id="projects-subdir"
          type="text"
          value={projectsSubdir}
          onChange={(e) => setProjectsSubdir(e.target.value)}
          placeholder="相对子目录名（推荐）或绝对路径"
          style={{ flex: 1, padding: '4px 8px', fontSize: 13, border: '1px solid var(--bd, #e4e4e7)', borderRadius: 4 }}
        />
      </div>

      <div className="form-actions" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={handleValidate} disabled={validating} style={{ padding: '6px 14px', fontSize: 13 }}>
          {validating ? '检测中...' : '检测路径有效性'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '6px 14px',
            fontSize: 13,
            background: 'var(--accent, #2563eb)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {formError && (
        <div className="form-error" role="alert" style={{ color: '#b91c1c', fontSize: 12, marginBottom: 8 }}>
          {formError}
        </div>
      )}
      {saveOk && (
        <div role="status" style={{ color: '#15803d', fontSize: 12, marginBottom: 8 }}>
          已保存
        </div>
      )}
      {validateResult && (
        <pre
          className="validate-result"
          style={{
            background: '#f5f5f5',
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}
        >
          {validateResult}
        </pre>
      )}
      {error && (
        <div className="store-error" style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>
          最近一次 IPC 错误：{error}
        </div>
      )}
    </section>
  )
}
