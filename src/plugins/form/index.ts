/** Forms: named values from a marked form or from `window.humagent.submit()`. */
import { createElement } from '@/shared/dom';
import type { Plugin, ReviewSummary } from '@/shared/plugin';
import { contract, formOf, type FormLocal } from './data';
import './index.css';

export type { FormLabels, FormLocal } from './data';
export type { Submission } from './page';

const labelsOf = (local: unknown) => (local as FormLocal | undefined)?.labels;

const summary: ReviewSummary = {
  title: (saved) => labelsOf(saved.local)?.title ?? 'Form',
  body(saved) {
    const data = formOf(saved);
    if (!data) return;
    const values = createElement('dl', { className: 'ha-form-values' });
    // Forms send readable labels for the bar. SDK calls show raw values.
    const fields =
      labelsOf(saved.local)?.fields ??
      Object.entries(data).map(([label, value]) => ({
        label,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
    for (const { label, value } of fields)
      values.append(
        createElement('dt', { textContent: label }),
        createElement('dd', { textContent: value }),
      );
    return values;
  },
};

export const form: Plugin = { ...contract, summary };
