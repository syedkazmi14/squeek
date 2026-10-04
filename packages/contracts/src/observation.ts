export interface Rect { x: number; y: number; width: number; height: number }
export interface SourceIdentity { processId: number; windowHandle: string; processStartedAt: number }
export interface Envelope { version: 1; sessionId: string }
export interface Observation extends Envelope {
  kind: 'observation';
  source: SourceIdentity;
  revision: number;
  observedAt: number;
  provenance: 'accessibility' | 'ocr' | 'mixed';
  coverage: 'partial' | 'complete';
  spans: { text: string; rect: Rect }[];
}
export type ObserverCommand = Envelope & (
  { kind: 'hello' | 'pause' | 'shutdown' | 'foreground' | 'changes' } |
  { kind: 'observe' | 'watch'; source: SourceIdentity; region: Rect }
);
export interface Foreground extends Envelope { kind: 'foreground'; source: SourceIdentity; region: Rect; processName: 'chrome' | 'msedge' | 'Squeek.Fixture' }
export type ObserverEvent = Observation | Foreground | (Envelope & (
  { kind: 'ready' | 'stopped' } |
  { kind: 'health'; state: 'available' | 'unsupported' | 'paused' | 'unavailable'; code: string }
));
export interface EventContext { sessionId: string; source?: SourceIdentity; lastRevision: number }
