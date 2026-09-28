import { describe, expect, it } from 'vitest'
import { FALLBACK_VAPID_SUBJECT, pushConfig, validPushSubscription } from '../server/utils/pushConfig'

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

describe('abonnement Web Push reçu', () => {
  const keys = { p256dh: 'BPk', auth: 'aut' }
  it('accepte un abonnement HTTPS avec ses clés', () => {
    expect(validPushSubscription({ endpoint: 'https://push.example/abc', keys })).toBe(true)
  })
  it('refuse une adresse non HTTPS (le serveur y posterait)', () => {
    expect(validPushSubscription({ endpoint: 'http://127.0.0.1:7683/api/x', keys })).toBe(false)
    expect(validPushSubscription({ endpoint: 'file:///etc/passwd', keys })).toBe(false)
    expect(validPushSubscription({ endpoint: 'pas une adresse', keys })).toBe(false)
  })
  it('refuse des clés absentes ou mal formées', () => {
    expect(validPushSubscription({ endpoint: 'https://push.example/abc' })).toBe(false)
    expect(validPushSubscription({ endpoint: 'https://push.example/abc', keys: { p256dh: 1, auth: 'a' } })).toBe(false)
    expect(validPushSubscription({ endpoint: 'https://push.example/abc', keys: true })).toBe(false)
    expect(validPushSubscription(null)).toBe(false)
  })
})
