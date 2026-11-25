import type { SavedReview } from '@/shared/feedback';
import type { ObjectValue } from '@/shared/json';
import type { Contract } from '@/shared/plugin';
import { ensure, object, text as limited } from '@/shared/validate';

export const FORM_LIMITS = { label: 500, labelFields: 100 } as const;

/** Readable text for a form pending review in the bar. Agents do not receive it. */
export type FormLabels = {
  title: string;
  fields: { label: string; value: string }[];
};
export type FormLocal = { labels: FormLabels };

function fieldLabel(field: unknown) {
  object(field, 'Field label');
  return {
    label: limited(field.label, 'Field label', FORM_LIMITS.label),
    value: limited(field.value, 'Field value', FORM_LIMITS.label, true),
  };
}
function labels(value: unknown): FormLabels {
  object(value, 'Labels');
  const title = limited(value.title, 'Form title', FORM_LIMITS.label);
  const { fields } = value;
  ensure(
    Array.isArray(fields) && fields.length <= FORM_LIMITS.labelFields,
    `Labels support at most ${FORM_LIMITS.labelFields} fields`,
  );
  return {
    title,
    fields: fields.map(fieldLabel),
  };
}
/** Read the form values from a review that the host gave this plugin. */
export const formOf = (saved: SavedReview | undefined) =>
  saved?.review.data as ObjectValue | undefined;

export const contract: Contract = {
  validateReview({ data, target }) {
    ensure(target === undefined, 'A form review cannot include a target');
    object(data, 'Form');
    return data;
  },
  validateLocal(value) {
    if (value === undefined) return undefined;
    object(value, 'Local data');
    return { labels: labels(value.labels) };
  },
};
