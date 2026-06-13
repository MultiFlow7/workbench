#!/usr/bin/env node
/**
 * Compatibility wrapper kept for v0.16 release scripts.
 *
 * v0.16.1 uses scan-public-cleanliness.mjs as the rule engine. Calling this
 * script still scans a directory, but now with the full public cleanliness rule
 * set instead of only personal path regexes.
 */

import { spawnSync } from 'node:child_process'
import process from 'node:process'

const target = process.argv[2] ?? 'out'

const result = spawnSync(
  process.execPath,
  ['scripts/scan-public-cleanliness.mjs', '--path', target],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
  }
)

process.exit(result.status ?? 2)
