// First-launch setup guide (app/components/OnboardingGuide.vue): whether it was
// finished or skipped, kept in the data folder so another device does not
// show it again. Tied to the machine's label: a data folder copied to another
// machine, or a new install (empty data folder), shows it again.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, HOST_LABEL } from './env'

export const ONBOARDING_FILE = path.join(DATA_DIR, 'onboarding.json')

export interface OnboardingState { done: boolean }

export function readOnboarding(file = ONBOARDING_FILE, host = HOST_LABEL): OnboardingState {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { done?: unknown, host?: unknown }
    return { done: saved.done === true && saved.host === host }
  } catch { return { done: false } }
}

export function writeOnboarding(done: boolean, file = ONBOARDING_FILE, host = HOST_LABEL): OnboardingState {
  if (!done) {
    fs.rmSync(file, { force: true })
    return { done: false }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ done: true, host, at: new Date().toISOString() }, null, 2)}\n`)
  return { done: true }
}
