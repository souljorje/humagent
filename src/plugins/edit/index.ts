/** Text edits: an inline editor for one text node, previews of saved edits, and a diff in the bar. */
import { createElement } from '@/shared/dom';
import { definePlugin } from '@/shared/plugin';
import { editContract } from './data';
import './index.css';
import { textDiff } from './text-diff';

const DIFF_TAG = { remove: 'del', add: 'ins', same: 'span' } as const;

export const edit = definePlugin(editContract, ({ review: { data } }) => {
  const diff = createElement('div', {
    className: 'ha-edit-diff',
    role: 'group',
    ariaLabel: 'Text changes',
  });
  for (const part of textDiff(data.before, data.after))
    diff.append(createElement(DIFF_TAG[part.kind], { textContent: part.text }));
  return { title: 'Text edit', body: diff };
});
