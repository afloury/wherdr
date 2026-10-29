import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ProjectsUpgradeNote from '~/components/ProjectsUpgradeNote.vue'

const locale = vi.hoisted(() => ({ fr: false }))
vi.mock('~/utils/i18n', () => ({ t: (s: string) => s, tl: (en: string, fr: string) => locale.fr ? fr : en }))

describe('Shepherdr compatibility note', () => {
  it.each([false, true])('explains the manual pinned return (French: %s)', async (fr) => {
    locale.fr = fr
    const w = await mountSuspended(ProjectsUpgradeNote, { props: { status: 'shepherdr', version: '2.0.0' } })
    expect(w.text()).toContain(fr ? 'Shepherdr 2 détecté : le Board de wherdr ne le prend pas en charge' : 'Shepherdr 2 detected: wherdr’s Board does not support it')
    expect(w.text()).toContain('--ref v1.2.21 --yes')
    expect(w.text()).toContain('herdr plugin uninstall herdr-projects &&')
    expect(w.text()).not.toContain('wherdr@1.3.4')
    expect(w.find('a').attributes('href')).toContain('#shepherdr-2')
    expect(w.findAll('button')).toHaveLength(1)
    w.unmount()
  })
})
