/** Forms: named values from a marked form or from `window.humagent.submit()`. */
import { createElement } from '../../shared/dom.js';
import type { Plugin, ReviewSummary } from '../../shared/plugin.js';
import { contract, formOf, type FormLocal } from './data.js';
import { page } from './page.js';

export type { FormLabels, FormLocal } from './data.js';
export type { Submission } from './page.js';

const labelsOf = (local: unknown) => (local as FormLocal | undefined)?.labels;

const summary: ReviewSummary = {
  title: (saved) => labelsOf(saved.local)?.title ?? 'Form',
  body(saved) {
    const data = formOf(saved);
    if (!data) return;
    const values = createElement('dl');
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
  styles: `
    .review dl{display:grid;grid-template-columns:minmax(80px,1fr) 2fr;gap:var(--ha-spacing-1) var(--ha-spacing-3);margin:var(--ha-spacing-2) 0;font-size:var(--ha-text-small)}
    .review dt{color:var(--ha-fg-muted)}
    .review dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
  `,
};

export const form: Plugin = { kind: 'form', contract, page, summary };
