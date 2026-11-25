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

function jsonKey(key: string | symbol): string {
  if (typeof key !== 'string' || isReservedJsonKey(key))
    throw new Error('Unsupported JSON property');
  return key;
}

function copyFields(source: object, copy: (child: unknown) => Json): Json {
  if (Array.isArray(source)) {
    const keys = Reflect.ownKeys(source);
    if (keys.length !== source.length + 1)
      throw new Error('JSON arrays cannot have holes or extra properties');
    const result: Json[] = [];
    for (const key of keys) {
      if (key === 'length') continue;
      const name = jsonKey(key);
      const index = Number(name);
      if (!/^(0|[1-9]\d*)$/.test(name) || index >= source.length)
        throw new Error('JSON arrays cannot have extra properties');
      result[index] = copy(dataValue(source, name));
    }
    return result;
  }

  const prototype = Object.getPrototypeOf(source);
  if (prototype !== null && prototype !== Object.prototype)
    throw new Error('JSON objects must be plain objects');
  const result: Record<string, Json> = {};
  for (const key of Reflect.ownKeys(source)) {
    const name = jsonKey(key);
    result[name] = copy(dataValue(source, name));
  }
  return result;
}

/** Copy plain JSON. Shared references are valid unless they lead back to an ancestor. */
export function cloneJson<T>(value: T): T {
  const ancestors = new Set<object>();
  function copy(item: unknown): Json {
    if (ancestors.size >= 24) throw new Error('JSON is nested too deeply');
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item))
        throw new Error('JSON numbers must be finite');
      return item;
    }
    if (typeof item !== 'object')
      throw new Error('Only JSON values are supported');
    if (ancestors.has(item))
      throw new Error('JSON values cannot contain cycles');
    ancestors.add(item);
    const result = copyFields(item, copy);
    ancestors.delete(item);
    return result;
  }
  return copy(value) as T;
}
