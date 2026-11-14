import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MajorReleaseCard from '~/components/MajorReleaseCard.vue'
import { majorMove } from '#shared/updates'

it('announces a newer major with its notes, guide and install-beside command, without an Update button', async () => {
  const w = await mountSuspended(MajorReleaseCard, { props: { next: majorMove('owner/wherdr', '3.0.0') } })
  try {
    expect(w.text()).toContain('wherdr 3 is out: what changes, how to move')
    expect(w.text()).toContain('install-v3-beside-v2.sh')
    const links = w.findAll('a').map(a => a.attributes('href'))
    expect(links).toContain('https://github.com/owner/wherdr/releases/tag/v3.0.0')
    expect(links).toContain('https://github.com/owner/wherdr/blob/v3.0.0/docs/migrate-from-v2.md')
    expect(w.findAll('button').map(b => b.text())).toEqual(['Copy command'])
  } finally { w.unmount() }
}, 60_000)
