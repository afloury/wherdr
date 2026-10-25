import { readFileSync } from 'node:fs'
import { expect,test } from './test'
import { OMP_CHAT_PANE as pane,fakeHerdr } from './scenario.mjs'
const fx=(name:string)=>readFileSync(new URL(`../fixtures/${name}.txt`,import.meta.url),'utf8')
const show=(name:string|null,agent='codex')=>fakeHerdr('e2e.interaction_screen',{pane_id:pane,text:name?fx(name):null,agent,status:'blocked'})
test.afterEach(async({request})=>{
 await fakeHerdr('e2e.read_failure',{pane_id:pane,fail:false})
 await fakeHerdr('e2e.interaction_screen',{pane_id:pane,text:null,agent:'omp',status:'idle'})
 // The fake mutation precedes wherdr's next poll. Do not let the next spec
 // cache commands for the previous agent while its state is still published.
 await expect.poll(async()=>{
  const state=await (await request.get('/api/state')).json()
  const p=state.panes.find((p:{id:string})=>p.id===pane)
  return {agent:p?.agent,status:p?.status,prompt:p?.prompt??null}
 }).toEqual({agent:'omp',status:'idle',prompt:null})
})
test('R1: Enter on an old card refuses the new question without sending a key',{ tag: '@chromium-desktop' },async({page})=>{
 test.skip(!test.info().project.name.includes('desktop'), 'Card keyboard is a desktop control')
 await show('codex-request-increase');await page.goto(`/#/a/${pane}`)
 await expect(page.locator('.choices-list')).toContainText('Yes (y)')
 let release!:()=>void,arrive!:()=>void
 const held=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{arrive=r})
 await page.route('**/api/nav',async route=>{arrive();await held;await route.continue()})
 const response=page.waitForResponse('**/api/nav')
 await page.locator('.choices-q').click();await page.keyboard.press('Enter');await arrived
 await show('codex-approaching-limits');release()
 expect((await response).ok()).toBe(false)
 expect((await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual([])
 await page.unroute('**/api/nav')
 await expect(page.locator('.choices-q')).toContainText('lower credit usage')
 await page.locator('.choices-q').click()
 await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter')
 await expect.poll(async()=> (await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual(['up','enter'])
})

test('R1: omp Continue refuses a different question',async({page})=>{
 await show('omp-ask-multi','omp');await page.goto(`/#/a/${pane}`)
 await expect(page.locator('.choices-next')).toBeVisible()
 let release!:()=>void,arrive!:()=>void
 const held=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{arrive=r})
 await page.route('**/api/nav',async route=>{arrive();await held;await route.continue()})
 const response=page.waitForResponse('**/api/nav')
 await page.locator('.choices-next').click();await arrived
 await show('omp-approve-bash','omp');release()
 expect((await response).ok()).toBe(false)
 expect((await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual([])
})
test('R3: a transient read failure preserves the disabled card and its draft',async({page})=>{
 await show('claude-ask-long','claude');await page.goto(`/#/a/${pane}`)
 await page.locator('.choices-list button[aria-expanded]').click()
 const draft=page.locator('.choices-free textarea')
 await draft.fill('Keep this unsent answer')
 await fakeHerdr('e2e.read_failure',{pane_id:pane,fail:true})
 await expect(draft).toBeDisabled()
 await expect(draft).toHaveValue('Keep this unsent answer')
 await expect(page.locator('.choices-list')).toBeVisible()
 await expect(page.locator('.interactive-terminal')).toHaveCount(0)
 await fakeHerdr('e2e.read_failure',{pane_id:pane,fail:false})
 await expect(draft).toBeEnabled()
 await expect(draft).toHaveValue('Keep this unsent answer')
})

test('R3: a failed answer validation keeps its card and unsent draft',async({page})=>{
 await show('claude-ask-long','claude');await page.goto(`/#/a/${pane}`)
 await page.locator('.choices-list button[aria-expanded]').click()
 const draft=page.locator('.choices-free textarea')
 await draft.fill('Preserve this failed answer')
 let release!:()=>void,arrive!:()=>void
 const held=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{arrive=r})
 await page.route('**/api/choose',async route=>{arrive();await held;await route.continue()})
 const response=page.waitForResponse('**/api/choose')
 await page.locator('.choices-free button[type=submit]').click();await arrived
 await fakeHerdr('e2e.read_failure',{pane_id:pane,fail:true});release()
 expect((await response).ok()).toBe(false)
 await expect(draft).toBeDisabled()
 await expect(draft).toHaveValue('Preserve this failed answer')
 await expect(page.locator('.interactive-terminal')).toHaveCount(0)
 await fakeHerdr('e2e.read_failure',{pane_id:pane,fail:false})
 await expect(draft).toBeEnabled()
 await expect(draft).toHaveValue('Preserve this failed answer')
 expect((await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual([])
})
