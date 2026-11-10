import type { Json, ObjectValue } from '../shared/json.js';
import {
  LIMITS,
  type Draft,
  type DraftItem,
  type DraftLabels,
} from '../shared/feedback.js';
import { errorMessage } from '../shared/errors.js';

const FORMS = 'form[data-humagent-intent]';
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
  value.length > LIMITS.label ? `${value.slice(0, LIMITS.label - 1)}…` : value;
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

/** Read named values for the agent and readable labels for the bar. */
function readForm(form: HTMLFormElement) {
  const values: ObjectValue = Object.create(null);
  const fields: DraftLabels['fields'] = [];
  const groups = new Map<string, FormControl[]>();
  for (const el of controls(form)) {
    if (['__proto__', 'prototype', 'constructor'].includes(el.name))
      throw new Error('Reserved field name');
    groups.set(el.name, [...(groups.get(el.name) || []), el]);
  }
  for (const [name, group] of groups) {
    const first = group[0]!;
    let value: Json, shown: string, label: string;
    if (group.every((el) => isInput(el, 'checkbox'))) {
      const checked = group.filter((el) => (el as HTMLInputElement).checked);
      if (group.length === 1) {
        value = checked.length === 1;
        shown = value ? 'Yes' : 'No';
        label = ownLabel(first);
      } else {
        value = checked.map((el) => el.value);
        shown = checked.map((el) => ownLabel(el) || el.value).join(', ');
        label = groupName(first);
      }
    } else if (group.every((el) => isInput(el, 'radio'))) {
      const checked = group.find((el) => (el as HTMLInputElement).checked);
      value = checked?.value ?? null;
      shown = checked ? ownLabel(checked) || checked.value : '';
      label = groupName(first);
    } else {
      const options = (el: FormControl) =>
        hasTag(el, 'select') ? [...el.selectedOptions] : [];
      const parts = group.flatMap((el) =>
        hasTag(el, 'select') && el.multiple
          ? options(el).map((option) => option.value)
          : [el.value],
      );
      value =
        group.length === 1 && !(hasTag(first, 'select') && first.multiple)
          ? parts[0]!
          : parts;
      shown = group
        .flatMap((el) =>
          hasTag(el, 'select') ? options(el).map((o) => text(o)) : [el.value],
        )
        .join(', ');
      label = group.length === 1 ? ownLabel(first) : groupName(first);
    }
    values[name] = value;
    fields.push({ label: clip(label || name), value: clip(shown) });
  }
  const title = accessibleName(form) || form.dataset.humagentIntent!;
  return {
    values,
    labels: { title: clip(title), fields: fields.slice(0, LIMITS.labelFields) },
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

interface FormBridge {
  revision: string;
  stage(item: DraftItem, key: string, labels: DraftLabels): Promise<unknown>;
  notice(message: string): void;
}
/** Each intent form is one live draft. Every committed change saves it. */
export function createForms({ revision, stage, notice }: FormBridge) {
  // Forms with typed text that no `change` event has saved yet.
  const typing = new Set<HTMLFormElement>();
  // A failed save keeps its message until a later save succeeds.
  const failed = new Set<HTMLFormElement>();
  const key = (form: HTMLFormElement) =>
    form.id || form.dataset.humagentIntent!;
  const forms = () => document.querySelectorAll<HTMLFormElement>(FORMS);
  // Restoring and resetting dispatch input events for page scripts. Those events must not save.
  let quiet = false;
  function silently(form: HTMLFormElement, change: () => void) {
    typing.delete(form);
    quiet = true;
    try {
      change();
      form.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
      quiet = false;
    }
  }
  function status(form: HTMLFormElement, message: string) {
    let output = form.querySelector<HTMLElement>('[data-humagent-status]');
    if (!output && !message) return;
    if (!output) {
      output = document.createElement('output');
      output.dataset.humagentStatus = '';
      output.dataset.humagentUi = '';
      output.setAttribute('role', 'status');
      form.append(output);
    }
    output.textContent = message;
  }
  function save(form: HTMLFormElement) {
    typing.delete(form);
    const { values, labels } = readForm(form);
    const message = form.dataset.humagentMessage;
    return stage(
      {
        intent: form.dataset.humagentIntent!,
        values,
        ...(message ? { comment: message } : {}),
      },
      key(form),
      labels,
    ).then(
      () => failed.delete(form),
      (error: unknown) => {
        failed.add(form);
        status(form, errorMessage(error));
        notice(errorMessage(error));
      },
    );
  }
  for (const type of ['input', 'change'])
    document.addEventListener(type, (event) => {
      if (quiet || !isElement(event.target)) return;
      const form = event.target.closest<HTMLFormElement>(FORMS);
      if (!form) return;
      if (type === 'change') void save(form);
      else typing.add(form);
    });
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!isElement(form) || !hasTag(form, 'form') || !form.matches(FORMS))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void save(form);
    },
    true,
  );
  // A text field reports `change` only when it loses focus. Save typed text before the page unloads.
  window.addEventListener('beforeunload', () => {
    for (const form of typing) void save(form);
  });
  const current = (drafts: Draft[], form: HTMLFormElement) =>
    drafts.find((d) => d.key === key(form) && d.revision === revision);
  return {
    /** Refill forms from their drafts after a reload. Stale drafts stay untouched. */
    restore(drafts: Draft[]) {
      for (const form of forms()) {
        const values = current(drafts, form)?.item.values;
        if (values) silently(form, () => fill(form, values));
      }
    },
    present(drafts: Draft[]) {
      for (const form of forms())
        if (!failed.has(form))
          status(form, current(drafts, form) ? 'Added to review' : '');
    },
    reset(formKey: string) {
      for (const form of forms())
        if (key(form) === formKey) silently(form, () => form.reset());
    },
  };
}
