export interface ModelPrice {
  inputPerMillion: number
  outputPerMillion: number
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-pro':            { inputPerMillion: 1.25,  outputPerMillion: 10.00 },
  'claude-opus-4-7':           { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-sonnet-4-6':         { inputPerMillion: 3.00,  outputPerMillion: 15.00 },
  'claude-haiku-4-5-20251001': { inputPerMillion: 0.80,  outputPerMillion: 4.00  },
}

export function calcCostUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = MODEL_PRICES[model]
  if (!price) return null
  return (inputTokens / 1_000_000) * price.inputPerMillion
       + (outputTokens / 1_000_000) * price.outputPerMillion
}
