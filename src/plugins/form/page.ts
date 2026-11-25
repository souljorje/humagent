import { createElement } from '@/shared/dom';
import { errorMessage } from '@/shared/errors';
import type {
  SavedReview,
  SaveResult,
  NewReview,
  Unsaved,
} from '@/shared/feedback';
import { cloneJson, type ObjectValue } from '@/shared/json';
import type { Json } from '@/shared/json';
import { fill, readForm } from './controls';
import { readSaved } from '@/shared/plugin';
import { formContract } from './data';

/** What a page script passes to `window.humagent.submit()`. */
export interface Submission {
  data: ObjectValue;
  comment?: string;
}

export interface FormHost {
  save(
    review: NewReview,
    options?: { key: string; local: Json },
  ): Promise<SaveResult>;
  notice(message: string): void;
  unsaved(state?: Unsaved): void;
}

function isElement(target: EventTarget | null): target is Element {
  return !!target && 'nodeType' in target && target.nodeType === 1;
}

type Form = HTMLFormElement;

interface State {
  readonly host: FormHost;
  /** Forms with typed text that is not saved yet. */
  readonly typing: Map<Form, ReturnType<typeof setTimeout>>;
  readonly saving: Set<Form>;
  readonly failed: Set<Form>;
  /** An older reply must not clear an error from a newer form change. */
  readonly latestSave: WeakMap<Form, symbol>;
  /** Restoring and resetting dispatch input events for page scripts. Those events must not save. */
  quiet: boolean;
}

const TYPING_DELAY = 300;

/** `data-humagent-form` marks a form. Its value is the review key: one pending review exists per key. */
const attribute = 'data-humagent-form';
const selector = `form[${attribute}]`;
const formKey = (form: Form) => form.getAttribute(attribute)!;

function formAround(target: EventTarget | null) {
  return isElement(target) ? target.closest<Form>(selector) : null;
}

function report({ host, typing, saving, failed }: State) {
  for (const form of failed) if (!form.isConnected) failed.delete(form);
  if (typing.size || saving.size) host.unsaved('saving');
  else host.unsaved(failed.size ? 'failed' : undefined);
}

function stopTyping({ typing }: State, form: Form) {
  clearTimeout(typing.get(form));
  typing.delete(form);
}

/** Change a form without saving it. */
function silently(state: State, form: Form, change: () => void) {
  stopTyping(state, form);
  state.failed.delete(form);
  report(state);
  state.quiet = true;
  try {
    change();
    form.dispatchEvent(new Event('input', { bubbles: true }));
  } finally {
    state.quiet = false;
  }
}

async function save(state: State, form: Form) {
  const { host, saving, failed, latestSave } = state;
  const attempt = Symbol();
  stopTyping(state, form);
  latestSave.set(form, attempt);
  failed.delete(form);
  saving.add(form);
  report(state);
  let message = '';
  try {
    const key = formKey(form);
    const { values, labels } = readForm(form, key);
    const comment = form.getAttribute(`${attribute}-comment`);
    await host.save(
      { kind: 'form', ...(comment ? { comment } : {}), data: values },
      { key, local: { labels } },
    );
  } catch (error) {
    message = errorMessage(error);
  }
  if (latestSave.get(form) !== attempt) return;
  saving.delete(form);
  if (message) failed.add(form);
  report(state);
  showStatus(form, message);
  if (message) host.notice(message);
}

/** Typed text saves shortly after typing stops. */
function onInput(state: State, { target }: Event) {
  const form = state.quiet ? null : formAround(target);
  if (!form) return;
  clearTimeout(state.typing.get(form));
  const timer = setTimeout(() => void save(state, form), TYPING_DELAY);
  state.typing.set(form, timer);
  report(state);
}

/** Choices save at once. */
function onChange(state: State, { target }: Event) {
  const form = state.quiet ? null : formAround(target);
  if (form) void save(state, form);
}

function onSubmit(state: State, event: SubmitEvent) {
  const form = event.target;
  if (!isElement(form) || !form.matches(selector)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void save(state, form as Form);
}

/** Save typed text that is still waiting when the page unloads. */
function saveTyped(state: State) {
  for (const form of state.typing.keys()) void save(state, form);
}

/** Refill forms from their pending reviews after a reload. Stale pending reviews stay untouched. */
function restore(state: State, pending: readonly SavedReview[]) {
  for (const form of document.querySelectorAll<Form>(selector)) {
    const key = formKey(form);
    const saved = pending.find(
      (item) => item.review.kind === 'form' && item.key === key,
    );
    const decoded = saved && readSaved(formContract, saved);
    if (decoded) silently(state, form, () => fill(form, decoded.review.data));
  }
}

/** Reset the form of a keyed pending review to its HTML defaults. */
function reset(state: State, { key }: SavedReview) {
  for (const form of document.querySelectorAll<Form>(selector))
    if (formKey(form) === key) silently(state, form, () => form.reset());
}

/** A page script adds named values. Each call adds a new pending review. */
async function submit(host: FormHost, value: Submission) {
  const captured = cloneJson(value);
  if (!captured || typeof captured !== 'object' || Array.isArray(captured))
    throw new Error('submit expects an object');
  return host.save({
    kind: 'form',
    ...(captured.comment ? { comment: captured.comment } : {}),
    data: captured.data,
  });
}

/** Each form with the plugin's attribute is one live pending review. Choices save at once, typed text shortly after typing stops. */
export function attachForms(host: FormHost) {
  const state: State = {
    host,
    typing: new Map(),
    saving: new Set(),
    failed: new Set(),
    latestSave: new WeakMap(),
    quiet: false,
  };
  document.addEventListener('input', (event) => onInput(state, event));
  document.addEventListener('change', (event) => onChange(state, event));
  document.addEventListener('submit', (event) => onSubmit(state, event), true);
  window.addEventListener('beforeunload', () => saveTyped(state));
  return {
    restore: (pending: readonly SavedReview[]) => restore(state, pending),
    discard: (saved: SavedReview) => reset(state, saved),
    submit: (value: Submission) => submit(host, value),
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
