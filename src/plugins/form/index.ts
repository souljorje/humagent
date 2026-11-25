/** Forms: named values from a marked form or from `window.humagent.submit()`. */
import { createElement } from '@/shared/dom';
import { definePlugin } from '@/shared/plugin';
import { formContract } from './data';
import './index.css';

export type { FormLabels, FormLocal } from './data';
export type { Submission } from './page';

export const form = definePlugin(
  formContract,
  ({ review: { data }, local }) => {
    const values = createElement('dl', { className: 'ha-form-values' });
    // Forms send readable labels for the bar. SDK calls show raw values.
    const fields =
      local?.labels.fields ??
      Object.entries(data).map(([label, value]) => ({
        label,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
    for (const { label, value } of fields)
      values.append(
        createElement('dt', { textContent: label }),
        createElement('dd', { textContent: value }),
      );
    return { title: local?.labels.title ?? 'Form', body: values };
  },
);
