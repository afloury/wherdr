import { describe, expect, it } from 'vitest'
import { canPan, clampView, detailScale, fitScale, fitView, isZoomed, toggleZoom, wheelFactor, zoomAt, zoomBounds } from '../app/utils/imageZoom'

const phone = { w: 366, h: 640 }
const desktop = { w: 1416, h: 780 }
const tall = { w: 1170, h: 9000 } // a column of phone screenshots
const small = { w: 200, h: 100 }

describe('fitScale', () => {
  it('fits the whole image, by its limiting side', () => {
    expect(fitScale(tall, desktop)).toBeCloseTo(780 / 9000)
    expect(fitScale({ w: 2880, h: 1800 }, phone)).toBeCloseTo(366 / 2880)
  })
  it('never enlarges a small image', () => {
    expect(fitScale(small, desktop)).toBe(1)
  })
  it('falls back to 1 for an unknown size', () => {
    expect(fitScale({ w: 0, h: 0 }, desktop)).toBe(1)
    expect(fitScale(tall, { w: 0, h: 0 })).toBe(1)
  })
})

describe('fitView', () => {
  it('centres the fitted image', () => {
    const v = fitView(tall, desktop)
    expect(v.y).toBeCloseTo(0)
    expect(v.x).toBeCloseTo((1416 - 1170 * v.scale) / 2)
    expect(canPan(v, tall, desktop)).toBe(false)
    expect(isZoomed(v, tall, desktop)).toBe(false)
  })
})

describe('detailScale', () => {
  it('reads a tall capture at actual size on a wide screen', () => {
    expect(detailScale(tall, desktop)).toBe(1)
  })
  it('fills the width on a phone', () => {
    expect(detailScale(tall, phone)).toBeCloseTo(366 / 1170)
  })
  it('at least doubles the fit', () => {
    expect(detailScale(small, desktop)).toBe(2)
    const wide = { w: 2880, h: 1800 }
    expect(detailScale(wide, phone)).toBeCloseTo(2 * fitScale(wide, phone))
  })
})

describe('clampView', () => {
  it('keeps the scale within the bounds', () => {
    const { min, max } = zoomBounds(tall, desktop)
    expect(clampView({ scale: 0.001, x: 0, y: 0 }, tall, desktop).scale).toBe(min)
    expect(clampView({ scale: 100, x: 0, y: 0 }, tall, desktop).scale).toBe(max)
  })
  it('leaves no gap at the edges of an overflowing image', () => {
    // 1170 × 9000 at 1 in 1416 × 780: narrower than the box, taller.
    expect(clampView({ scale: 1, x: 50, y: 300 }, tall, desktop)).toEqual({ scale: 1, x: (1416 - 1170) / 2, y: 0 })
    expect(clampView({ scale: 1, x: 0, y: -99999 }, tall, desktop).y).toBe(780 - 9000)
    expect(clampView({ scale: 1, x: 0, y: -4000 }, tall, desktop).y).toBe(-4000)
  })
  it('pans both ways when larger than the box on both axes', () => {
    const v = clampView({ scale: 1, x: -500, y: -500 }, tall, phone)
    expect(v).toEqual({ scale: 1, x: -500, y: -500 })
    expect(clampView({ scale: 1, x: -5000, y: 10 }, tall, phone)).toEqual({ scale: 1, x: 366 - 1170, y: 0 })
  })
})

describe('zoomAt', () => {
  it('keeps the point under the cursor in place', () => {
    const v0 = { scale: 0.5, x: -100, y: -2000 }
    const v = zoomAt(v0, 1, 100, 300, tall, phone)
    // Image point under (100, 300) before: ((100 + 100) / 0.5, (300 + 2000) / 0.5).
    expect(v.scale).toBe(1)
    expect((100 - v.x) / v.scale).toBeCloseTo(400)
    expect((300 - v.y) / v.scale).toBeCloseTo(4600)
  })
  it('clamps the scale and the position', () => {
    const fit = fitView(tall, phone)
    expect(zoomAt(fit, 0.0001, 0, 0, tall, phone)).toEqual(fit)
  })
})

describe('toggleZoom', () => {
  it('zooms in at the tapped point, then back to the fit', () => {
    const fit = fitView(tall, phone)
    const zoomed = toggleZoom(fit, 183, 10, tall, phone)
    expect(zoomed.scale).toBeCloseTo(366 / 1170)
    expect((10 - zoomed.y) / zoomed.scale).toBeCloseTo(10 / fit.scale) // the tapped row stays under the finger
    expect(canPan(zoomed, tall, phone)).toBe(true)
    expect(isZoomed(zoomed, tall, phone)).toBe(true)
    expect(toggleZoom(zoomed, 183, 10, tall, phone)).toEqual(fit)
  })
})

describe('wheelFactor', () => {
  it('zooms in when scrolling up, out when down, and caps a big step', () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1)
    expect(wheelFactor(100, 0)).toBeLessThan(1)
    expect(wheelFactor(3, 1)).toBeCloseTo(wheelFactor(48, 0))
    expect(wheelFactor(10000, 0)).toBeCloseTo(wheelFactor(300, 0))
  })
})
