// Check transfer integrity before extraction. Metadata/checksum and archive
// share an origin: this does not authenticate a publisher or prevent replacement.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const [file, checksum, source, version] = process.argv.slice(2)
let matches = false
if (source === 'npm') {
  const metadata = JSON.parse(readFileSync(checksum, 'utf8'))
  const integrity = metadata.dist?.integrity
  const actual = createHash('sha512').update(readFileSync(file)).digest('base64')
  matches = metadata.name === 'wherdr' && metadata.version === version && integrity === `sha512-${actual}`
} else {
  const expected = readFileSync(checksum, 'utf8').trim().split(/\s+/)[0]
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex')
  matches = /^[a-f0-9]{64}$/.test(expected || '') && actual === expected
}
if (!matches) {
  console.error('Release checksum mismatch')
  process.exit(1)
}
