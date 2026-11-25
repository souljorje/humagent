import type { Plugin } from '@/shared/plugin';
import { comment } from './comment';
import { edit } from './edit';
import { form } from './form';

/** Index plugins by kind. Two plugins with one kind are a programming error. */
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
