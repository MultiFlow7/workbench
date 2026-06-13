export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function isHighConsumption(used: number, limit: number): boolean {
  return limit > 0 && used / limit >= 0.8
}
