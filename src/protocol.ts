/** Wire contract. Task-specific intents are data, never executable handlers. */
export const PROTOCOL = 1 as const;
export const MAX_BYTES = 256 * 1024;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
export type Kind = 'message' | 'annotation' | 'edit' | 'submission';
export interface Input { protocol: 1; clientId: string; kind: Kind; revision: string; payload: ObjectValue }
export interface Event extends Input { id: string; createdAt: string; status: 'queued' | 'delivered' | 'completed'; deliveries: number }
export interface Lease { receipt: string; consumer: string; expiresAt: number; eventIds: string[] }
export interface Target { kind: 'file' | 'url'; value: string; root?: string; network: boolean }
export interface Session {
  id: string; title: string; target: Target; viewKey: string; revision: string; ended: boolean;
  createdAt: string; events: Event[]; replies: {id: string; text: string; at: string; receipt?: string}[];
  state: ObjectValue; stateVersion: number; lease?: Lease; acknowledged: string[];
}
export class Failure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'Failure'; }
}
export function ensure(value: unknown, message: string, code = 'INVALID_INPUT', status = 400): asserts value {
  if (!value) throw new Failure(status, code, message);
}
export function object(value: unknown): asserts value is Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
}
export function text(value: unknown, name: string, limit = 4000, allowEmpty = false): asserts value is string {
  ensure(typeof value === 'string' && (allowEmpty || value.trim().length > 0) && value.length <= limit, `${name} must be ${allowEmpty ? '0' : '1'}–${limit} characters`);
}
export function jsonValue(value: unknown, depth = 0): asserts value is Json {
  ensure(depth < 24, 'JSON is nested too deeply');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { ensure(Number.isFinite(value), 'Numbers must be finite'); return; }
  ensure(typeof value === 'object', 'Only JSON values are supported');
  if (Array.isArray(value)) { for (const item of value) jsonValue(item, depth + 1); return; }
  for (const [key, item] of Object.entries(value as object)) {
    ensure(!['__proto__', 'constructor', 'prototype'].includes(key), `Reserved JSON key: ${key}`);
    jsonValue(item, depth + 1);
  }
}
export function boundedObject(value: unknown): asserts value is ObjectValue {
  object(value); jsonValue(value);
  ensure(Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES, 'Payload exceeds 256 KiB', 'TOO_LARGE', 413);
}
export function input(value: unknown): Input {
  boundedObject(value);
  ensure(value.protocol === PROTOCOL, 'Unsupported protocol version', 'PROTOCOL_MISMATCH');
  text(value.clientId, 'clientId', 100); text(value.revision, 'revision', 128);
  ensure(['message', 'annotation', 'edit', 'submission'].includes(value.kind as string), 'Unknown event kind');
  boundedObject(value.payload);
  const p = value.payload;
  if (value.kind === 'message') text(p.text, 'message');
  if (value.kind === 'annotation') { text(p.text, 'annotation'); boundedObject(p.target); }
  if (value.kind === 'edit') {
    boundedObject(p.target); text(p.before, 'before', 50000); text(p.after, 'after', 50000, true);
  }
  if (value.kind === 'submission') { text(p.intent, 'intent', 200); boundedObject(p.values); if (p.message !== undefined) text(p.message, 'message', 4000, true); }
  return { protocol: PROTOCOL, clientId: value.clientId, kind: value.kind as Kind, revision: value.revision, payload: p };
}
