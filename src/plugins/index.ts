/**
 * The page host and the workspace use these built-in plugins.
 * The SDK asks tools in registry order. `comment` builds a review from any comment, so it stays after `edit`.
 */
import type { Plugin } from '../shared/plugin.js';
import { comment } from './comment.js';
import { edit } from './edit/index.js';
import { form } from './form/index.js';

/** Index plugins by kind, in the given order. Two plugins with one kind are a programming error. */
function registry(plugins: Plugin[]): ReadonlyMap<string, Plugin> {
  const byKind = new Map<string, Plugin>();
  for (const plugin of plugins) {
    if (byKind.has(plugin.kind))
      throw new Error(`Duplicate plugin kind: ${plugin.kind}`);
    byKind.set(plugin.kind, plugin);
  }
  return byKind;
}

export const plugins = registry([edit, comment, form]);
