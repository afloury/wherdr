import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { OMP_CHAT_PANE as pane, fakeHerdr } from './scenario.mjs'
const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}.txt`,import.meta.url),'utf8')
const show = (name: string | null) => fakeHerdr('e2e.interaction_screen',{pane_id:pane,text:name ? fx(name) : null,agent:'codex',status:'blocked'})
test.afterEach(async()=>{await show(null)})
test('replaces consecutive questions and refuses an answer clicked during the stale interval',async({page},info)=>{
 await show('codex-request-increase')
 await page.goto(`/#/a/${pane}`)
 await expect(page.locator('.choices-list')).toContainText('Yes (y)')
 await page.screenshot({path:`.shots/consecutive-first-${info.project.name}.png`})
 // Hold the already-clicked request, then change the terminal behind the card.
 let release!:()=>void
 const held = new Promise<void>(r=>{release=r})
 await page.route('**/api/choose',async route=>{await held;await route.continue()})
 const response = page.waitForResponse('**/api/choose')
 await page.locator('.choices-list button').filter({hasText:'Yes (y)'}).click()
 const start = Date.now()
 await show('codex-approaching-limits')
 release()
 const stale = await response
 expect(stale.ok()).toBe(false)
 expect((await stale.json()).code).toBe('stale')
 expect((await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual([])
 await expect(page.locator('.choices-list')).toContainText('Keep current model (never show again)')
 expect(Date.now()-start).toBeLessThan(5000)
 await expect(page.locator('.choices-list')).not.toContainText('Yes (y)')
 await page.screenshot({path:`.shots/consecutive-second-${info.project.name}.png`})
 await page.unroute('**/api/choose')
 await page.locator('.choices-list button').filter({hasText:'Keep current model (never show again)'}).click()
 await expect.poll(async()=>(await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual(['enter'])
})

test('refreshes without an answer or a Herdr revision change',async({page})=>{
 await show('codex-request-increase')
 await page.goto(`/#/a/${pane}`)
 await expect(page.locator('.choices-list')).toContainText('Yes (y)')
 const start=Date.now()
 await show('codex-approaching-limits')
 await expect(page.locator('.choices-list')).toContainText('Keep current model (never show again)')
 const elapsed=Date.now()-start
 console.log(`Consecutive question refresh: ${elapsed}ms`)
 expect(elapsed).toBeLessThan(3500)
 await expect(page.locator('.choices-list')).not.toContainText('Yes (y)')
})
