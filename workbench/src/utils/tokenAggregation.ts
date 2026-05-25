import { QAAtomMeta } from '../store/conversationSlice'
import { calcCostUSD } from '../constants/modelPrices'

export interface DayModelBucket {
  date: string
  model: string
  inputTokens: number
  outputTokens: number
  costUSD: number | null
}

export interface AggregatedStats {
  buckets: DayModelBucket[]
  totalInput: number
  totalOutput: number
  knownModelCostUSD: number | null
  unknownModelCount: number
  atomsWithData: number
  atomsTotal: number
  avgDailyTokens: number | null
  mostActiveModel: string | null
  mostExpensiveDay: string | null
}

export function aggregateFromBuckets(buckets: DayModelBucket[]): AggregatedStats {
  const totalInput = buckets.reduce((s, b) => s + b.inputTokens, 0)
  const totalOutput = buckets.reduce((s, b) => s + b.outputTokens, 0)

  const knownBuckets = buckets.filter((b) => b.costUSD !== null)
  const knownModelCostUSD = knownBuckets.length > 0
    ? knownBuckets.reduce((s, b) => s + b.costUSD!, 0)
    : null
  const unknownModelCount = new Set(
    buckets.filter((b) => b.costUSD === null).map((b) => b.model)
  ).size

  const tokensByDate = new Map<string, number>()
  for (const b of buckets) {
    tokensByDate.set(b.date, (tokensByDate.get(b.date) ?? 0) + b.inputTokens + b.outputTokens)
  }
  const avgDailyTokens = tokensByDate.size > 0
    ? Array.from(tokensByDate.values()).reduce((s, n) => s + n, 0) / tokensByDate.size
    : null

  const tokensByModel = new Map<string, number>()
  for (const b of buckets) {
    tokensByModel.set(b.model, (tokensByModel.get(b.model) ?? 0) + b.inputTokens + b.outputTokens)
  }
  const mostActiveModel = tokensByModel.size > 0
    ? [...tokensByModel.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null

  const costByDate = new Map<string, number>()
  for (const b of knownBuckets) {
    costByDate.set(b.date, (costByDate.get(b.date) ?? 0) + b.costUSD!)
  }
  const mostExpensiveDay = costByDate.size > 0
    ? [...costByDate.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null

  return {
    buckets,
    totalInput,
    totalOutput,
    knownModelCostUSD,
    unknownModelCount,
    atomsWithData: buckets.length,
    atomsTotal: buckets.length,
    avgDailyTokens,
    mostActiveModel,
    mostExpensiveDay,
  }
}

export function aggregateAtoms(atoms: QAAtomMeta[]): AggregatedStats {
  const atomsWithData = atoms.filter((a) => a.usage)
  const atomsTotal = atoms.length

  const bucketMap = new Map<string, DayModelBucket>()
  for (const atom of atomsWithData) {
    const date = atom.timestamp.slice(0, 10)
    const model = atom.model ?? 'unknown'
    const key = `${date}|${model}`
    const existing = bucketMap.get(key) ?? {
      date, model, inputTokens: 0, outputTokens: 0, costUSD: 0 as number | null,
    }
    existing.inputTokens += atom.usage!.input_tokens
    existing.outputTokens += atom.usage!.output_tokens
    const costDelta = calcCostUSD(model, atom.usage!.input_tokens, atom.usage!.output_tokens)
    existing.costUSD = costDelta !== null && existing.costUSD !== null
      ? existing.costUSD + costDelta
      : null
    bucketMap.set(key, existing)
  }
  const buckets = Array.from(bucketMap.values())

  const totalInput = buckets.reduce((s, b) => s + b.inputTokens, 0)
  const totalOutput = buckets.reduce((s, b) => s + b.outputTokens, 0)

  const knownBuckets = buckets.filter((b) => b.costUSD !== null)
  const knownModelCostUSD = knownBuckets.length > 0
    ? knownBuckets.reduce((s, b) => s + b.costUSD!, 0)
    : null
  const unknownModelCount = new Set(
    buckets.filter((b) => b.costUSD === null).map((b) => b.model)
  ).size

  const tokensByDate = new Map<string, number>()
  for (const b of buckets) {
    tokensByDate.set(b.date, (tokensByDate.get(b.date) ?? 0) + b.inputTokens + b.outputTokens)
  }
  const avgDailyTokens = tokensByDate.size > 0
    ? Array.from(tokensByDate.values()).reduce((s, n) => s + n, 0) / tokensByDate.size
    : null

  const tokensByModel = new Map<string, number>()
  for (const b of buckets) {
    tokensByModel.set(b.model, (tokensByModel.get(b.model) ?? 0) + b.inputTokens + b.outputTokens)
  }
  const mostActiveModel = tokensByModel.size > 0
    ? [...tokensByModel.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null

  const costByDate = new Map<string, number>()
  for (const b of knownBuckets) {
    costByDate.set(b.date, (costByDate.get(b.date) ?? 0) + b.costUSD!)
  }
  const mostExpensiveDay = costByDate.size > 0
    ? [...costByDate.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null

  return {
    buckets, totalInput, totalOutput,
    knownModelCostUSD, unknownModelCount,
    atomsWithData: atomsWithData.length, atomsTotal,
    avgDailyTokens, mostActiveModel, mostExpensiveDay,
  }
}
