function controls(form) {
  return [...form.elements].filter(
    (el) =>
      el.name &&
      !el.matches(':disabled') &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) &&
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
export function formValues(form) {
  const result = Object.create(null),
    groups = new Map();
  for (const el of controls(form)) {
    if (['__proto__', 'prototype', 'constructor'].includes(el.name))
      throw new Error('Reserved field name');
    const group = groups.get(el.name) || [];
    group.push(el);
    groups.set(el.name, group);
  }
  for (const [name, group] of groups) {
    if (group.every((el) => el.type === 'checkbox'))
      result[name] =
        group.length === 1
          ? group[0].checked
          : group.filter((el) => el.checked).map((el) => el.value);
    else if (group.every((el) => el.type === 'radio'))
      result[name] = group.find((el) => el.checked)?.value ?? null;
    else {
      const values = group.flatMap((el) =>
        el.tagName === 'SELECT' && el.multiple
          ? [...el.selectedOptions].map((o) => o.value)
          : [el.value],
      );
      result[name] =
        group.length === 1 && !group[0].multiple ? values[0] : values;
    }
  }
  return result;
}

/** Form values use the same ordered state queue. Staged decisions are separate snapshots. */
export function createForms({ getState, updateState, submit, notice }) {
  const timers = new Map();
  function restore() {
    for (const form of document.querySelectorAll(
      'form[data-humagent-intent][data-humagent-persist][id]',
    )) {
      const values = getState().forms?.[form.id];
      if (!values) continue;
      const seen = new Map();
      for (const el of controls(form)) {
        const value = values[el.name];
        if (value === undefined) continue;
        if (el.type === 'checkbox')
          el.checked = Array.isArray(value)
            ? value.includes(el.value)
            : value === true;
        else if (el.type === 'radio') el.checked = value === el.value;
        else if (el.multiple) {
          for (const option of el.options)
            option.selected =
              Array.isArray(value) && value.includes(option.value);
        } else if (Array.isArray(value)) {
          const index = seen.get(el.name) || 0;
          el.value = value[index] ?? '';
          seen.set(el.name, index + 1);
        } else el.value = value ?? '';
      }
      form.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function persist(form) {
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
      const form = event.target.closest?.(
        'form[data-humagent-intent][data-humagent-persist][id]',
      );
      if (!form) return;
      clearTimeout(timers.get(form)?.timer);
      timers.set(form, {
        timer: setTimeout(
          () => persist(form).catch((error) => notice(error.message)),
          type === 'input' ? 250 : 50,
        ),
      });
    });
  document.addEventListener(
    'submit',
    async (event) => {
      const form = event.target;
      if (!form.matches?.('form[data-humagent-intent]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.dataset.humagentSending) return;
      form.dataset.humagentSending = 'true';
      let output = form.querySelector('[data-humagent-status]');
      if (!output) {
        output = document.createElement('output');
        output.dataset.humagentStatus = '';
        output.dataset.humagentUi = '';
        output.setAttribute('role', 'status');
        form.append(output);
      }
      try {
        const captured = {
          intent: form.dataset.humagentIntent,
          message: form.dataset.humagentMessage || '',
          values: formValues(form),
        };
        output.textContent = 'Adding to review…';
        await flush();
        await submit(captured);
        output.textContent = 'Added to review';
      } catch (error) {
        output.textContent = error.message;
        notice(error.message);
      } finally {
        delete form.dataset.humagentSending;
      }
    },
    true,
  );
  return { restore, flush };
}
