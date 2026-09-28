import { describe, expect, it } from 'vitest'
import { moveMachine, sortMachines } from '../shared/machineOrder'

const machines = [{ key: '' }, { key: 'aaa' }, { key: 'bbb' }]

describe('ordre des machines', () => {
  it('suit l’ordre enregistré et place une nouvelle machine à la fin', () => {
    expect(sortMachines([...machines, { key: 'new' }], ['bbb', '', 'aaa']).map(m => m.key)).toEqual(['bbb', '', 'aaa', 'new'])
  })
  it('ignore une machine supprimée et garde les sessions avec leur machine', () => {
    expect(sortMachines([{ key: '' }, { key: 'aaa~session', baseKey: 'aaa' }, { key: 'bbb' }], ['gone', 'aaa', 'bbb', '']).map(m => m.key)).toEqual(['aaa~session', 'bbb', ''])
  })
  it('déplace une machine sans la dupliquer', () => {
    expect(moveMachine(['', 'aaa', 'bbb'], 'bbb', '')).toEqual(['bbb', '', 'aaa'])
  })
})
