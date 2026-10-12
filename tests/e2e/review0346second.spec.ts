import {readFileSync} from 'node:fs'
import {expect,test} from '@playwright/test'
import {OMP_CHAT_PANE as pane,fakeHerdr} from './scenario.mjs'
const fx=(name:string)=>readFileSync(new URL(`../fixtures/${name}.txt`,import.meta.url),'utf8')
const show=(text:string|null,agent='codex')=>fakeHerdr('e2e.interaction_screen',{pane_id:pane,text,agent,status:'blocked'})
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
test('S6 browser: typed n on the old Codex card is refused before reaching the next question',async({page})=>{
 await show(fx('codex-request-increase'));await page.goto(`/#/a/${pane}`)
 await expect(page.locator('.choices-q')).toContainText('Request increase?')
 await page.locator('.composer textarea').fill('n')
 let release!:()=>void,arrive!:()=>void
 const held=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{arrive=r})
 await page.route('**/api/input',async route=>{arrive();await held;await route.continue()})
 const response=page.waitForResponse('**/api/input')
 await page.getByRole('button',{name:'Send',exact:true}).click();await arrived
 await show(fx('codex-approaching-limits'));release()
 const sent=await response;expect(sent.ok()).toBe(false)
 expect(sent.request().postDataJSON()).toMatchObject({text:'n',keys:['enter'],native:true,identity:expect.any(String)})
 expect((await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual([])
 await expect(page.locator('.composer textarea')).toHaveValue('n')
})
test('S3 browser: repeated failed reads keep the draft disabled and Terminal stays accessible',async({page})=>{
 await show(fx('claude-ask-long'),'claude');await page.goto(`/#/a/${pane}`)
 await page.locator('.choices-list button[aria-expanded]').click()
 const draft=page.locator('.choices-free textarea');await draft.fill('Keep my answer')
 await fakeHerdr('e2e.read_failure',{pane_id:pane,fail:true})
 await expect(draft).toBeDisabled();await expect(page.getByRole('status').filter({hasText:'Screen read failed'})).toBeVisible();await page.waitForTimeout(3500)
 await expect(draft).toBeDisabled();await expect(draft).toHaveValue('Keep my answer')
 await expect(page.locator('.interactive-terminal')).toHaveCount(0)
 const terminal=page.getByRole(test.info().project.name.includes('phone')?'button':'tab',{name:'Terminal',exact:true})
 await expect(terminal).toBeEnabled();await terminal.click()
 await expect(page.locator('.xterm')).toBeVisible()
})

test('S2 browser: a native menu click carries its identity and refuses a changed session',async({page})=>{
 const text=readFileSync(new URL('../fixtures/claude-resume.ansi',import.meta.url),'utf8')
 await show(text,'claude');await page.goto(`/#/a/${pane}`)
 const selected=page.locator('.menu-list button.cur')
 await expect(selected).toBeVisible()
 let release!:()=>void,arrive!:()=>void
 const held=new Promise<void>(r=>{release=r}),arrived=new Promise<void>(r=>{arrive=r})
 await page.route('**/api/menu',async route=>{arrive();await held;await route.continue()})
 const response=page.waitForResponse('**/api/menu')
 await selected.click();await arrived
 await show(text.replace('main · 244KB','feature · 512KB'),'claude');release()
 const sent=await response;expect(sent.ok()).toBe(false)
 expect(sent.request().postDataJSON()).toMatchObject({op:'select',identity:expect.any(String)})
 expect((await fakeHerdr('e2e.terminal_screen',{pane_id:pane})).keys).toEqual([])
})
