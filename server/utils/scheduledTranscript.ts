import { StringDecoder } from 'node:string_decoder'
import { createTimerReconstruction, type SessionTimer } from '../../shared/scheduled'
import type { MachineFs } from './fsx'

// Scan the complete snapshot, including calls before large image records and
// deletions after them. Keep parser state between blocks rather than loading
// the entire transcript, on both local and SSH machines. A JSON line may span
// any number of blocks; decode UTF-8 only once its bytes have arrived.
export async function readSessionTimers(fs: MachineFs, file: string, now = Date.now(), timezone = 'UTC'): Promise<SessionTimer[]> {
  const { size } = await fs.stat(file)
  const reconstruction = createTimerReconstruction(now, timezone)
  const decoder = new StringDecoder('utf8')
  let carry = ''
  for (let offset = 0; offset < size;) {
    const block = await fs.read(file, offset, Math.min(1024 * 1024, size - offset))
    if (!block.length) throw new Error('Session transcript changed while reading')
    offset += block.length
    const lines = (carry + decoder.write(block)).split('\n')
    carry = lines.pop()!
    reconstruction.read(lines)
  }
  reconstruction.read([carry + decoder.end()])
  return reconstruction.finish()
}
