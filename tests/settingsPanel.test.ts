import { expect, it } from 'vitest'
import { uiOpenPanel } from '../app/utils/settingsPanel'

const chat = { path: '/a/w1:p1', query: {} }

it('opens an agent\'s Settings place in the side panel on a wide screen, bare #/settings included', () => {
  expect(uiOpenPanel('#/settings', chat, true)).toEqual({ path: '/a/w1:p1', query: { section: 'appearance' } })
  expect(uiOpenPanel('#/settings?section=projects&project=WEB', chat, true))
    .toEqual({ path: '/a/w1:p1', query: { section: 'projects', project: 'WEB' } })
})

it('leaves the card when there is no room or the place is not in Settings', () => {
  expect(uiOpenPanel('#/settings?section=phone', chat, false)).toBeNull()
  expect(uiOpenPanel('#/decisions', chat, true)).toBeNull()
})
