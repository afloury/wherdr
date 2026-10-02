import { describe, expect, it } from 'vitest'
import { carriesFiles, dragDepth, refusalText, sortForAgent } from '../app/utils/fileDrop'

describe('file drag and drop', () => {
  it('only reacts to drags that carry files', () => {
    expect(carriesFiles({ types: ['Files'] })).toBe(true)
    expect(carriesFiles({ types: ['text/plain', 'Files'] })).toBe(true)
    expect(carriesFiles({ types: ['text/plain'] })).toBe(false)
    expect(carriesFiles(null)).toBe(false)
    expect(carriesFiles({ types: null })).toBe(false)
  })

  it('sorts dropped files into photos, readable files and refused ones', async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' })
    const pdf = new File(['%PDF-1.7\n...'], 'spec.pdf', { type: 'application/pdf' })
    const txt = new File(['hello\n'], 'notes', { type: '' })
    const zip = new File([new Uint8Array([0x50, 0x4b, 3, 4, 0])], 'bundle.zip', { type: 'application/zip' })
    const claude = await sortForAgent([png, pdf, txt, zip], 'claude')
    expect(claude.images).toEqual([png])
    expect(claude.files.map(f => [f.file.name, f.kind])).toEqual([['spec.pdf', 'pdf'], ['notes', 'text']])
    expect(claude.refused.map(r => [r.file.name, r.reason])).toEqual([['bundle.zip', 'archive']])
    const codex = await sortForAgent([pdf, txt], 'codex')
    expect(codex.files.map(f => f.file.name)).toEqual(['notes'])
    expect(codex.refused.map(r => r.reason)).toEqual(['pdf'])
  })

  it('explains each refusal with the agent name', () => {
    expect(refusalText('archive', 'Claude Code')).toContain('Claude Code can’t read archives')
    expect(refusalText('pdf', 'Codex')).toContain('Codex can’t read PDFs')
    expect(refusalText('too_large', 'Codex', 'text')).toBe('too large (10 MB max)')
    expect(refusalText('too_large', 'Claude Code', 'pdf')).toBe('too large (30 MB max)')
  })

  it('counts enters and leaves without going below zero', () => {
    let n = 0
    for (const t of ['dragenter', 'dragenter', 'dragleave']) n = dragDepth(n, t)
    expect(n).toBe(1)
    expect(dragDepth(0, 'dragleave')).toBe(0)
    expect(dragDepth(3, 'drop')).toBe(0)
    expect(dragDepth(2, 'dragover')).toBe(2)
  })
})
