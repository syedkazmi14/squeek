import type { Observation } from '../../packages/contracts/src/observation.ts';
export const observation = (text: string, revision = 1): Observation => ({version:1, sessionId:'test',kind:'observation',source:{processId:1,windowHandle:'1',processStartedAt:1},revision,observedAt:0,provenance:'accessibility',coverage:'complete',spans:[{text,rect:{x:0,y:0,width:1,height:1}}]});
