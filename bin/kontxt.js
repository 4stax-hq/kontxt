#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

// For our current dev/test environment, `tsx` can't run inside the sandbox,
// so run the compiled CLI from packages/cli/dist.
const entry = path.join(__dirname, '../packages/cli/dist/index.js')

const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' })

process.exit(result.status ?? 1)

