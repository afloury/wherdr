// Verify the release checksum before any package code runs.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const [file, checksum] = process.argv.slice(2)
const expected = readFileSync(checksum, 'utf8').trim().split(/\s+/)[0]
const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
if (!/^[a-f0-9]{64}$/.test(expected || '') || actual !== expected) {
  console.error('Release SHA-256 mismatch')
  process.exit(1)
}
