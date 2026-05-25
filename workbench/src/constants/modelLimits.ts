export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-7': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.0-flash': 1000000,
}

export function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? 200000
}
