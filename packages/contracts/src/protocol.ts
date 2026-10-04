import type { EventContext, ObserverCommand, ObserverEvent, Rect, SourceIdentity } from './observation.ts';

export const MAX_FRAME_BYTES = 65_536;
export const MAX_TEXT_CHARACTERS = 8_000;
export const MAX_SPANS = 200;

// Errors deliberately omit rejected content; it may contain private correspondence.
export class ProtocolError extends Error {
  constructor() { super('Invalid observer frame'); this.name = 'ProtocolError'; }
}
function invalid(): never { throw new ProtocolError(); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) invalid();
}
function integer(value: unknown, min = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) return invalid();
  return value;
}
function rectangle(value: unknown): Rect {
  const r = record(value);
  keys(r, ['x', 'y', 'width', 'height']);
  for (const name of ['x', 'y', 'width', 'height']) {
    const number = r[name];
    if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 100_000) invalid();
  }
  if ((r.width as number) <= 0 || (r.height as number) <= 0) invalid();
  return r as unknown as Rect;
}
function source(value: unknown): SourceIdentity {
  const s = record(value);
  keys(s, ['processId', 'windowHandle', 'processStartedAt']);
  if (integer(s.processId) > 2_147_483_647) invalid();
  integer(s.processStartedAt);
  if (typeof s.windowHandle !== 'string' || !/^[1-9][0-9]{0,18}$/.test(s.windowHandle) ||
      BigInt(s.windowHandle) > 9_223_372_036_854_775_807n) invalid();
  return s as unknown as SourceIdentity;
}
export function sameSource(a: SourceIdentity, b: SourceIdentity): boolean {
  return a.processId === b.processId && a.windowHandle === b.windowHandle && a.processStartedAt === b.processStartedAt;
}
function envelope(line: string, sessionId: string): Record<string, unknown> {
  if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return invalid(); }
  const value = record(parsed);
  if (value.version !== 1 || value.sessionId !== sessionId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) invalid();
  return value;
}
export function parseCommand(line: string, sessionId: string): ObserverCommand {
  const value = envelope(line, sessionId);
  if (value.kind === 'observe' || value.kind === 'watch') {
    keys(value, ['kind', 'version', 'sessionId', 'source', 'region']);
    source(value.source);
    rectangle(value.region);
  } else if (['hello', 'pause', 'shutdown', 'foreground', 'changes'].includes(value.kind as string)) {
    keys(value, ['kind', 'version', 'sessionId']);
  } else invalid();
  return value as unknown as ObserverCommand;
}
export function parseEvent(line: string, context: EventContext): ObserverEvent {
  const value = envelope(line, context.sessionId);
  if (value.kind === 'ready' || value.kind === 'stopped') {
    keys(value, ['kind', 'version', 'sessionId']);
  } else if (value.kind === 'health') {
    keys(value, ['kind', 'version', 'sessionId', 'state', 'code']);
    if (!['available', 'unsupported', 'paused', 'unavailable'].includes(value.state as string) ||
        typeof value.code !== 'string' || !/^[a-z_]{1,64}$/.test(value.code)) invalid();
  } else if (value.kind === 'foreground') {
    keys(value, ['kind', 'version', 'sessionId', 'source', 'region', 'processName']);
    source(value.source); rectangle(value.region);
    if (!['chrome', 'msedge', 'Squeek.Fixture'].includes(value.processName as string)) invalid();
  } else if (value.kind === 'observation') {
    keys(value, ['kind', 'version', 'sessionId', 'source', 'revision', 'observedAt', 'provenance', 'coverage', 'spans']);
    if (!context.source || !sameSource(source(value.source), context.source)) invalid();
    if (integer(value.revision) <= context.lastRevision) invalid();
    integer(value.observedAt);
    if (!['accessibility', 'ocr', 'mixed'].includes(value.provenance as string) ||
        !['partial', 'complete'].includes(value.coverage as string)) invalid();
    if (!Array.isArray(value.spans) || value.spans.length > MAX_SPANS) invalid();
    let total = 0;
    for (const item of value.spans) {
      const span = record(item);
      keys(span, ['text', 'rect']);
      rectangle(span.rect);
      if (typeof span.text !== 'string' || !span.text.trim()) invalid();
      total += span.text.length;
      if (total > MAX_TEXT_CHARACTERS) invalid();
    }
  } else invalid();
  return value as unknown as ObserverEvent;
}
