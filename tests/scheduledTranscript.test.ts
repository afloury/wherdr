import { expect, it, vi } from 'vitest'
import { readSessionTimers } from '../server/utils/scheduledTranscript'
import { localFs } from '../server/utils/fsx'

const now = Date.parse('2026-01-05T08:00:00Z')
const call = (name: string, id: string, input: object) => JSON.stringify({ timestamp: new Date(now).toISOString(), message: { content: [{ type: 'tool_use', name, id, input }] } })
const result = (id: string, content: string) => JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } })
function memoryFs(text: string, chunk = Infinity) {
  const buffer = Buffer.from(text)
  return { ...localFs,
    stat: async () => ({ size: buffer.length, mtimeMs: 0, isFile: true, isDir: false }),
    read: vi.fn(async (_file: string, offset: number, len: number) => buffer.subarray(offset, offset + Math.min(chunk, len))),
    readFile: vi.fn(async () => { throw new Error('Must read by blocks') }),
  }
}

it('preserves UTF-8, tool/result pairs and an unterminated final line across short reads', async () => {
  const fs = memoryFs([call('CronCreate', 'c1', { cron: '* * * * *', prompt: 'Check ☕', recurring: true }), result('c1', '{"id":"job1"}')].join('\n'), 1)
  expect(await readSessionTimers(fs, 'transcript', now)).toMatchObject([{ id: 'job1', prompt: 'Check ☕' }])
  expect(fs.readFile).not.toHaveBeenCalled()
})

it('reads beyond large records, applying later deletions and discovering later creations', async () => {
  const fs = memoryFs([
    call('CronCreate', 'c1', { cron: '* * * * *', recurring: true }), result('c1', '{"id":"removed"}'),
    JSON.stringify({ message: { content: 'x'.repeat(2 * 1024 * 1024) } }),
    call('CronDelete', 'd1', { id: 'removed' }), result('d1', 'Deleted'),
    call('CronCreate', 'c2', { cron: '* * * * *', recurring: true }), result('c2', '{"id":"active"}'),
  ].join('\n'))
  expect(await readSessionTimers(fs, 'transcript', now)).toMatchObject([{ id: 'active' }])
  expect(fs.read.mock.calls.every(([, , len]) => len <= 1024 * 1024)).toBe(true)
  expect(fs.read.mock.calls.length).toBeGreaterThan(2)
  expect(fs.readFile).not.toHaveBeenCalled()
})

it('reports a truncated snapshot instead of returning an incomplete timer list', async () => {
  const fs = memoryFs('record')
  fs.read.mockResolvedValue(Buffer.alloc(0))
  await expect(readSessionTimers(fs, 'transcript', now)).rejects.toThrow('changed while reading')
})
