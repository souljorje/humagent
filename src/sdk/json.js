export function cloneJson(value) {
  const ancestors = new WeakSet();

  function check(item, depth) {
    if (depth >= 24) throw new Error('JSON is nested too deeply');
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
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw new Error('JSON objects must be plain objects');
    }
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) {
      throw new Error('JSON arrays cannot have holes or extra properties');
    }
    ancestors.add(item);
    const copy = array ? [] : {};
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (
        typeof key !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
      ) {
        throw new Error('Unsupported JSON property');
      }
      if (
        array &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)
      ) {
        throw new Error('JSON arrays cannot have extra properties');
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('JSON properties must be enumerable data values');
      }
      copy[key] = check(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
    return copy;
  }

  return check(value, 0);
}
