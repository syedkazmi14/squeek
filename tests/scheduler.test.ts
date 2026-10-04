import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssessmentScheduler, type SchedulerClock } from '../packages/detection/src/scheduler.ts';
import { assess, type Assessment } from '../packages/detection/src/index.ts';
import type { Observation } from '../packages/contracts/src/observation.ts';
const observation = (text:string,revision=1):Observation => ({version:1,sessionId:'test',kind:'observation',source:{processId:1,windowHandle:'1',processStartedAt:1},revision,observedAt:0,provenance:'accessibility',coverage:'complete',spans:[{text,rect:{x:0,y:0,width:1,height:1}}]});
class Clock implements SchedulerClock {
 time=0; next=0; timers=new Map<number,{at:number;fn:()=>void}>();
 now(){return this.time;} setTimeout(fn:()=>void,ms:number){const id=++this.next;this.timers.set(id,{at:this.time+ms,fn});return id;} clearTimeout(id:unknown){this.timers.delete(id as number);}
 tick(ms:number){this.time+=ms;for(const [id,t]of this.timers)if(t.at<=this.time){this.timers.delete(id);t.fn();}}
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('debounces, caches unchanged content, clears on pause',async()=>{
 const clock=new Clock();const results:Assessment[]=[];let calls=0;const scheduler=new AssessmentScheduler({clock,assess:async o=>{calls++;return assess(o);},onResult:a=>results.push(a)});
 scheduler.observe(observation('ordinary text'));clock.tick(399);assert.equal(calls,0);clock.tick(1);await flush();assert.equal(calls,1);
 scheduler.observe(observation('ordinary text',2));assert.equal(calls,1);assert.equal(results.at(-1)?.revision,2);scheduler.pause();scheduler.observe(observation('new',3));clock.tick(500);assert.equal(calls,1);
});
test('stale in-flight results never publish and budget degrades',async()=>{
 const clock=new Clock();const results:Assessment[]=[];let finish:((a:Assessment)=>void)|undefined;
 const scheduler=new AssessmentScheduler({clock,maxRequests:1,assess:async()=>new Promise(resolve=>{finish=resolve;}),onResult:a=>results.push(a)});
 scheduler.observe(observation('old'));clock.tick(400);scheduler.observe(observation('new',2));clock.tick(400);assert.equal(results.at(-1)?.state,'unknown');
 finish?.(await assess(observation('old')));await flush();assert.ok(results.every(a=>a.revision===2));
});
test('continuous changes dispatch by one second and enforce two in flight',async()=>{
 const clock=new Clock();const results:Assessment[]=[];const scheduler=new AssessmentScheduler({clock,assess:async()=>new Promise(()=>{}),onResult:a=>results.push(a)});
 scheduler.observe(observation('a'));clock.tick(300);scheduler.observe(observation('b',2));clock.tick(300);scheduler.observe(observation('c',3));clock.tick(300);scheduler.observe(observation('d',4));clock.tick(100);
 assert.equal(scheduler.counters.requests,1);
 scheduler.observe(observation('e',5));clock.tick(400);scheduler.observe(observation('f',6));clock.tick(400);
 assert.equal(scheduler.counters.inFlight,2);assert.equal(results.at(-1)?.state,'unknown');scheduler.pause();
});
test('cache expires and changed foreground invalidates it',async()=>{
 const clock=new Clock();const scheduler=new AssessmentScheduler({clock,assess:async o=>assess(o),onResult:()=>{}});
 scheduler.observe(observation('same'));clock.tick(400);await flush();clock.tick(60000);scheduler.observe(observation('same',2));clock.tick(400);await flush();assert.equal(scheduler.counters.requests,2);
 scheduler.observe({...observation('same',3),source:{processId:2,windowHandle:'2',processStartedAt:2}});clock.tick(400);await flush();assert.equal(scheduler.counters.requests,3);
});
test('unchanged content during request updates revision without a repeated request',async()=>{
 const clock=new Clock();const results:Assessment[]=[];let finish:((a:Assessment)=>void)|undefined;
 const scheduler=new AssessmentScheduler({clock,assess:async()=>new Promise(resolve=>{finish=resolve;}),onResult:a=>results.push(a)});
 scheduler.observe(observation('same'));clock.tick(400);scheduler.observe(observation('same',2));finish?.(await assess(observation('same')));await flush();assert.equal(results.at(-1)?.revision,2);assert.equal(scheduler.counters.requests,1);
});
test('invalid request budgets cannot disable scheduler bounds',()=>{
 for(const maxRequests of [NaN,Infinity,-1,1.5])assert.throws(()=>new AssessmentScheduler({maxRequests,assess:async o=>assess(o),onResult:()=>{}}));
});
test('a new observer session accepts reset revisions and invalidates old context',async()=>{
 const clock=new Clock();const results:Assessment[]=[];const scheduler=new AssessmentScheduler({clock,assess:async o=>assess(o),onResult:a=>results.push(a)});
 scheduler.observe(observation('old',5));clock.tick(400);await flush();scheduler.observe({...observation('new',1),sessionId:'replacement'});clock.tick(400);await flush();assert.equal(scheduler.counters.requests,2);assert.equal(results.at(-1)?.revision,1);
});
test('latest content recovers when cancelled transports release saturated capacity',async()=>{
 const clock=new Clock();const results:Assessment[]=[];const pending:{o:Observation;signal:AbortSignal;finish:(a:Assessment)=>void}[]=[];
 const scheduler=new AssessmentScheduler({clock,assess:(o,signal)=>new Promise(finish=>pending.push({o,signal,finish})),onResult:a=>results.push(a)});
 scheduler.observe(observation('a'));clock.tick(400);
 scheduler.observe(observation('b',2));clock.tick(400);
 scheduler.observe(observation('c',3));clock.tick(400);
 assert.equal(pending.length,2);assert.equal(results.at(-1)?.state,'unknown');
 assert.ok(pending.every(p=>p.signal.aborted));
 // No additional observation/event should be needed to recover the latest work.
 pending[0]!.finish(await assess(pending[0]!.o));await flush();
 assert.equal(pending.length,3);assert.equal(pending[2]!.o.revision,3);
 pending[1]!.finish(await assess(pending[1]!.o));pending[2]!.finish(await assess(pending[2]!.o));await flush();
 assert.equal(results.at(-1)?.revision,3);assert.equal(results.at(-1)?.providerHealth,'local_only');
 assert.equal(scheduler.counters.inFlight,0);assert.equal(scheduler.counters.stale,2);
});
test('cache is bounded and pause counts cancellation without publishing late results',async()=>{
 const clock=new Clock();const results:Assessment[]=[];const scheduler=new AssessmentScheduler({clock,assess:o=>assess(o),onResult:a=>results.push(a)});
 for(let i=1;i<=40;i++){scheduler.observe(observation(`unique ${i}`,i));clock.tick(400);await flush();}
 assert.equal(scheduler.counters.cacheEntries,32);
 scheduler.observe({...observation('unique 40',41),spans:[{text:'unique 40',rect:{x:99,y:99,width:20,height:20}}]});
 assert.equal(scheduler.counters.requests,40);assert.equal(scheduler.counters.cacheHits,1);
 let finish:((a:Assessment)=>void)|undefined;
 const deferred=new AssessmentScheduler({clock,assess:()=>new Promise(resolve=>{finish=resolve;}),onResult:a=>results.push(a)});
 deferred.observe(observation('pending'));clock.tick(400);const count=results.length;deferred.pause();
 assert.equal(deferred.counters.cancelled,1);assert.equal(deferred.counters.cacheEntries,0);
 finish?.(await assess(observation('pending')));await flush();assert.equal(results.length,count);
});
