#!/usr/bin/env node
// `wherdr` (npx / bunx / pnpm dlx / npm i -g / Homebrew): runs the prebuilt
// server shipped in the package (.output/server/index.mjs); nothing is built here.
import { CliError, VERSION, parseArgs } from './lib/core.mjs'
import * as commands from './lib/commands.mjs'

function fail(message, code = 1) {
  process.stderr.write(`wherdr: ${message}\n`)
  process.exit(code)
}

let opts
try { opts = parseArgs(process.argv.slice(2)) } catch (e) { fail(e.message, 2) }

try {
  if (opts.command === 'help') process.stdout.write(`${commands.HELP}\n`)
  else if (opts.command === 'version') process.stdout.write(`${VERSION}\n`)
  else if (opts.command === 'panel') await (await import('./lib/panel.mjs')).panel(opts)
  else await commands[opts.command](opts)
} catch (e) {
  if (e instanceof CliError) fail(e.message, e.code)
  fail(e?.message || String(e))
}
