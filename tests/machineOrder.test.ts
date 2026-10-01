import { describe, expect, it } from 'vitest'
import { cleanMachineOrder, dropMachineKey, moveMachine, shiftMachineKey, sortMachines, validMachineOrder } from '../shared/machineOrder'

const machines = [{ key: '' }, { key: 'aaa' }, { key: 'bbb' }]
// The local machine ('') in first, middle and last position.
const orders = [['', 'aaa', 'bbb'], ['aaa', '', 'bbb'], ['aaa', 'bbb', '']]

describe('ordre des machines', () => {
  it('follows the saved order and puts a new machine at the end', () => {
    expect(sortMachines([...machines, { key: 'new' }], ['bbb', '', 'aaa']).map(m => m.key)).toEqual(['bbb', '', 'aaa', 'new'])
  })
  it('ignores a removed machine and keeps the sessions with their machine', () => {
    expect(sortMachines([{ key: '' }, { key: 'aaa~session', baseKey: 'aaa' }, { key: 'bbb' }], ['gone', 'aaa', 'bbb', '']).map(m => m.key)).toEqual(['aaa~session', 'bbb', ''])
  })
  it('sorts the local machine in each position', () => {
    for (const order of orders) expect(sortMachines(machines, order).map(m => m.key)).toEqual(order)
    expect(sortMachines([{ key: '~s', baseKey: '' }, ...machines], ['aaa', '', 'bbb']).map(m => m.key)).toEqual(['aaa', '~s', '', 'bbb'])
  })
  it('moves a machine without duplicating it', () => {
    expect(moveMachine(['', 'aaa', 'bbb'], 'bbb', '')).toEqual(['bbb', '', 'aaa'])
    expect(moveMachine(['aaa', '', 'bbb'], '', null)).toEqual(['aaa', 'bbb', ''])
    expect(moveMachine(['aaa', '', 'bbb'], '', 'aaa')).toEqual(['', 'aaa', 'bbb'])
  })
})

describe('Move up / Move down and arrows', () => {
  it('fait monter et descendre la machine locale', () => {
    expect(shiftMachineKey(['aaa', '', 'bbb'], '', -1)).toEqual(['', 'aaa', 'bbb'])
    expect(shiftMachineKey(['aaa', '', 'bbb'], '', 1)).toEqual(['aaa', 'bbb', ''])
    expect(shiftMachineKey(['', 'aaa', 'bbb'], '', 1)).toEqual(['aaa', '', 'bbb'])
    expect(shiftMachineKey(['aaa', 'bbb', ''], '', -1)).toEqual(['aaa', '', 'bbb'])
  })
  it('does nothing at the edges or for an unknown key', () => {
    expect(shiftMachineKey(['', 'aaa'], '', -1)).toBeNull()
    expect(shiftMachineKey(['aaa', ''], '', 1)).toBeNull()
    expect(shiftMachineKey(['aaa', 'bbb'], '', 1)).toBeNull()
  })
})

describe('drag and drop', () => {
  it('moves the local machine from each position', () => {
    expect(dropMachineKey(['aaa', '', 'bbb'], '', 'aaa', false)).toEqual(['', 'aaa', 'bbb'])
    expect(dropMachineKey(['aaa', '', 'bbb'], '', 'bbb', true)).toEqual(['aaa', 'bbb', ''])
    expect(dropMachineKey(['', 'aaa', 'bbb'], '', 'bbb', true)).toEqual(['aaa', 'bbb', ''])
    expect(dropMachineKey(['aaa', 'bbb', ''], '', 'aaa', false)).toEqual(['', 'aaa', 'bbb'])
  })
  it('drops another machine before or after the local one', () => {
    expect(dropMachineKey(['aaa', '', 'bbb'], 'bbb', '', false)).toEqual(['aaa', 'bbb', ''])
    expect(dropMachineKey(['aaa', '', 'bbb'], 'aaa', '', true)).toEqual(['', 'aaa', 'bbb'])
  })
  it('ignores a drop without a drag, on itself or without effect', () => {
    expect(dropMachineKey(['aaa', '', 'bbb'], null, 'aaa', false)).toBeNull()
    expect(dropMachineKey(['aaa', '', 'bbb'], '', '', false)).toBeNull()
    expect(dropMachineKey(['aaa', '', 'bbb'], '', 'bbb', false)).toBeNull()
  })
})

describe('saved order', () => {
  const known = ['', 'aaa', 'bbb']
  it('keeps the empty local key on read', () => {
    for (const order of orders) expect(cleanMachineOrder(order, known)).toEqual(order)
    expect(cleanMachineOrder(['aaa', 'gone', '', '', 3, 'bbb'], known)).toEqual(['aaa', '', 'bbb'])
    expect(cleanMachineOrder(['bbb', 'aaa'], known)).toEqual(['bbb', 'aaa'])
    expect(cleanMachineOrder({ order: [] }, known)).toEqual([])
  })
  it('accepts the local key on write and refuses invalid orders', () => {
    for (const order of orders) expect(validMachineOrder(order, known)).toBe(true)
    expect(validMachineOrder([], known)).toBe(true)
    expect(validMachineOrder(['', ''], known)).toBe(false)
    expect(validMachineOrder(['gone'], known)).toBe(false)
    expect(validMachineOrder('aaa', known)).toBe(false)
  })
})
