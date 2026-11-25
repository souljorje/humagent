export type Json =
  null | boolean | number | string | readonly Json[] | ObjectValue;
export type ObjectValue = { readonly [key: string]: Json };

export const isReservedJsonKey = (key: string) =>
  key === '__proto__' || key === 'constructor' || key === 'prototype';

/** Read an own data property without invoking a getter. */
function dataValue(source: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(source, key);
  if (!property?.enumerable || !Object.hasOwn(property, 'value'))
    throw new Error('JSON properties must be enumerable data values');
  return property.value;
}

const MAX_DEPTH = 24;
type Ancestors = Set<object>;

function copyArray(source: readonly unknown[], ancestors: Ancestors): Json {
  const { length } = source;
  if (Reflect.ownKeys(source).length !== length + 1)
    throw new Error('JSON arrays cannot have holes or extra properties');
  return Array.from({ length }, (_, index) =>
    copy(dataValue(source, String(index)), ancestors),
  );
}

function copyObject(source: object, ancestors: Ancestors): Json {
  const prototype = Object.getPrototypeOf(source);
  if (prototype !== null && prototype !== Object.prototype)
    throw new Error('JSON objects must be plain objects');
  const result: Record<string, Json> = {};
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string' || isReservedJsonKey(key))
      throw new Error('Unsupported JSON property');
    result[key] = copy(dataValue(source, key), ancestors);
  }
  return result;
}

function copyNested(source: object, ancestors: Ancestors): Json {
  if (ancestors.has(source))
    throw new Error('JSON values cannot contain cycles');
  ancestors.add(source);
  const result = Array.isArray(source)
    ? copyArray(source, ancestors)
    : copyObject(source, ancestors);
  ancestors.delete(source);
  return result;
}

function finite(value: number) {
  if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite');
  return value;
}

function copy(value: unknown, ancestors: Ancestors): Json {
  if (ancestors.size >= MAX_DEPTH) throw new Error('JSON is nested too deeply');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number') return finite(value);
  if (typeof value !== 'object')
    throw new Error('Only JSON values are supported');
  return copyNested(value, ancestors);
}

/** Copy plain JSON. Shared references are valid unless they lead back to an ancestor. */
export function cloneJson<T>(value: T): T {
  return copy(value, new Set()) as T;
}
