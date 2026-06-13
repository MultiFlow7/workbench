export const textExtensions = [
  '.css',
  '.csv',
  '.cjs',
  '.html',
  '.ini',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.md',
  '.mjs',
  '.py',
  '.rs',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]

export const ignoredPathParts = [
  '.git',
  'node_modules',
]

export const forbiddenFilePatterns = [
  { label: 'env file', regex: /(^|\/)\.env(\.|$|$)(?!example)/i },
  { label: 'env local file', regex: /(^|\/)\.env\.local$/i },
  { label: 'database file', regex: /\.(db|sqlite|sqlite3|db-wal|db-shm)$/i },
  { label: 'line log file', regex: /\.(jsonl|log)$/i },
  { label: 'build output', regex: /^out\//i },
  { label: 'release artifact dir', regex: /^release\//i },
  { label: 'packaged artifact', regex: /\.(dmg|exe|appimage)$/i },
  { label: 'private memory dir', regex: /(^|\/)记忆\// },
]

export const privateKeywordGroups = [
  {
    label: 'internal automation tooling',
    keywords: ['docs/superpowers', 'superpowers/plans', 'superpowers/specs'],
  },
]
