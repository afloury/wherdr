import { describe, expect, it } from 'vitest'
import { normalizeDirInput } from '../app/utils/dirInput'

const HOME = '/home/user'

describe('normalizeDirInput', () => {
  it('développe ~ et ~/…', () => {
    expect(normalizeDirInput('~', HOME)).toBe(HOME)
    expect(normalizeDirInput('~/code/app', HOME)).toBe('/home/user/code/app')
    expect(normalizeDirInput('', HOME)).toBe(HOME)
  })
  it('nettoie espaces, guillemets, barres finales et segments . / ..', () => {
    expect(normalizeDirInput('  "/home/user/code/"  ', HOME)).toBe('/home/user/code')
    expect(normalizeDirInput("'~/a/./b/../c//'", HOME)).toBe('/home/user/a/c')
  })
  it('résout un chemin relatif depuis le HOME', () => {
    expect(normalizeDirInput('code', HOME)).toBe('/home/user/code')
  })
  it('refuse un chemin hors du HOME', () => {
    expect(normalizeDirInput('/etc', HOME)).toBeNull()
    expect(normalizeDirInput('/home/user2', HOME)).toBeNull()
    expect(normalizeDirInput('~/../other', HOME)).toBeNull()
  })
})
