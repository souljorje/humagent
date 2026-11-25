import { createElement } from '../../shared/dom.js';
import { errorMessage } from '../../shared/errors.js';
import type { SaveResult } from '../../shared/feedback.js';
import { cloneJson, type ObjectValue } from '../../shared/json.js';
import type { PageHost, PagePlugin } from '../../shared/plugin.js';
import { fill, readForm } from './controls.js';
import { formOf } from './data.js';

/** What a page script passes to `window.humagent.submit()`. */
export interface Submission {
  data: ObjectValue;
  comment?: string;
}

declare module '../../shared/plugin.js' {
  interface PageMethods {
    submit(value: Submission): Promise<SaveResult>;
  }
}

function isElement(target: EventTarget | null): target is Element {
  return !!target && 'nodeType' in target && target.nodeType === 1;
}

/** Each form with the plugin's attribute is one live pending review. Choices save at once, typed text shortly after typing stops. */
export function page(host: PageHost): PagePlugin {
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
      forms().forEach((form) => {
        const values = formOf(pending.find((saved) => saved.key === key(form)));
        if (values) silently(form, () => fill(form, values));
      });
    },
    /** Reset the form of a keyed pending review to its HTML defaults. */
    discard(saved) {
      forms().forEach((form) => {
        if (key(form) === saved.key) silently(form, () => form.reset());
      });
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
