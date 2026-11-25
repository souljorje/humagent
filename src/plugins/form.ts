/** Forms: named values from a marked form or from `window.humagent.submit()`. */
import { cloneJson, type ObjectValue } from '../shared/json.js';
import type { SavedReview, SaveResult } from '../shared/feedback.js';
import type {
  Plugin,
  PageHost,
  PagePlugin,
  ReviewSummary,
} from '../shared/plugin.js';
import { createElement } from '../shared/dom.js';
import { errorMessage } from '../shared/errors.js';
import { ensure, object, text as limited } from '../shared/validate.js';

const FORM_LIMITS = { label: 500, labelFields: 100 } as const;

/** Readable text for a form pending review in the bar. Agents do not receive it. */
export type FormLabels = {
  title: string;
  fields: { label: string; value: string }[];
};
export type FormLocal = { labels: FormLabels };
/** What a page script passes to `window.humagent.submit()`. */
export interface Submission {
  data: ObjectValue;
  comment?: string;
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
    fields: fields.map((field) => {
      object(field, 'Field label');
      return {
        label: limited(field.label, 'Field label', FORM_LIMITS.label),
        value: limited(field.value, 'Field value', FORM_LIMITS.label, true),
      };
    }),
  };
}
/** Read the form values from a review that the host gave this plugin. */
const formOf = (saved: SavedReview | undefined) =>
  saved?.review.data as ObjectValue | undefined;

declare module '../shared/plugin.js' {
  interface PageMethods {
    submit(value: Submission): Promise<SaveResult>;
  }
}

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function isElement(target: EventTarget | null): target is Element {
  return !!target && 'nodeType' in target && target.nodeType === 1;
}
function hasTag<K extends keyof HTMLElementTagNameMap>(
  el: Element,
  tag: K,
): el is HTMLElementTagNameMap[K] {
  return el.tagName === tag.toUpperCase();
}
const isInput = (el: FormControl, type: string): el is HTMLInputElement =>
  hasTag(el, 'input') && el.type === type;
function controls(form: HTMLFormElement): FormControl[] {
  return [...form.elements].filter(
    (el): el is FormControl =>
      (hasTag(el, 'input') || hasTag(el, 'textarea') || hasTag(el, 'select')) &&
      !!el.name &&
      !el.matches(':disabled') &&
      ![
        'password',
        'file',
        'hidden',
        'submit',
        'button',
        'reset',
        'image',
      ].includes(el.type),
  );
}
const clip = (value: string) =>
  value.length > FORM_LIMITS.label
    ? `${value.slice(0, FORM_LIMITS.label - 1)}…`
    : value;
const text = (node: Node | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** Visible label text, without the text of controls inside the label. */
function labelText(label: Element | null | undefined) {
  if (!label) return '';
  const copy = label.cloneNode(true) as Element;
  for (const control of copy.querySelectorAll('input,select,textarea,button'))
    control.remove();
  return text(copy);
}
function accessibleName(el: Element | null | undefined) {
  const ids = el?.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
  return (
    el?.getAttribute('aria-label')?.trim() ||
    ids
      .map((id) => text(document.getElementById(id)))
      .join(' ')
      .trim()
  );
}
/** A radio or checkbox group is named by its fieldset. */
function groupName(el: FormControl) {
  const fieldset = el.closest('fieldset');
  return accessibleName(fieldset) || text(fieldset?.querySelector('legend'));
}
const ownLabel = (el: FormControl) =>
  accessibleName(el) || labelText(el.labels?.[0]);

function readChoices(group: HTMLInputElement[], radio: boolean) {
  if (!radio && group.length === 1) {
    const checked = group[0]!.checked;
    return { value: checked, shown: checked ? 'Yes' : 'No' };
  }
  const checked = group.filter((el) => el.checked);
  return {
    value: radio ? (checked[0]?.value ?? null) : checked.map((el) => el.value),
    shown: checked.map((el) => ownLabel(el) || el.value).join(', '),
  };
}

function readValues(group: FormControl[]) {
  const first = group[0]!;
  const scalar =
    group.length === 1 && !(hasTag(first, 'select') && first.multiple);
  return {
    value: scalar
      ? first.value
      : group.flatMap((el) =>
          hasTag(el, 'select') && el.multiple
            ? Array.from(el.selectedOptions, (option) => option.value)
            : [el.value],
        ),
    shown: group
      .flatMap((el) =>
        hasTag(el, 'select')
          ? Array.from(el.selectedOptions, text)
          : [el.value],
      )
      .join(', '),
  };
}

/** Read named values for the agent and readable labels for the bar. */
function readForm(form: HTMLFormElement, key: string) {
  const values: ObjectValue = Object.create(null);
  const fields: FormLabels['fields'] = [];
  const groups = new Map<string, FormControl[]>();
  for (const el of controls(form)) {
    if (['__proto__', 'prototype', 'constructor'].includes(el.name))
      throw new Error('Reserved field name');
    const group = groups.get(el.name);
    if (group) group.push(el);
    else groups.set(el.name, [el]);
  }
  for (const [name, group] of groups) {
    const first = group[0]!;
    const single = group.length === 1;
    const radio = group.every((el) => isInput(el, 'radio'));
    const label = single && !radio ? ownLabel(first) : groupName(first);
    const { value, shown } =
      radio || group.every((el) => isInput(el, 'checkbox'))
        ? readChoices(group, radio)
        : readValues(group);
    values[name] = value;
    fields.push({ label: clip(label || name), value: clip(shown) });
  }
  const title = accessibleName(form) || key;
  return {
    values,
    labels: {
      title: clip(title),
      fields: fields.slice(0, FORM_LIMITS.labelFields),
    },
  };
}
function fill(form: HTMLFormElement, values: ObjectValue) {
  const seen = new Map<string, number>();
  for (const el of controls(form)) {
    const value = values[el.name];
    if (value === undefined) continue;
    if (isInput(el, 'checkbox'))
      el.checked = Array.isArray(value)
        ? value.includes(el.value)
        : value === true;
    else if (isInput(el, 'radio')) el.checked = value === el.value;
    else if (hasTag(el, 'select') && el.multiple) {
      for (const option of el.options)
        option.selected = Array.isArray(value) && value.includes(option.value);
    } else if (Array.isArray(value)) {
      const index = seen.get(el.name) || 0;
      el.value = String(value[index] ?? '');
      seen.set(el.name, index + 1);
    } else el.value = String(value ?? '');
  }
}

/** Each form with the plugin's attribute is one live pending review. Choices save at once, typed text shortly after typing stops. */
function page(host: PageHost): PagePlugin {
  // `data-humagent-form` marks a form. Its value is the pending review key: one pending review exists per key.
  const FORMS = `form[${host.attribute}]`;
  const key = (form: HTMLFormElement) => form.getAttribute(host.attribute)!;
  // Forms with typed text that is not saved yet.
  const typing = new Map<HTMLFormElement, ReturnType<typeof setTimeout>>();
  const saving = new Set<HTMLFormElement>();
  const failed = new Set<HTMLFormElement>();
  const settle = (form: HTMLFormElement) => {
    clearTimeout(typing.get(form));
    typing.delete(form);
  };
  function report() {
    for (const form of failed) if (!form.isConnected) failed.delete(form);
    host.unsaved(
      typing.size || saving.size
        ? 'saving'
        : failed.size
          ? 'failed'
          : undefined,
    );
  }
  // An older reply must not clear an error from a newer form change.
  const latestSave = new WeakMap<HTMLFormElement, symbol>();
  const forms = () => document.querySelectorAll<HTMLFormElement>(FORMS);
  // Restoring and resetting dispatch input events for page scripts. Those events must not save.
  let quiet = false;
  function silently(form: HTMLFormElement, change: () => void) {
    settle(form);
    failed.delete(form);
    report();
    quiet = true;
    try {
      change();
      form.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      quiet = false;
    }
  }
  async function save(form: HTMLFormElement) {
    settle(form);
    const attempt = Symbol();
    latestSave.set(form, attempt);
    failed.delete(form);
    saving.add(form);
    report();
    let message = '';
    try {
      const formKey = key(form);
      const { values, labels } = readForm(form, formKey);
      const comment = form.getAttribute(`${host.attribute}-comment`);
      await host.save(
        { ...(comment ? { comment } : {}), data: values },
        { key: formKey, local: { labels } },
      );
    } catch (error) {
      message = errorMessage(error);
    }
    if (latestSave.get(form) !== attempt) return;
    saving.delete(form);
    if (message) failed.add(form);
    report();
    showStatus(form, message);
    if (message) host.notice(message);
  }
  for (const type of ['input', 'change'])
    document.addEventListener(type, (event) => {
      if (quiet || !isElement(event.target)) return;
      const form = event.target.closest<HTMLFormElement>(FORMS);
      if (!form) return;
      if (type === 'change') return void save(form);
      clearTimeout(typing.get(form));
      typing.set(
        form,
        setTimeout(() => void save(form), 300),
      );
      report();
    });
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!isElement(form) || !form.matches(FORMS)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void save(form as HTMLFormElement);
    },
    true,
  );
  // Save typed text that is still waiting when the page unloads.
  window.addEventListener('beforeunload', () => {
    for (const form of typing.keys()) void save(form);
  });
  /** A page script adds named values. Each call adds a new pending review. */
  async function submit(value: Submission) {
    const captured = cloneJson(value);
    if (!captured || typeof captured !== 'object' || Array.isArray(captured))
      throw new Error('submit expects an object');
    return host.save({
      ...(captured.comment ? { comment: captured.comment } : {}),
      data: captured.data,
    });
  }
  return {
    /** Refill forms from their pending reviews after a reload. Stale pending reviews stay untouched. */
    init({ pending }) {
      for (const form of forms()) {
        const values = formOf(pending.find((saved) => saved.key === key(form)));
        if (values) silently(form, () => fill(form, values));
      }
    },
    /** Reset the form of a keyed pending review to its HTML defaults. */
    discard(saved) {
      for (const form of forms())
        if (key(form) === saved.key) silently(form, () => form.reset());
    },
    api: { submit },
  };
}

/** Show a save error inside a form. An empty message clears an earlier one. */
function showStatus(form: HTMLFormElement, message: string) {
  let output = form.querySelector<HTMLElement>('[data-humagent-form-status]');
  if (!output && !message) return;
  if (!output) {
    output = createElement('output', {
      role: 'status',
      dataset: { humagentFormStatus: '', humagentUi: '' },
    });
    form.append(output);
  }
  output.textContent = message;
}

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

export const form: Plugin = {
  kind: 'form',
  contract: {
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
  },
  page,
  summary,
};
