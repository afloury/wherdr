import { describe, expect, it } from 'vitest'
import { FALLBACK_VAPID_SUBJECT, pushConfig } from '../server/utils/pushConfig'

describe('configuration Web Push', () => {
  it('désactive le push avec APP_URL en HTTP local', () => {
    expect(pushConfig('http://localhost:7683')).toEqual({ enabled: false, subject: FALLBACK_VAPID_SUBJECT })
  })

  it('garde une adresse HTTPS privée comme sujet VAPID', () => {
    expect(pushConfig('https://server.example.ts.net:7683/')).toEqual({ enabled: true, subject: 'https://server.example.ts.net:7683/' })
  })

  it('désactive le push avec APP_URL vide ou invalide', () => {
    for (const value of ['', 'not a URL', 'https://', 'ftp://server.example']) {
      expect(pushConfig(value)).toEqual({ enabled: false, subject: FALLBACK_VAPID_SUBJECT })
    }
  })
})
