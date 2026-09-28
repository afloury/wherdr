import { describe, expect, it } from 'vitest'
import { cleanMachineOrder, dropMachineKey, moveMachine, shiftMachineKey, sortMachines, validMachineOrder } from '../shared/machineOrder'

const machines = [{ key: '' }, { key: 'aaa' }, { key: 'bbb' }]
// La machine locale ('') en première, au milieu et en dernière position.
const orders = [['', 'aaa', 'bbb'], ['aaa', '', 'bbb'], ['aaa', 'bbb', '']]

describe('ordre des machines', () => {
  it('suit l’ordre enregistré et place une nouvelle machine à la fin', () => {
    expect(sortMachines([...machines, { key: 'new' }], ['bbb', '', 'aaa']).map(m => m.key)).toEqual(['bbb', '', 'aaa', 'new'])
  })
  it('ignore une machine supprimée et garde les sessions avec leur machine', () => {
    expect(sortMachines([{ key: '' }, { key: 'aaa~session', baseKey: 'aaa' }, { key: 'bbb' }], ['gone', 'aaa', 'bbb', '']).map(m => m.key)).toEqual(['aaa~session', 'bbb', ''])
  })
  it('trie la machine locale à chaque position', () => {
    for (const order of orders) expect(sortMachines(machines, order).map(m => m.key)).toEqual(order)
    expect(sortMachines([{ key: '~s', baseKey: '' }, ...machines], ['aaa', '', 'bbb']).map(m => m.key)).toEqual(['aaa', '~s', '', 'bbb'])
  })
  it('déplace une machine sans la dupliquer', () => {
    expect(moveMachine(['', 'aaa', 'bbb'], 'bbb', '')).toEqual(['bbb', '', 'aaa'])
    expect(moveMachine(['aaa', '', 'bbb'], '', null)).toEqual(['aaa', 'bbb', ''])
    expect(moveMachine(['aaa', '', 'bbb'], '', 'aaa')).toEqual(['', 'aaa', 'bbb'])
  })
})

describe('Monter / Descendre et flèches', () => {
  it('fait monter et descendre la machine locale', () => {
    expect(shiftMachineKey(['aaa', '', 'bbb'], '', -1)).toEqual(['', 'aaa', 'bbb'])
    expect(shiftMachineKey(['aaa', '', 'bbb'], '', 1)).toEqual(['aaa', 'bbb', ''])
    expect(shiftMachineKey(['', 'aaa', 'bbb'], '', 1)).toEqual(['aaa', '', 'bbb'])
    expect(shiftMachineKey(['aaa', 'bbb', ''], '', -1)).toEqual(['aaa', '', 'bbb'])
  })
  it('ne fait rien aux bords ou pour une clé inconnue', () => {
    expect(shiftMachineKey(['', 'aaa'], '', -1)).toBeNull()
    expect(shiftMachineKey(['aaa', ''], '', 1)).toBeNull()
    expect(shiftMachineKey(['aaa', 'bbb'], '', 1)).toBeNull()
  })
})

describe('glisser-déposer', () => {
  it('déplace la machine locale depuis chaque position', () => {
    expect(dropMachineKey(['aaa', '', 'bbb'], '', 'aaa', false)).toEqual(['', 'aaa', 'bbb'])
    expect(dropMachineKey(['aaa', '', 'bbb'], '', 'bbb', true)).toEqual(['aaa', 'bbb', ''])
    expect(dropMachineKey(['', 'aaa', 'bbb'], '', 'bbb', true)).toEqual(['aaa', 'bbb', ''])
    expect(dropMachineKey(['aaa', 'bbb', ''], '', 'aaa', false)).toEqual(['', 'aaa', 'bbb'])
  })
  it('dépose une autre machine avant ou après la locale', () => {
    expect(dropMachineKey(['aaa', '', 'bbb'], 'bbb', '', false)).toEqual(['aaa', 'bbb', ''])
    expect(dropMachineKey(['aaa', '', 'bbb'], 'aaa', '', true)).toEqual(['', 'aaa', 'bbb'])
  })
  it('ignore un dépôt sans glisser, sur soi-même ou sans effet', () => {
    expect(dropMachineKey(['aaa', '', 'bbb'], null, 'aaa', false)).toBeNull()
    expect(dropMachineKey(['aaa', '', 'bbb'], '', '', false)).toBeNull()
    expect(dropMachineKey(['aaa', '', 'bbb'], '', 'bbb', false)).toBeNull()
  })
})

describe('ordre enregistré', () => {
  const known = ['', 'aaa', 'bbb']
  it('garde la clé locale vide à la lecture', () => {
    for (const order of orders) expect(cleanMachineOrder(order, known)).toEqual(order)
    expect(cleanMachineOrder(['aaa', 'gone', '', '', 3, 'bbb'], known)).toEqual(['aaa', '', 'bbb'])
    expect(cleanMachineOrder(['bbb', 'aaa'], known)).toEqual(['bbb', 'aaa'])
    expect(cleanMachineOrder({ order: [] }, known)).toEqual([])
  })
  it('accepte la clé locale à l’écriture et refuse les ordres invalides', () => {
    for (const order of orders) expect(validMachineOrder(order, known)).toBe(true)
    expect(validMachineOrder([], known)).toBe(true)
    expect(validMachineOrder(['', ''], known)).toBe(false)
    expect(validMachineOrder(['gone'], known)).toBe(false)
    expect(validMachineOrder('aaa', known)).toBe(false)
  })
})
