import { isReservedJsonKey, type Json, type ObjectValue } from '@/shared/json';
import { FORM_LIMITS, type FormLabels } from './data';

type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
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
  copy
    .querySelectorAll('input,select,textarea,button')
    .forEach((control) => control.remove());
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

/** The controls of each field name, in page order. */
function groupsOf(form: HTMLFormElement) {
  const groups = new Map<string, FormControl[]>();
  for (const el of controls(form)) {
    if (isReservedJsonKey(el.name)) throw new Error('Reserved field name');
    const group = groups.get(el.name);
    if (group) group.push(el);
    else groups.set(el.name, [el]);
  }
  return groups;
}

const isGroupOf = (
  group: FormControl[],
  type: string,
): group is HTMLInputElement[] => group.every((el) => isInput(el, type));

function readGroup(group: FormControl[]) {
  if (isGroupOf(group, 'radio')) return readChoices(group, true);
  return isGroupOf(group, 'checkbox')
    ? readChoices(group, false)
    : readValues(group);
}

function readField(name: string, group: FormControl[]) {
  const first = group[0]!;
  const { value, shown } = readGroup(group);
  // A single control has its own label. A group has the label of its fieldset.
  const single = group.length === 1 && !isGroupOf(group, 'radio');
  const label = (single ? ownLabel(first) : groupName(first)) || name;
  return { name, value, label: { label: clip(label), value: clip(shown) } };
}

/** Read named values for the agent and readable labels for the bar. */
export function readForm(form: HTMLFormElement, key: string) {
  const fields = Array.from(groupsOf(form), ([name, group]) =>
    readField(name, group),
  );
  const values: Record<string, Json> = Object.create(null);
  for (const { name, value } of fields) values[name] = value;
  const labels: FormLabels = {
    title: clip(accessibleName(form) || key),
    fields: fields.slice(0, FORM_LIMITS.labelFields).map(({ label }) => label),
  };
  return { values, labels };
}
export function fill(form: HTMLFormElement, values: ObjectValue) {
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
