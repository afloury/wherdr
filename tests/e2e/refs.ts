// References in the message field (shared/reference.ts), as the specs expect
// them. The fixtures are dated "now": the time of each reference reads HH:MM,
// and the code of its message (made from that date) is left out.
import { expect, type Locator } from '@playwright/test'
import { decisionRef, messageRef, pointRef, refLine } from '../../shared/reference'

export const draftOf = async (field: Locator) => (await field.inputValue()).replace(/^(↳ Quote \w+) \d\d:\d\d((?: #\S+)?) ~[0-9a-z]{3}\d*(?= : )/gm, '$1 HH:MM$2')
// The codes the references of the field carry, in order.
export const codesOf = async (field: Locator) => [...(await field.inputValue()).matchAll(/^↳ Quote \w+ \d\d:\d\d(?: #\S+)? ~([0-9a-z]{3}\d*) : /gm)].map(m => m[1]!)
export const expectDraft = (field: Locator, text: string) => expect.poll(() => draftOf(field)).toBe(text)
export const message = (text: string) => refLine(messageRef(text, 'HH:MM'))
export const point = (text: string) => refLine(pointRef(text, 'HH:MM'))
export const decision = (n: string, text: string) => refLine(decisionRef(n, text, 'HH:MM'))
export const decisions = (n: string, text: string) => refLine(decisionRef(n, text, 'HH:MM', true))
