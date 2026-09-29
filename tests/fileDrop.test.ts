import { describe, expect, it } from 'vitest'
import { carriesFiles, dragDepth, splitDropped } from '../app/utils/fileDrop'

describe('glisser-déposer de fichiers', () => {
  it('ne réagit qu’aux glissés qui portent des fichiers', () => {
    expect(carriesFiles({ types: ['Files'] })).toBe(true)
    expect(carriesFiles({ types: ['text/plain', 'Files'] })).toBe(true)
    expect(carriesFiles({ types: ['text/plain'] })).toBe(false)
    expect(carriesFiles(null)).toBe(false)
    expect(carriesFiles({ types: null })).toBe(false)
  })

  it('sépare les images des types refusés par le champ', () => {
    const a = { type: 'image/png', name: 'a.png' }
    const b = { type: 'application/pdf', name: 'b.pdf' }
    const c = { type: '', name: 'notes' }
    const d = { type: 'image/heic', name: 'd.heic' }
    expect(splitDropped([a, b, c, d])).toEqual({ images: [a, d], refused: [b, c] })
  })

  it('compte les entrées et sorties sans descendre sous zéro', () => {
    let n = 0
    for (const t of ['dragenter', 'dragenter', 'dragleave']) n = dragDepth(n, t)
    expect(n).toBe(1)
    expect(dragDepth(0, 'dragleave')).toBe(0)
    expect(dragDepth(3, 'drop')).toBe(0)
    expect(dragDepth(2, 'dragover')).toBe(2)
  })
})
