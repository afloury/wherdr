// References in the message field (shared/reference.ts), as the specs expect
// them. The fixtures are dated "now": the time of each reference reads HH:MM.
import { expect, type Locator } from '@playwright/test'
import { decisionRef, messageRef, pointRef, refLine } from '../../shared/reference'

export const draftOf = async (field: Locator) => (await field.inputValue()).replace(/^(↳ Quote \w+) \d\d:\d\d/gm, '$1 HH:MM')
export const expectDraft = (field: Locator, text: string) => expect.poll(() => draftOf(field)).toBe(text)
export const message = (text: string) => refLine(messageRef(text, 'HH:MM'))
export const point = (text: string) => refLine(pointRef(text, 'HH:MM'))
export const decision = (n: string, text: string) => refLine(decisionRef(n, text, 'HH:MM'))
export const decisions = (n: string, text: string) => refLine(decisionRef(n, text, 'HH:MM', true))
