/**
 * VaultConfig · v0.16
 *
 * NavIcons SettingsPanel overlay 内首分区。
 * 用户决策：
 *   1. R-4 独立 SettingsView P3 视图撤销 → 改塞进既有 overlay
 *   2. 默认新用户只需要 Vault 根目录；老用户可在高级路径里接回既有 QA / Projects 目录
 *
 * 保留：
 *   - vaultRoot 输入框 + 「选择文件夹」按钮
 *   - QA / Projects / Conversations 高级路径（可填相对子目录名或绝对路径）
 *   - 「检测路径有效性」按钮（验 vault 根目录 + 派生 QA / Projects / Conversations 目录）
 *   - 「保存」按钮（vault:set-config IPC，触发广播）
 *   - fallback warning bar（vaultFallbackInfo.used 时显示）
 *
 * 样式：复用 SettingsPanel overlay 的 .settings-panel__* 类，融入 overlay 风格。
 */

import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { useVaultConfig, useVaultConfigError } from '../../store/vaultSlice'

function isAbsolutePath(p: string): boolean {
  if (p.startsWith('/')) return true
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true
  return false
}

function parentDir(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx > 0 ? trimmed.slice(0, idx) : ''
}

export function VaultConfig() {
  const config = useVaultConfig()
  const error = useVaultConfigError()
  const fallback = useStore((s) => s.vaultFallbackInfo)

  const [vaultRoot, setVaultRoot] = useState(config?.vaultRoot ?? '')
  const [qaSubdir, setQaSubdir] = useState(config?.qaSubdir ?? 'QA')
  const [projectsSubdir, setProjectsSubdir] = useState(config?.projectsSubdir ?? 'Projects')
  const [conversationsSubdir, setConversationsSubdir] = useState(config?.conversationsSubdir ?? 'Conversations')
  const [formError, setFormError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)

  // config 外部变化（IPC 广播 / 多窗口同步）时刷新本地态
  useEffect(() => {
    if (config) {
      setVaultRoot(config.vaultRoot)
      setQaSubdir(config.qaSubdir || 'QA')
      setProjectsSubdir(config.projectsSubdir || 'Projects')
      setConversationsSubdir(config.conversationsSubdir || 'Conversations')
    }
  }, [config])

  async function pickDirectory(title: string): Promise<string | null> {
    return window.api.invoke<string | null>('vault:pick-folder', { title })
  }

  async function handlePickFolder() {
    try {
      const result = await pickDirectory('选择 Vault 根目录')
      if (result && typeof result === 'string') setVaultRoot(result)
    } catch (e) {
      setFormError(`选择目录失败：${String(e)}`)
    }
  }

  async function handlePickQaFolder() {
    try {
      const result = await pickDirectory('选择 QA 对话目录')
      if (result && typeof result === 'string') setQaSubdir(result)
    } catch (e) {
      setFormError(`选择 QA 目录失败：${String(e)}`)
    }
  }

  async function handlePickProjectsFolder() {
    try {
      const result = await pickDirectory('选择 Projects 项目目录')
      if (result && typeof result === 'string') setProjectsSubdir(result)
    } catch (e) {
      setFormError(`选择 Projects 目录失败：${String(e)}`)
    }
  }

  async function handlePickConversationsFolder() {
    try {
      const result = await pickDirectory('选择 Conversations 对话目录')
      if (result && typeof result === 'string') setConversationsSubdir(result)
    } catch (e) {
      setFormError(`选择 Conversations 目录失败：${String(e)}`)
    }
  }

  function deriveDir(root: string, subdir: string): string {
    const trimmedSubdir = subdir.trim()
    if (!trimmedSubdir) return ''
    if (isAbsolutePath(trimmedSubdir)) return trimmedSubdir
    return `${root.replace(/[/\\]+$/, '')}/${trimmedSubdir.replace(/^[/\\]+/, '')}`
  }

  function deriveConversationsDir(root: string): string {
    const trimmedSubdir = conversationsSubdir.trim()
    if (
      trimmedSubdir === 'Conversations'
      && isAbsolutePath(qaSubdir)
      && isAbsolutePath(projectsSubdir)
      && parentDir(qaSubdir) === parentDir(projectsSubdir)
    ) {
      return `${parentDir(qaSubdir)}/Conversations`
    }
    return deriveDir(root, conversationsSubdir)
  }

  function validateForm(): string | null {
    const trimmed = vaultRoot.trim()
    if (!trimmed) return 'Vault 根目录不能为空'
    if (!isAbsolutePath(trimmed)) return 'Vault 根目录必须是绝对路径'
    if (!qaSubdir.trim()) return 'QA 目录不能为空'
    if (!projectsSubdir.trim()) return 'Projects 目录不能为空'
    if (!conversationsSubdir.trim()) return 'Conversations 目录不能为空'
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
      const trimmedRoot = vaultRoot.trim()
      const qaDir = deriveDir(trimmedRoot, qaSubdir)
      const projectsDir = deriveDir(trimmedRoot, projectsSubdir)
      const conversationsDir = deriveConversationsDir(trimmedRoot)
      const [rootExists, qaExists, projectsExists, conversationsExists] = await Promise.all([
        window.api.fsExists(trimmedRoot),
        window.api.fsExists(qaDir),
        window.api.fsExists(projectsDir),
        window.api.fsExists(conversationsDir),
      ])
      setValidateResult([
        `${rootExists ? '✓' : '✗'} Vault 根目录：${trimmedRoot}`,
        `${qaExists ? '✓' : '✗'} QA 对话目录：${qaDir}`,
        `${projectsExists ? '✓' : '✗'} Projects 项目目录：${projectsDir}`,
        `${conversationsExists ? '✓' : '✗'} Conversations 对话目录：${conversationsDir}`,
      ].join('\n'))
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
        conversationsSubdir: conversationsSubdir.trim() || 'Conversations',
      })
      setSaveOk(true)
    } catch (e) {
      setFormError(`保存失败：${String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      id="settings-section-vault"
      className="settings-panel__section"
    >
      <div className="settings-panel__label">Vault 配置</div>

      {fallback?.used && (
        <div
          role="alert"
          className="settings-panel__hint"
          style={{
            padding: '6px 8px',
            marginBottom: 6,
            background: 'var(--warn-bg, #fff7e6)',
            border: '1px solid var(--warn-bd, #ffd591)',
            borderRadius: 4,
            color: 'var(--warn, #874d00)',
          }}
        >
          已使用 fallback 路径：{fallback.reason}
        </div>
      )}

      <div className="settings-panel__input-row" style={{ marginBottom: 6 }}>
        <input
          id="vault-root"
          className="settings-panel__input"
          type="text"
          value={vaultRoot}
          onChange={(e) => setVaultRoot(e.target.value)}
          placeholder="选择或输入 Vault 根目录的绝对路径"
        />
        <button
          type="button"
          onClick={handlePickFolder}
          className="settings-panel__eye-btn"
          title="选择文件夹"
          aria-label="选择文件夹"
        >
          📁
        </button>
      </div>

      <div className="settings-panel__hint" style={{ marginBottom: 6 }}>
        默认使用根目录下的 <code>QA</code>、<code>Projects</code> 和 <code>Conversations</code>。如果你已有旧目录，可在下面改成绝对路径。
      </div>

      <div className="settings-panel__input-row" style={{ marginBottom: 6 }}>
        <input
          id="vault-qa-subdir"
          className="settings-panel__input"
          type="text"
          value={qaSubdir}
          onChange={(e) => setQaSubdir(e.target.value)}
          placeholder="QA 或旧 QA 目录绝对路径"
          aria-label="QA 对话目录"
        />
        <button
          type="button"
          onClick={handlePickQaFolder}
          className="settings-panel__eye-btn"
          title="选择 QA 对话目录"
          aria-label="选择 QA 对话目录"
        >
          📁
        </button>
      </div>

      <div className="settings-panel__input-row" style={{ marginBottom: 6 }}>
        <input
          id="vault-projects-subdir"
          className="settings-panel__input"
          type="text"
          value={projectsSubdir}
          onChange={(e) => setProjectsSubdir(e.target.value)}
          placeholder="Projects 或旧 Projects 目录绝对路径"
          aria-label="Projects 项目目录"
        />
        <button
          type="button"
          onClick={handlePickProjectsFolder}
          className="settings-panel__eye-btn"
          title="选择 Projects 项目目录"
          aria-label="选择 Projects 项目目录"
        >
          📁
        </button>
      </div>

      <div className="settings-panel__input-row" style={{ marginBottom: 6 }}>
        <input
          id="vault-conversations-subdir"
          className="settings-panel__input"
          type="text"
          value={conversationsSubdir}
          onChange={(e) => setConversationsSubdir(e.target.value)}
          placeholder="Conversations 或旧 Conversations 目录绝对路径"
          aria-label="Conversations 对话目录"
        />
        <button
          type="button"
          onClick={handlePickConversationsFolder}
          className="settings-panel__eye-btn"
          title="选择 Conversations 对话目录"
          aria-label="选择 Conversations 对话目录"
        >
          📁
        </button>
      </div>

      <div className="settings-panel__actions" style={{ padding: 0, borderTop: 'none', marginBottom: 6 }}>
        <button
          type="button"
          className="settings-panel__btn--clear"
          onClick={handleValidate}
          disabled={validating}
        >
          {validating ? '检测中…' : '检测有效性'}
        </button>
        <button
          type="button"
          className="settings-panel__btn--save"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {formError && (
        <div role="alert" className="settings-panel__hint" style={{ color: 'var(--err, #b91c1c)' }}>
          {formError}
        </div>
      )}
      {saveOk && (
        <div role="status" className="settings-panel__hint" style={{ color: 'var(--done, #15803d)' }}>
          已保存
        </div>
      )}
      {validateResult && (
        <pre
          className="settings-panel__hint"
          style={{
            background: 'var(--surface-2)',
            padding: 6,
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            margin: '4px 0 0',
            fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          {validateResult}
        </pre>
      )}
      {error && (
        <div className="settings-panel__hint" style={{ color: 'var(--err, #b91c1c)', marginTop: 4 }}>
          最近一次 IPC 错误：{error}
        </div>
      )}
    </div>
  )
}
