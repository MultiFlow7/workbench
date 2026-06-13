#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'

function usage() {
  console.error(`Usage:
  node scripts/preflight-public-cleanliness.mjs --tracked
  node scripts/preflight-public-cleanliness.mjs --staged
  node scripts/preflight-public-cleanliness.mjs --build
  node scripts/preflight-public-cleanliness.mjs --history [--all-refs] [--private-config <path>]
`)
}

function run(args) {
  const result = spawnSync(process.execPath, ['scripts/scan-public-cleanliness.mjs', ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
  return result.status ?? 2
}

const argv = process.argv.slice(2)
const passThrough = []
let mode = null
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--tracked' || arg === '--staged' || arg === '--history') {
    mode = arg
    passThrough.push(arg)
  } else if (arg === '--build') {
    mode = arg
  } else if (arg === '--all-refs') {
    passThrough.push(arg)
  } else if (arg === '--private-config' || arg === '--allowlist' || arg === '--ref') {
    passThrough.push(arg, argv[++i])
  } else if (arg === '--help' || arg === '-h') {
    usage()
    process.exit(0)
  } else {
    console.error(`[preflight] unknown argument: ${arg}`)
    usage()
    process.exit(2)
  }
}

if (!mode) {
  usage()
  process.exit(2)
}

if (mode === '--build') {
  const outExit = run(['--path', 'out'])
  if (outExit !== 0) process.exit(outExit)
  const aiServiceExit = run(['--path', '../ai-service', '--respect-gitignore'])
  process.exit(aiServiceExit)
}

process.exit(run(passThrough))
