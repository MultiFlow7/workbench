const BASE_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SHELL',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
])

export function buildSafeAgentEnv(
  overrides: Record<string, string | undefined> = {},
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of BASE_ENV_ALLOWLIST) {
    const value = source[key]
    if (value !== undefined && value !== '') env[key] = value
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== '') env[key] = value
    else delete env[key]
  }
  return env
}
