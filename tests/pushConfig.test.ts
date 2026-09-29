import { describe, expect, it } from 'vitest'
import { FALLBACK_VAPID_SUBJECT, pushConfig, replaceSubscription, validPushSubscription } from '../server/utils/pushConfig'

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

describe('replaceSubscription', () => {
  const active = (q: { until: number | null }) => q.until === null || q.until > 1000
  const sub = (endpoint: string, quiet?: { until: number | null }) => ({ endpoint, lang: 'fr', ...(quiet ? { quiet } : {}) })
  it('drops the previous endpoint and carries its quiet mode over', () => {
    const out = replaceSubscription([sub('https://p/old', { until: null }), sub('https://p/other')], sub('https://p/new'), 'https://p/old', active)
    expect(out.map(s => s.endpoint)).toEqual(['https://p/other', 'https://p/new'])
    expect(out[1]).toMatchObject({ quiet: { until: null } })
  })
  it('keeps the quiet mode on a plain resubscription and drops an expired one', () => {
    expect(replaceSubscription([sub('https://p/a', { until: 5000 })], sub('https://p/a'), undefined, active)[0]).toMatchObject({ quiet: { until: 5000 } })
    expect(replaceSubscription([sub('https://p/old', { until: 10 })], sub('https://p/new'), 'https://p/old', active)).toEqual([sub('https://p/new')])
  })
  it('ignores a previous endpoint that is not a string', () => {
    const out = replaceSubscription([sub('https://p/a')], sub('https://p/b'), 42, active)
    expect(out.map(s => s.endpoint)).toEqual(['https://p/a', 'https://p/b'])
  })
})
