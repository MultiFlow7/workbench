/**
 * TokenLine — v0.15.1 节点 1.5
 *
 * 显示 in / out / cached / cost 四项 Token 统计。
 * v0.15.1 中 cached / cost 字段在数据层尚未采集 → 占位 `--`。
 */

import './TokenLine.css'

export interface TokenLineUsage {
  input?: number
  output?: number
  cached?: number
  cost?: number
}

function fmt(v: number | undefined): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '--'
  return String(v)
}

function fmtCost(v: number | undefined): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '--'
  return `$${v.toFixed(4)}`
}

export function TokenLine({ usage }: { usage: TokenLineUsage }) {
  return (
    <div className="token-line">
      <span className="token-line__item">
        <span className="token-line__label">in:</span>
        <span className="token-line__value">{fmt(usage.input)}</span>
      </span>
      <span className="token-line__sep">·</span>
      <span className="token-line__item">
        <span className="token-line__label">out:</span>
        <span className="token-line__value">{fmt(usage.output)}</span>
      </span>
      <span className="token-line__sep">·</span>
      <span className="token-line__item">
        <span className="token-line__label">cached:</span>
        <span className="token-line__value">{fmt(usage.cached)}</span>
      </span>
      <span className="token-line__sep">·</span>
      <span className="token-line__item">
        <span className="token-line__label">cost:</span>
        <span className="token-line__value">{usage.cost !== undefined ? fmtCost(usage.cost) : '--'}</span>
      </span>
    </div>
  )
}
