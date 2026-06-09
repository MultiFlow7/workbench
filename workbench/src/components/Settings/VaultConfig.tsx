/**
 * VaultConfig · v0.16 (QA 阶段重塑)
 *
 * NavIcons SettingsPanel overlay 内首分区。
 * 用户决策 (2026-06-08)：
 *   1. R-4 独立 SettingsView P3 视图撤销 → 改塞进既有 overlay
 *   2. QA / Projects 子目录字段砍掉（用户不会调） → 仅暴露 vault 根目录
 *      hardcode 默认值 'QA' / 'Projects' 写在 vaultStore 默认值层，UI 不再展示。
 *
 * 保留：
 *   - vaultRoot 输入框 + 「选择文件夹」按钮
 *   - 「检测路径有效性」按钮（只验 vault 根目录可读性）
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

export function VaultConfig() {
  const config = useVaultConfig()
  const error = useVaultConfigError()
  const fallback = useStore((s) => s.vaultFallbackInfo)

  const [vaultRoot, setVaultRoot] = useState(config?.vaultRoot ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)

  // config 外部变化（IPC 广播 / 多窗口同步）时刷新本地态
  useEffect(() => {
    if (config) {
      setVaultRoot(config.vaultRoot)
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
    const trimmed = vaultRoot.trim()
    if (!trimmed) return 'Vault 根目录不能为空'
    if (!isAbsolutePath(trimmed)) return 'Vault 根目录必须是绝对路径'
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
      const exists = await window.api.fsExists(vaultRoot.trim())
      setValidateResult(`${exists ? '✓' : '✗'} Vault 根目录：${vaultRoot.trim()}`)
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
      // QA / Projects 子目录不再暴露给用户，保持 store 既有值（默认 'QA' / 'Projects'）
      await useStore.getState().setVaultConfig({
        vaultRoot: vaultRoot.trim(),
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
