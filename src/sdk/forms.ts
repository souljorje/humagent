import type { ObjectValue } from '../shared/json.js';
import type { FormState, StageResult, Submission } from '../shared/review.js';
import { errorMessage } from '../shared/errors.js';

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
export function formValues(form: HTMLFormElement): ObjectValue {
  const result: ObjectValue = Object.create(null);
  const groups = new Map<string, FormControl[]>();
  for (const el of controls(form)) {
    if (['__proto__', 'prototype', 'constructor'].includes(el.name))
      throw new Error('Reserved field name');
    const group = groups.get(el.name) || [];
    group.push(el);
    groups.set(el.name, group);
  }
  for (const [name, group] of groups) {
    if (
      group.every(
        (el): el is HTMLInputElement =>
          hasTag(el, 'input') && el.type === 'checkbox',
      )
    )
      result[name] =
        group.length === 1
          ? group[0]!.checked
          : group.filter((el) => el.checked).map((el) => el.value);
    else if (
      group.every(
        (el): el is HTMLInputElement =>
          hasTag(el, 'input') && el.type === 'radio',
      )
    )
      result[name] = group.find((el) => el.checked)?.value ?? null;
    else {
      const values = group.flatMap((el) =>
        hasTag(el, 'select') && el.multiple
          ? [...el.selectedOptions].map((o) => o.value)
          : [el.value],
      );
      result[name] =
        group.length === 1 && !('multiple' in group[0]! && group[0]!.multiple)
          ? values[0]!
          : values;
    }
  }
  return result;
}

/** Form values use the same ordered state queue. Staged decisions are separate snapshots. */
interface FormBridge {
  getState(): FormState;
  updateState(update: (state: FormState) => FormState): Promise<void>;
  submit(value: Submission): Promise<StageResult>;
  notice(message: string): void;
}
export function createForms({
  getState,
  updateState,
  submit,
  notice,
}: FormBridge) {
  const timers = new Map<
    HTMLFormElement,
    { timer: ReturnType<typeof setTimeout> }
  >();
  function restore() {
    for (const form of document.querySelectorAll<HTMLFormElement>(
      'form[data-humagent-intent][data-humagent-persist][id]',
    )) {
      const values = getState().forms?.[form.id];
      if (!values) continue;
      const seen = new Map();
      for (const el of controls(form)) {
        const value = values[el.name];
        if (value === undefined) continue;
        if (hasTag(el, 'input') && el.type === 'checkbox')
          el.checked = Array.isArray(value)
            ? value.includes(el.value)
            : value === true;
        else if (hasTag(el, 'input') && el.type === 'radio')
          el.checked = value === el.value;
        else if (hasTag(el, 'select') && el.multiple) {
          for (const option of el.options)
            option.selected =
              Array.isArray(value) && value.includes(option.value);
        } else if (Array.isArray(value)) {
          const index = seen.get(el.name) || 0;
          el.value = String(value[index] ?? '');
          seen.set(el.name, index + 1);
        } else el.value = String(value ?? '');
      }
      form.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function persist(form: HTMLFormElement) {
    const pending = timers.get(form);
    clearTimeout(pending?.timer);
    const values = formValues(form);
    return updateState((current) => ({
      ...current,
      forms: { ...current.forms, [form.id]: values },
    })).then(() => {
      if (timers.get(form) === pending) timers.delete(form);
    });
  }
  async function flush() {
    while (timers.size) for (const form of timers.keys()) await persist(form);
  }
  for (const type of ['input', 'change'])
    document.addEventListener(type, (event) => {
      if (!isElement(event.target)) return;
      const form = event.target.closest<HTMLFormElement>(
        'form[data-humagent-intent][data-humagent-persist][id]',
      );
      if (!form) return;
      clearTimeout(timers.get(form)?.timer);
      timers.set(form, {
        timer: setTimeout(
          () =>
            persist(form).catch((error: unknown) =>
              notice(errorMessage(error)),
            ),
          type === 'input' ? 250 : 50,
        ),
      });
    });
  document.addEventListener(
    'submit',
    async (event) => {
      const form = event.target;
      if (
        !isElement(form) ||
        !hasTag(form, 'form') ||
        !form.matches('form[data-humagent-intent]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.dataset.humagentSending) return;
      form.dataset.humagentSending = 'true';
      let output = form.querySelector<HTMLElement>('[data-humagent-status]');
      if (!output) {
        output = document.createElement('output');
        output.dataset.humagentStatus = '';
        output.dataset.humagentUi = '';
        output.setAttribute('role', 'status');
        form.append(output);
      }
      try {
        const captured = {
          intent: form.dataset.humagentIntent!,
          message: form.dataset.humagentMessage || '',
          values: formValues(form),
        };
        output.textContent = 'Adding to review…';
        await flush();
        await submit(captured);
        output.textContent = 'Added to review';
      } catch (error) {
        output.textContent = errorMessage(error);
        notice(errorMessage(error));
      } finally {
        delete form.dataset.humagentSending;
      }
    },
    true,
  );
  return { restore, flush };
}
