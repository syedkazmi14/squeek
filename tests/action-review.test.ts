import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionReview } from '../packages/detection/src/action-review.ts';
import { assess } from '../packages/detection/src/index.ts';
import type { Observation } from '../packages/contracts/src/observation.ts';
const observation = (text:string):Observation => ({version:1,sessionId:'test',kind:'observation',source:{processId:1,windowHandle:'1',processStartedAt:1},revision:1,observedAt:0,provenance:'accessibility',coverage:'complete',spans:[{text,rect:{x:0,y:0,width:1,height:1}}]});
test('review binds all fields, expires, and is one use',async()=>{
 const action={sourceId:'1:1:1',revision:1,recipient:'fixture',amount:'1',destination:'fixture',message:'fixture'};
 const review=new ActionReview(); const assessment=await assess(observation('ordinary text'));
 assert.equal(review.consume(action,0),false);
 const id=review.request(action,assessment,0); assert.equal(review.approve(id,{...action,amount:'2'},1),false);
 const next=review.request(action,assessment,0); assert.equal(review.approve(next,action,1),true); assert.equal(review.consume(action,2),true); assert.equal(review.consume(action,3),false);
 const expired=review.request(action,assessment,0); assert.equal(review.approve(expired,action,30000),false);
});
test('every changed field, invalidation, and stale assessment reject review',async()=>{
 const action={sourceId:'1:1:1',revision:1,recipient:'fixture',amount:'1',destination:'fixture',message:'fixture'};const assessment=await assess(observation('ordinary text'));const review=new ActionReview();
 for(const change of [{sourceId:'other'},{revision:2},{recipient:'other'},{amount:'2'},{destination:'other'},{message:'other'}]){const id=review.request(action,assessment,0);assert.equal(review.approve(id,{...action,...change},1),false);}
 const id=review.request(action,assessment,0);review.invalidate();assert.equal(review.approve(id,action,1),false);assert.throws(()=>review.request({...action,revision:2},assessment,0));
});
