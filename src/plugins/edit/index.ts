/** Text edits: an inline editor for one text node, previews of saved edits, and a diff in the bar. */
import { createElement } from '@/shared/dom';
import { LIMITS } from '@/shared/feedback';
import type { Contract, Plugin, ReviewSummary } from '@/shared/plugin';
import { ensure, object, text } from '@/shared/validate';
import { editOf, type EditData } from './data';
import './index.css';
import { textDiff } from './text-diff';

const DIFF_TAG = { remove: 'del', add: 'ins', same: 'span' } as const;

const summary: ReviewSummary = {
  title: () => 'Text edit',
  body(saved) {
    const data = editOf(saved);
    if (!data) return;
    const diff = createElement('div', {
      className: 'ha-edit-diff',
      role: 'group',
      ariaLabel: 'Text changes',
    });
    for (const part of textDiff(data.before, data.after))
      diff.append(
        createElement(DIFF_TAG[part.kind], { textContent: part.text }),
      );
    return diff;
  },
};

// Repeated edits keep the original text.
const contract: Contract = {
  validateReview({ data, target }, previous) {
    ensure(target, 'An edit review requires a target');
    object(data, 'Edit');
    const saved = previous?.data as EditData | undefined;
    return {
      before: saved
        ? saved.before
        : text(data.before, 'Edit before', LIMITS.text),
      after: text(data.after, 'Edit after', LIMITS.text, true),
    };
  },
};

export const edit: Plugin = { ...contract, summary };
