import type { Plugin } from '@/shared/plugin';
import { comment } from './comment';
import { edit } from './edit';
import { form } from './form';

export const plugins: ReadonlyMap<string, Plugin> = new Map(
  Object.entries({ comment, edit, form }),
);
