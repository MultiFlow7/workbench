import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { aggregateAtoms, aggregateFromBuckets, DayModelBucket } from '../../utils/tokenAggregation'
import { calcCostUSD } from '../../constants/modelPrices'
import { formatTokens } from '../../utils/tokenFormat'
import { TokenTimeChart } from './TokenTimeChart'
import './DashboardView.css'

interface SummaryCardProps {
  label: string
  value: string
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="summary-card">
      <div className="summary-card__label">{label}</div>
      <div className="summary-card__value">{value}</div>
    </div>
  )
}

interface DashboardFiltersProps {
  dateRange: '7d' | '30d' | 'all'
  onDateRangeChange: (v: '7d' | '30d' | 'all') => void
  allModels: string[]
  modelFilter: string[]
  onModelFilterChange: (models: string[]) => void
}

function DashboardFilters({
  dateRange, onDateRangeChange,
  allModels, modelFilter, onModelFilterChange,
}: DashboardFiltersProps) {
  return (
    <div className="dashboard__filters">
      <div className="dashboard__filters-row">
        {(['7d', '30d', 'all'] as const).map((v) => (
          <button
            key={v}
            className={`filter-btn${dateRange === v ? ' active' : ''}`}
            onClick={() => onDateRangeChange(v)}
          >
            {v === '7d' ? '近 7 天' : v === '30d' ? '近 30 天' : '全部'}
          </button>
        ))}
      </div>
      {allModels.length > 0 && (
        <div className="dashboard__filters-models">
          {allModels.map((m) => (
            <label key={m} className="model-checkbox">
              <input
                type="checkbox"
                checked={modelFilter.length === 0 || !modelFilter.includes(m)}
                onChange={(e) => {
                  if (e.target.checked) {
                    onModelFilterChange(modelFilter.filter((x) => x !== m))
                  } else {
                    onModelFilterChange([...modelFilter.filter((x) => x !== m), m])
                  }
                }}
              />
              <span>{m}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

interface GatewayRow {
  date: string
  model: string
  input_tokens: number
  output_tokens: number
}

interface LlmStatsData {
  total_calls: number
  total_input_tokens: number
  total_output_tokens: number
}

export function DashboardView() {
  const atoms = useStore((s) => s.atoms)
  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('30d')
  const [modelFilter, setModelFilter] = useState<string[]>([])
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day')
  // v0.5: dual-view state
  const [dataSource, setDataSource] = useState<'atoms' | 'gateway'>('atoms')
  const [gatewayBuckets, setGatewayBuckets] = useState<DayModelBucket[]>([])
  const [gatewayLoading, setGatewayLoading] = useState(false)
  const [gatewayEmpty, setGatewayEmpty] = useState(false)
  // v0.9 req-029: Agent LLM 调用统计
  const [llmStats, setLlmStats] = useState<LlmStatsData | null>(null)
  const [llmStatsEmpty, setLlmStatsEmpty] = useState(false)

  // Compute cutoff date string for gateway query
  const cutoffDate = useMemo<string | null>(() => {
    if (dateRange === 'all') return null
    const ms = dateRange === '7d' ? 7 * 86400_000 : 30 * 86400_000
    const d = new Date(Date.now() - ms)
    return d.toISOString().slice(0, 10)
  }, [dateRange])

  // Load gateway data when switching to gateway view or changing date range
  useEffect(() => {
    if (dataSource !== 'gateway') return
    setGatewayLoading(true)
    setGatewayEmpty(false)
    window.api.invoke<GatewayRow[]>('get_token_stats_from_gateway', {
      dateFrom: cutoffDate,
      dateTo: null,
    })
      .then((rows) => {
        const buckets: DayModelBucket[] = rows.map((r) => ({
          date: r.date,
          model: r.model,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          costUSD: calcCostUSD(r.model, r.input_tokens, r.output_tokens),
        }))
        setGatewayBuckets(buckets)
        setGatewayEmpty(buckets.length === 0)
      })
      .catch(() => setGatewayEmpty(true))
      .finally(() => setGatewayLoading(false))
  }, [dataSource, cutoffDate])

  // v0.9 req-029: Load Agent LLM stats
  useEffect(() => {
    window.api.invoke<LlmStatsData>('get_llm_stats', { days: 7 })
      .then((data) => {
        setLlmStats(data)
        setLlmStatsEmpty(data.total_calls === 0)
      })
      .catch(() => setLlmStatsEmpty(true))
  }, [])

  // Atom-view filtered data
  const filteredAtoms = useMemo(() => {
    const cutoff = cutoffDate ? new Date(cutoffDate).getTime() : 0
    return Object.values(atoms).filter((a) => {
      if (cutoff > 0 && new Date(a.timestamp).getTime() < cutoff) return false
      if (modelFilter.length > 0 && modelFilter.includes(a.model ?? '')) return false
      return true
    })
  }, [atoms, cutoffDate, modelFilter])

  const atomStats = useMemo(() => aggregateAtoms(filteredAtoms), [filteredAtoms])

  // Active stats: atoms or gateway
  const activeStats = useMemo(
    () => dataSource === 'atoms' ? atomStats : aggregateFromBuckets(gatewayBuckets),
    [dataSource, atomStats, gatewayBuckets],
  )

  const noData = activeStats.atomsWithData === 0

  const rangeLabel = dateRange === '7d' ? '近 7 天' : dateRange === '30d' ? '近 30 天' : '全部'
  const costText = activeStats.knownModelCostUSD !== null
    ? `$${activeStats.knownModelCostUSD.toFixed(4)}${
        activeStats.unknownModelCount > 0
          ? `（${activeStats.unknownModelCount} 个未知模型成本未计入）`
          : ''
      }`
    : '-'

  const allModels = useMemo(
    () => [...new Set(Object.values(atoms).map((a) => a.model).filter(Boolean) as string[])],
    [atoms],
  )

  return (
    <div className="dashboard">
      {/* v0.5: 数据源切换标签 */}
      <div className="dashboard__source-tabs">
        <button
          className={`source-tab${dataSource === 'atoms' ? ' active' : ''}`}
          onClick={() => setDataSource('atoms')}
        >
          对话记录（atom）
        </button>
        <button
          className={`source-tab${dataSource === 'gateway' ? ' active' : ''}`}
          onClick={() => setDataSource('gateway')}
        >
          完整调用（gateway）
        </button>
      </div>

      <div className="dashboard__cost-banner">
        {rangeLabel}预估成本：{costText}（基于公开价格，仅供参考）
      </div>

      <div className="dashboard__cards">
        <SummaryCard
          label="总 Token 消耗"
          value={noData ? '-' : formatTokens(activeStats.totalInput + activeStats.totalOutput)}
        />
        <SummaryCard
          label="日均消耗"
          value={activeStats.avgDailyTokens !== null ? formatTokens(Math.round(activeStats.avgDailyTokens)) : '-'}
        />
        <SummaryCard
          label="最活跃模型"
          value={activeStats.mostActiveModel ?? '-'}
        />
        <SummaryCard
          label="最贵日期"
          value={activeStats.mostExpensiveDay ?? '-'}
        />
      </div>

      <div className="dashboard__section-title">Agent LLM 调用（近 7 天）</div>
      <div className="dashboard__cards">
        {llmStatsEmpty ? (
          <div className="dashboard__empty">暂无数据</div>
        ) : llmStats ? (
          <>
            <SummaryCard label="总调用次数" value={String(llmStats.total_calls)} />
            <SummaryCard
              label="总 Input Tokens"
              value={formatTokens(llmStats.total_input_tokens)}
            />
            <SummaryCard
              label="总 Output Tokens"
              value={formatTokens(llmStats.total_output_tokens)}
            />
          </>
        ) : null}
      </div>

      {dataSource === 'atoms' && atomStats.atomsTotal > atomStats.atomsWithData && (
        <div className="dashboard__partial-notice">
          {atomStats.atomsTotal - atomStats.atomsWithData} 个历史节点无 token 数据，未计入
        </div>
      )}

      {dataSource === 'gateway' && gatewayLoading && (
        <div className="dashboard__loading">加载中...</div>
      )}

      {dataSource === 'gateway' && gatewayEmpty && !gatewayLoading && (
        <div className="dashboard__empty">
          gateway 数据尚未积累，发送消息后将自动记录
        </div>
      )}

      {!noData && !gatewayLoading && (
        <TokenTimeChart
          buckets={activeStats.buckets}
          granularity={granularity}
          onGranularityChange={setGranularity}
        />
      )}

      {noData && !gatewayLoading && !gatewayEmpty && (
        <div className="dashboard__empty">
          暂无 token 数据，发送新消息后将自动采集
        </div>
      )}

      <DashboardFilters
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        allModels={allModels}
        modelFilter={modelFilter}
        onModelFilterChange={setModelFilter}
      />
    </div>
  )
}
