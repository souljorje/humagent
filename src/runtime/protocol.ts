/** Wire contract. Task-specific intents are data, never executable handlers. */
import { batch, ReviewError } from '../shared/batch.js';
export { PROTOCOL, MAX_BYTES } from '../shared/batch.js';
import { MAX_BYTES } from '../shared/batch.js';
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type ObjectValue = { [key: string]: Json };
export interface ReviewItem {
  id: string;
  target?: ObjectValue;
  comment?: string;
  replacement?: { before: string; after: string };
  intent?: string;
  values?: ObjectValue;
}
export interface Input {
  protocol: 2;
  clientId: string;
  revision: string;
  payload: { message?: string; items: ReviewItem[] };
}
export interface Event extends Input {
  id: string;
  createdAt: string;
  status: 'queued' | 'delivered' | 'completed';
  deliveries: number;
}
export interface Lease {
  receipt: string;
  consumer: string;
  expiresAt: number;
  eventIds: string[];
}
export interface Target {
  kind: 'file' | 'url';
  value: string;
  root?: string;
  network: boolean;
}
export interface Session {
  id: string;
  title: string;
  target: Target;
  viewKey: string;
  revision: string;
  surfacePath?: string;
  ended: boolean;
  createdAt: string;
  events: Event[];
  replies: { id: string; text: string; at: string; receipt?: string }[];
  state: ObjectValue;
  stateVersion: number;
  lease?: Lease;
  acknowledged: string[];
}
export class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'Failure';
  }
}
export function ensure(
  value: unknown,
  message: string,
  code = 'INVALID_INPUT',
  status = 400,
): asserts value {
  if (!value) throw new Failure(status, code, message);
}
export function object(
  value: unknown,
): asserts value is Record<string, unknown> {
  ensure(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'Expected an object',
  );
}
export function text(
  value: unknown,
  name: string,
  limit = 4000,
  allowEmpty = false,
): asserts value is string {
  ensure(
    typeof value === 'string' &&
      (allowEmpty || value.trim().length > 0) &&
      value.length <= limit,
    `${name} must be ${allowEmpty ? '0' : '1'}–${limit} characters`,
  );
}
export function jsonValue(value: unknown, depth = 0): asserts value is Json {
  ensure(depth < 24, 'JSON is nested too deeply');
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return;
  if (typeof value === 'number') {
    ensure(Number.isFinite(value), 'Numbers must be finite');
    return;
  }
  ensure(typeof value === 'object', 'Only JSON values are supported');
  if (Array.isArray(value)) {
    for (const item of value) jsonValue(item, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value as object)) {
    ensure(
      !['__proto__', 'constructor', 'prototype'].includes(key),
      `Reserved JSON key: ${key}`,
    );
    jsonValue(item, depth + 1);
  }
}
export function boundedObject(value: unknown): asserts value is ObjectValue {
  object(value);
  jsonValue(value);
  ensure(
    Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES,
    'Payload exceeds 256 KiB',
    'TOO_LARGE',
    413,
  );
}
export function input(value: unknown): Input {
  try {
    return batch(value) as Input;
  } catch (error) {
    if (error instanceof ReviewError)
      throw new Failure(error.status, error.code, error.message);
    throw new Failure(
      400,
      'INVALID_INPUT',
      error instanceof Error ? error.message : 'Invalid input',
    );
  }
}
