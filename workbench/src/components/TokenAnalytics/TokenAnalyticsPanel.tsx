import { useStore } from '../../store'
import { formatTokens } from '../../utils/tokenFormat'
import './TokenAnalyticsPanel.css'

interface ModelStats {
  model: string
  input: number
  output: number
  calls: number
}

export function TokenAnalyticsPanel() {
  const atoms = useStore((s) => s.atoms)

  const atomList = Object.values(atoms)
  const withUsage = atomList.filter((a) => a.usage)

  const total = withUsage.reduce(
    (acc, a) => ({
      input: acc.input + (a.usage?.input_tokens ?? 0),
      output: acc.output + (a.usage?.output_tokens ?? 0),
    }),
    { input: 0, output: 0 }
  )

  const byModel: Record<string, ModelStats> = {}
  for (const a of withUsage) {
    const m = a.model ?? 'unknown'
    if (!byModel[m]) byModel[m] = { model: m, input: 0, output: 0, calls: 0 }
    byModel[m].input += a.usage?.input_tokens ?? 0
    byModel[m].output += a.usage?.output_tokens ?? 0
    byModel[m].calls++
  }

  const modelRows = Object.values(byModel).sort((a, b) => b.input + b.output - (a.input + a.output))

  return (
    <div className="analytics-panel">
      <div className="analytics-header">Token 使用统计</div>

      <div className="analytics-summary">
        <div className="stat-card">
          <div className="stat-label">总对话数</div>
          <div className="stat-value">{atomList.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">已记录</div>
          <div className="stat-value">{withUsage.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">输入 tokens</div>
          <div className="stat-value">{formatTokens(total.input)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">输出 tokens</div>
          <div className="stat-value">{formatTokens(total.output)}</div>
        </div>
      </div>

      {modelRows.length > 0 && (
        <div className="analytics-section">
          <div className="analytics-section-title">按模型</div>
          <table className="model-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>调用次数</th>
                <th>输入</th>
                <th>输出</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map((row) => (
                <tr key={row.model}>
                  <td className="model-name">{row.model}</td>
                  <td>{row.calls}</td>
                  <td>{formatTokens(row.input)}</td>
                  <td>{formatTokens(row.output)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {withUsage.length === 0 && (
        <div className="analytics-empty">暂无 token 数据（需 v0.3 后的新对话）</div>
      )}
    </div>
  )
}
