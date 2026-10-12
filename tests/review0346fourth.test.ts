import {readFileSync} from 'node:fs'
import {afterEach,it,expect,vi} from 'vitest'
import * as choices from '../server/utils/choices'
import * as wait from '../server/utils/waitScreen'
import * as menus from '../shared/menuScreen'
import {ScreenCache,keepReading} from '../server/utils/screenCache'
import {ScreenGate} from '../server/utils/screenGate'
import {bindChoices,bindFunction} from './stateFunction'
const fx=(n:string)=>readFileSync(`tests/fixtures/${n}`,'utf8')
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
import * as settings from '../shared/settingsScreen'
import {classifyScreen} from '../shared/interactiveScreen'
import {parseUsageLimit} from '../shared/usageLimit'
import {isPermissionQuestion,mergeDetail} from '../server/utils/promptDetail'

function harness(n:number, latency:number) {
 const source=readFileSync('server/utils/state.ts','utf8'),cache=new ScreenCache<any>(),busy=new Set<string>()
 const panes=Array.from({length:n},(_,i)=>({id:`w1:p${i+1}`,agent:'codex',status:'blocked',agentSession:'neutral',prompt:choices.screenChoices(fx('codex-request-increase.txt'),'codex')!}))
 const states=new Map([['',{ok:true,panes}]]);let visible=true;let reads=0
 const isViewed=(id:string)=>visible&&panes.some(p=>p.id===id)
 for(const p of panes)cache.set(p.id,{rev:7,strict:false,at:-2000,choices:p.prompt,interaction:'native'})
 const gate=new ScreenGate()
 const nativeViewed=bindFunction(source,'nativeViewed',{isViewed})
 const screenMachine=()=>true
 bindFunction(source,'focusScreenGate',{screenMachine,screenRpcGate:gate,mstates:states,nativeViewed,isViewed,joinId:(_:string,id:string)=>id})()
 const read=bindChoices(source,{...choices,...wait,...menus,...settings,classifyScreen,parseUsageLimit,keepReading,isPermissionQuestion,mergeDetail,
 choicesCache:cache,screenWatch:new Map(),askChecks:new Map(),isViewed,modelControlBusy:()=>false,noteScreen:()=>{},readMenu:async()=>null,
 transcripts:{pendingClaudeQuestions:async()=>[],pendingTool:async()=>null},
 herdr:(_:string,params:any)=>gate.run('',async()=>{reads++;if(latency)await new Promise(r=>setTimeout(r,latency));return {read:{text:fx('codex-request-increase.txt')}}},params.pane_id)})
 const tick=bindFunction(source,'pollViewed',{screenMachine,keepReading,mstates:states,choicesCache:cache,nativeViewed,viewedBusy:busy,choicesFor:read,stopped:false,rebuild:()=>{},CHOICE_MS:1000})
 return {tick,gate,busy,states,hide:()=>{visible=false},show:()=>{visible=true},reads:()=>reads}
}
it('four slow viewed panes allow queued background reads to progress while viewing continues',async()=>{
 vi.useFakeTimers();vi.setSystemTime(0)
 const h=harness(4,4000);h.tick();const timer=setInterval(h.tick,250)
 let began:number|null=null
 const bg=h.gate.run('',async()=>{began=Date.now()},'background')
 await vi.advanceTimersByTimeAsync(60000)
 expect(h.reads()).toBeGreaterThan(20);expect(began).not.toBeNull();expect(began).toBeLessThanOrEqual(4000)
 h.hide();clearInterval(timer);await vi.advanceTimersByTimeAsync(16000);await bg
 expect(h.busy.size).toBe(0);expect(vi.getTimerCount()).toBe(0)
})
it('a failed remote snapshot preserves the latest viewed publication',async()=>{
 const source=readFileSync('server/utils/state.ts','utf8')
 const p={id:'remote~w1:p1',agent:'codex',agentSession:'neutral',status:'blocked',prompt:{question:'Question 1'}}
 const states=new Map([['remote',{ok:true,panes:[p]}]])
 let reject!:(e:Error)=>void;const snapshot=new Promise((_,r)=>{reject=r})
 class RemoteMachine{reportPoll(){}}
 const poll=bindFunction(source,'pollMachine',{mstates:states,herdrOn:()=>snapshot,HERDR_SESSION:'test',
 RemoteMachine,getMachine:()=>({}),rebuild:()=>{},watchTransitions:()=>{}})
 const run=poll(Object.assign(new RemoteMachine(),{key:'remote',local:false}))
 // Independent viewed publication succeeds while the older snapshot request waits.
 states.set('remote',{ok:true,panes:[{...p,prompt:{question:'Question 2'}}]})
 reject(new Error('snapshot timed out'));await run
 expect(states.get('remote')).toMatchObject({ok:false,error:'snapshot timed out',panes:[{prompt:{question:'Question 2'}}]})
})
