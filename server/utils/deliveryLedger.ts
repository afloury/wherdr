import fs from 'node:fs'
import path from 'node:path'

// Commit before terminal I/O. An interrupted write must leave the previous
// complete snapshot, never a truncated queue that startup silently discards.
export function writeDeliveryFile(file: string, value: string) {
  const temporary = `${file}.next`
  const fd = fs.openSync(temporary, 'w', 0o600)
  try {
    fs.writeFileSync(fd, value)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
  const directory = fs.openSync(path.dirname(file), 'r')
  try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
}

// Keep receipts after transcript reconciliation removes the visible bubble.
// A lost HTTP response, reconnect or process restart cannot submit the same
// client ID again. An unfinished request has an uncertain outcome: fail closed.
export class DeliveryLedger<T> {
  private receipts: Record<string, T>
  private active = new Map<string, Promise<T>>()
  constructor(private file: string) {
    try { this.receipts = JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      this.receipts = {}
    }
  }
  run(key: string, interrupted: T, send: () => Promise<T>): Promise<T> {
    const active = this.active.get(key)
    if (active) return active
    if (Object.hasOwn(this.receipts, key)) return Promise.resolve(this.receipts[key]!)
    this.receipts[key] = interrupted
    this.save()
    const work = Promise.resolve().then(send).then(result => {
      this.receipts[key] = result
      this.save()
      return result
    }).finally(() => this.active.delete(key))
    this.active.set(key, work)
    return work
  }
  private save() { writeDeliveryFile(this.file, JSON.stringify(this.receipts)) }
}
