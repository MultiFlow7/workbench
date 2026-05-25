import { DayModelBucket } from '../../utils/tokenAggregation'
import { formatTokens } from '../../utils/tokenFormat'

interface TokenTimeChartProps {
  buckets: DayModelBucket[]
  granularity: 'day' | 'week' | 'month'
  onGranularityChange: (g: 'day' | 'week' | 'month') => void
}

const MODEL_COLORS = ['#2563eb', '#16a34a', '#ea580c', '#6b7280']

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)))
  const year = thursday.getUTCFullYear()
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

function groupByGranularity(
  buckets: DayModelBucket[],
  granularity: 'day' | 'week' | 'month',
): Map<string, DayModelBucket[]> {
  const map = new Map<string, DayModelBucket[]>()
  for (const b of buckets) {
    const label =
      granularity === 'day' ? b.date :
      granularity === 'week' ? getWeekLabel(b.date) :
      b.date.slice(0, 7)
    const existing = map.get(label) ?? []
    existing.push(b)
    map.set(label, existing)
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

function computeChartPoints(grouped: Map<string, DayModelBucket[]>) {
  // Collect total tokens per model across all time points
  const modelTotals = new Map<string, number>()
  for (const buckets of grouped.values()) {
    for (const b of buckets) {
      modelTotals.set(b.model, (modelTotals.get(b.model) ?? 0) + b.inputTokens + b.outputTokens)
    }
  }

  const sortedModels = [...modelTotals.entries()].sort((a, b) => b[1] - a[1])
  const topModels = sortedModels.slice(0, 3).map(([m]) => m)
  const hasOther = sortedModels.length > 3

  const labels = [...grouped.keys()]
  const points = labels.map((label) => {
    const buckets = grouped.get(label) ?? []
    const values: number[] = topModels.map((m) =>
      buckets
        .filter((b) => b.model === m)
        .reduce((s, b) => s + b.inputTokens + b.outputTokens, 0)
    )
    if (hasOther) {
      const otherTokens = buckets
        .filter((b) => !topModels.includes(b.model))
        .reduce((s, b) => s + b.inputTokens + b.outputTokens, 0)
      values.push(otherTokens)
    }
    return { label, values }
  })

  const displayModels = hasOther ? [...topModels, '其他'] : topModels
  return { topModels: displayModels, points }
}

export function TokenTimeChart({ buckets, granularity, onGranularityChange }: TokenTimeChartProps) {
  const grouped = groupByGranularity(buckets, granularity)
  const { topModels, points } = computeChartPoints(grouped)

  const W = 480, H = 200
  const PAD = { top: 10, right: 20, bottom: 30, left: 50 }
  const maxY = Math.max(...points.flatMap((p) => p.values), 1)
  const xScale = (i: number) =>
    PAD.left + (i / Math.max(points.length - 1, 1)) * (W - PAD.left - PAD.right)
  const yScale = (v: number) =>
    PAD.top + (1 - v / maxY) * (H - PAD.top - PAD.bottom)

  return (
    <div className="chart-container">
      <div className="chart-granularity">
        {(['day', 'week', 'month'] as const).map((g) => (
          <button
            key={g}
            className={granularity === g ? 'active' : ''}
            onClick={() => onGranularityChange(g)}
          >
            {g === 'day' ? '天' : g === 'week' ? '周' : '月'}
          </button>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        {topModels.map((model, mi) => {
          const segments: string[] = []
          let pathData = ''
          points.forEach((p, i) => {
            if (p.values[mi] > 0) {
              const x = xScale(i).toFixed(1)
              const y = yScale(p.values[mi]).toFixed(1)
              pathData += pathData === '' ? `M ${x},${y}` : ` L ${x},${y}`
            } else if (pathData !== '') {
              segments.push(pathData)
              pathData = ''
            }
          })
          if (pathData !== '') segments.push(pathData)
          return segments.map((d, si) => (
            <path
              key={`${model}-${si}`}
              d={d}
              stroke={MODEL_COLORS[mi % MODEL_COLORS.length]}
              strokeWidth="1.5"
              fill="none"
            />
          ))
        })}
        {points.map((p, i) => (
          <text
            key={p.label}
            x={xScale(i)}
            y={H - 5}
            textAnchor="middle"
            fontSize="10"
            fill="#6b7280"
          >
            {p.label.length > 7 ? p.label.slice(5) : p.label}
          </text>
        ))}
        <text x={PAD.left - 4} y={PAD.top + 4} textAnchor="end" fontSize="10" fill="#6b7280">
          {formatTokens(maxY)}
        </text>
      </svg>

      <div className="chart-legend">
        {topModels.map((m, i) => (
          <span key={m} style={{ color: MODEL_COLORS[i % MODEL_COLORS.length] }}>
            ■ {m}
          </span>
        ))}
      </div>
    </div>
  )
}
