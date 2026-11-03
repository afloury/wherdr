import {readFileSync} from 'node:fs'
import {afterEach,it,expect,vi} from 'vitest'
import * as choices from '../server/utils/choices'
import {ScreenCache,keepReading} from '../server/utils/screenCache'
import {ScreenGate,mapScreenPanes} from '../server/utils/screenGate'
import {bindFunction} from './stateFunction'
import {cardKey} from '../app/utils/cardKeys'
const fx=(n:string)=>readFileSync(`tests/fixtures/${n}`,'utf8')
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('native card keyboard does not translate y/n or Tab into confirmations',()=>{
 const focus={editable:false,empty:true,control:false,overlay:false}
 for(const key of ['y','n','Tab'])expect(cardKey({key,code:key,isComposing:false} as any,focus,{digits:9,enter:true,tabs:true})).toBeNull()
})
it('S4: publishes the viewed pane at 250ms while the twenty-pane batch still takes 40s',async()=>{
 vi.useFakeTimers()
 const source=readFileSync('server/utils/state.ts','utf8')
 const panes=Array.from({length:20},(_,i)=>({id:`w1:p${i+1}`,agent:'codex',status:'blocked',agentSession:'neutral'}))
 const map=()=>new Map();const finished:string[]=[]
 const states=new Map([['',{ok:true,workspaces:[],panes:panes.map(p=>({...p,preview:'previous'}))}]])
 const choicesFor=vi.fn(async(p:any)=>{await new Promise(r=>setTimeout(r,p.id==='w1:p20'?250:4000));finished.push(p.id);return {choices:choices.screenChoices(fx('codex-request-increase.txt'),'codex'),interaction:'native'}})
 const versions=new WeakMap();const cache=new ScreenCache()
 const enrich=bindFunction(source,'enrich',{
 seenMachines:new Set(['']),mstates:states,agentBorn:new Map(panes.map(p=>[p.id,{agent:p.agent,at:null}])),
 selfUpdates:{prune:()=>{},observe:async()=>false},commands:map(),READY:new Set(),
 getMachine:()=>({transcripts:{observe:()=>{}}}),joinId:(_:string,id:string)=>id,restarts:map(),leftForGood:()=>false,lookForLeftMenu:()=>false,
 findPane:()=>null,pendingPrompts:map(),queued:map(),screenVersions:versions,mapScreenPanes,choicesFor,refreshModel:()=>{},refreshPreview:()=>{},
 previews:new Map(panes.map(p=>[p.id,{status:'blocked',at:Date.now()}])),models:new Map(panes.map(p=>[p.id,{status:'blocked',at:Date.now()}])),
 isViewed:(id:string)=>id==='w1:p20',activities:map(),ompStatuses:map(),codexFields:map(),codexStatus:{forget:()=>{},statusOf:()=>null},
 choicesCache:new ScreenCache(),askChecks:map(),takenBack:map(),seen:map(),saveBorn:()=>{},saveSeen:()=>{},saveQueued:()=>{},machineOf:()=>''})
 const publish=vi.fn(()=>JSON.parse(JSON.stringify(states.get(''))))
 const pollMachine=bindFunction(source,'pollMachine',{mstates:states,screenVersions:versions,choicesCache:cache,screenFields:(p:any)=>p,herdrOn:async()=>({panes:panes.map(p=>({pane_id:p.id,revision:7}))}),
 reduceSnapshot:()=>({ok:true,workspaces:[],panes}),HERDR_SESSION:'test',enrich,RemoteMachine:class {},getMachine:()=>({}),rebuild:publish,watchTransitions:()=>{}})
 let published=false;const run=pollMachine({key:'',local:true}).then(()=>{published=true})
 await vi.advanceTimersByTimeAsync(250);expect(finished).toEqual(['w1:p20']);expect(published).toBe(false)
 expect(publish).toHaveBeenCalledTimes(1)
 const early=publish.mock.results[0]!.value
 expect(early.panes[19]).toMatchObject({id:'w1:p20',prompt:{identity:expect.any(String)}})
 expect(early.panes[0].preview).toBe('previous')
 await vi.advanceTimersByTimeAsync(35750);expect(published).toBe(false)
 await vi.advanceTimersByTimeAsync(4000);await run;expect(published).toBe(true);expect(finished).toHaveLength(20)
 expect(publish).toHaveBeenCalledTimes(2)
 expect(states.get('')!.panes.every(p=>(p as any).prompt)).toBe(true)
})
it('S5: gates drain every finite queued pane across machines despite more incoming work',async()=>{
 vi.useFakeTimers();const gate=new ScreenGate();const started:string[]=[]
 const run=(id:string,machine:string)=>gate.run(machine,async()=>{started.push(id);await new Promise(r=>setTimeout(r,250))})
 const initial=['a','b','c'].flatMap(m=>Array.from({length:20},(_,i)=>run(`${m}${i}`,m)))
 await vi.advanceTimersByTimeAsync(250)
 const incoming=Array.from({length:20},(_,i)=>run(`extra${i}`,'a'))
 await vi.runAllTimersAsync();await Promise.all([...initial,...incoming]);expect(new Set(started).size).toBe(80)
})
it('multiple visible devices or terminals independently enable the one-second cache',()=>{
 const clients=new Map([['one',{pane:'w1:p1',visible:true}],['two',{pane:'w1:p2',visible:true}],['hidden',{pane:'w1:p3',visible:false}]])
 const terminals=new Set([{pane:'w1:p4',visible:true}])
 const viewed=bindFunction(readFileSync('server/utils/state.ts','utf8').replace('export function isViewed','function isViewed'),'isViewed',{eventClients:clients,termSessions:terminals})
 for(const id of ['w1:p1','w1:p2','w1:p4'])expect(viewed(id)).toBe(true)
 expect(viewed('w1:p3')).toBe(false)
 const c={rev:1,strict:false,at:0,choices:{},screen:null,menu:null}
 expect(keepReading(c,1,false,false,1000,viewed('w1:p1'))).toBe(false)
 expect(keepReading(c,1,false,false,1000,viewed('w1:p3'))).toBe(true)
})
it('invalidation survives a cache miss and forgetting/recreating the same pane id',()=>{
 const c=new ScreenCache();const before=c.version('w1:p1');c.delete('w1:p1');expect(c.version('w1:p1')).not.toBe(before)
 const second=c.version('w1:p1');c.forget('w1:p1');expect(c.version('w1:p1')).not.toBe(second)
})
