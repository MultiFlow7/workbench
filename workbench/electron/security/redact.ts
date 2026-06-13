const REDACTION = '[REDACTED]'

const SECRET_REGEXES: Array<[RegExp, string]> = [
  [/("(?:api[_-]?key|key|token|password|secret)"\s*:\s*")[^"]+(")/gi, `$1${REDACTION}$2`],
  [/\b(Authorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTION}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, `$1${REDACTION}`],
  [/\b(x-provider-key\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTION}`],
  [/\b(api[_-]?key|key|token|password|secret)(\s*[:=]\s*)[^\s,;}&"']+/gi, `$1$2${REDACTION}`],
  [/([?&](?:key|token|api_key)=)[^&\s"']+/gi, `$1${REDACTION}`],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTION],
]

export function redactSensitive(value: unknown): string {
  let text: string
  if (value instanceof Error) text = value.stack || value.message
  else if (typeof value === 'string') text = value
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }

  for (const [regex, replacement] of SECRET_REGEXES) {
    text = text.replace(regex, replacement)
  }
  return text
}
