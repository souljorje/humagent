/** The workspace bar. It draws a model and reports input. It makes no requests. */
import type { Plugin } from '../shared/plugin.js';
import type {
  AgentStatus,
  BarActions,
  BarModel,
  BarView,
} from './workspace.js';
import { adoptStyles, autosize, element, setText } from '../shared/dom.js';
import { icon } from '../shared/icons.js';
import { installTooltips } from '../shared/tooltips.js';
import { inputStyles } from '../shared/input-styles.js';

type Controls = Record<string, HTMLElement> & {
  frame: HTMLIFrameElement;
  instruction: HTMLTextAreaElement;
  send: HTMLButtonElement;
  end: HTMLButtonElement;
};
const AGENT_STATUS: Record<AgentStatus, string> = {
  ended: 'Session ended',
  offline: 'Connection unavailable',
  connected: 'Agent connected',
  sent: 'Feedback sent',
  working: 'Agent working',
  idle: 'No agent connected',
};

export function createBar(
  plugins: ReadonlyMap<string, Plugin>,
  actions: BarActions,
): BarView {
  const $ = <K extends keyof Controls>(name: K): Controls[K] =>
    document.getElementById(name as string) as Controls[K];
  let model: BarModel | undefined;

  $('toggle-icon').innerHTML = icon('comment');
  $('end').innerHTML = icon('power');
  $('reload-page').onclick = actions.reload;
  /** The Send icon shows the state. Hidden text keeps it readable and announced. */
  function showSendState(label: BarModel['send']) {
    if ($('send').dataset.state === label) return;
    $('send').dataset.state = label;
    const name =
      label === 'Sending…' ? 'spinner' : label === 'Sent' ? 'check' : 'send';
    $('send').innerHTML = `${icon(name)}<span class="sr-only">${label}</span>`;
  }
  showSendState('Send');
  installTooltips(document);
  adoptStyles(
    document,
    [
      inputStyles,
      ...[...plugins.values()].map(
        (plugin) => plugin.workspace?.card.styles ?? '',
      ),
    ].join('\n'),
  );

  const isOpen = () => $('bar').dataset.open === 'true';
  /** Closed, the bar is one button. Open, it shows the instruction, Send, and the pending reviews. */
  function setOpen(open: boolean) {
    if (isOpen() === open) return;
    $('bar').dataset.open = String(open);
    $('details').inert = !open;
    $('details').dataset.expanded = String(open);
    $('bar-toggle').setAttribute('aria-expanded', String(open));
    if (!open) actions.highlight();
  }
  /** The human can pick page elements only on an attached page of a live session. */
  const canComment = () =>
    !!model?.attached && !!model.session && !model.session.ended;
  /** The button opens the bar and turns annotating on. A second press reverses both. */
  function toggle(keyboard = false) {
    if (!isOpen()) {
      setOpen(true);
      if (canComment()) {
        $('frame').focus();
        actions.annotate(true, keyboard);
      }
    } else if (model?.annotating)
      // The page confirms. It keeps annotating on while it has unfinished input.
      actions.annotate(false, false);
    else setOpen(false);
  }
  const rendered = new WeakMap<HTMLElement, string>();
  /** Redraw only on change, and keep keyboard focus on the same pending review control. */
  function renderChanged(
    target: HTMLElement,
    value: unknown,
    draw: () => void,
  ) {
    const key = JSON.stringify(value);
    if (rendered.get(target) === key) return;
    const active = document.activeElement;
    const focusedId =
      active && target.contains(active)
        ? active.closest<HTMLElement>('[data-review-id]')?.dataset.reviewId
        : undefined;
    const label = active?.getAttribute('aria-label') ?? active?.textContent;
    target.replaceChildren();
    draw();
    rendered.set(target, key);
    if (focusedId) {
      const buttons = [
        ...(target
          .querySelector(`[data-review-id="${CSS.escape(focusedId)}"]`)
          ?.querySelectorAll('button') || []),
      ];
      const next =
        buttons.find(
          (el) =>
            (el.getAttribute('aria-label') ?? el.textContent) === label &&
            !el.disabled,
        ) || buttons.find((el) => !el.disabled);
      next?.focus({ preventScroll: true });
    }
  }
  function drawPending(current: BarModel, mutable: boolean) {
    for (const [
      index,
      { saved, stale, unavailable },
    ] of current.pending.entries()) {
      const review = saved.review;
      const card = plugins.get(review.kind)?.workspace?.card;
      const li = element('li', '', 'review');
      li.dataset.reviewId = review.id;
      li.dataset.stale = String(stale);
      const content = element('div', '', 'review-content');
      li.append(content);
      content.append(
        element('div', card?.title(saved) ?? review.kind, 'review-title'),
      );
      const body = card?.body?.(saved, {
        open: () =>
          li.querySelector<HTMLButtonElement>('.review-open')?.click(),
      });
      if (body) content.append(body);
      if (review.comment) content.append(element('p', review.comment));
      const status = stale
        ? 'Stale revision. Recreate or remove this review.'
        : unavailable
          ? 'Target unavailable. Inspect or remove this review.'
          : '';
      if (status) content.append(element('p', status, 'review-status'));
      if (review.target) {
        const open = element('button');
        open.disabled = !mutable || !!status;
        open.onclick = () => {
          $('frame').focus();
          actions.open(review.id);
        };
        open.className = 'review-open';
        open.setAttribute('aria-label', `Edit review ${index + 1}`);
        open.setAttribute('aria-haspopup', 'dialog');
        open.dataset.tooltip = status || 'Edit review';
        li.prepend(open);
        li.onpointerenter = () => actions.highlight(review.id);
        li.onpointerleave = () => actions.highlight();
        li.addEventListener('focusin', () => actions.highlight(review.id));
        li.addEventListener('focusout', (event) => {
          if (
            !li.contains(event.relatedTarget as Node | null) &&
            !li.matches(':hover')
          )
            actions.highlight();
        });
      }
      const remove = element('button');
      remove.disabled = !mutable;
      remove.onclick = () => actions.remove(saved);
      remove.className = 'review-remove';
      remove.innerHTML = icon('trash');
      remove.setAttribute('aria-label', `Delete review ${index + 1}`);
      li.append(remove);
      $('pending').append(li);
    }
  }
  function update(current: BarModel) {
    // The bar follows annotating: the page can turn it off, and can refuse to.
    if (model && model.annotating !== current.annotating)
      setOpen(current.annotating);
    model = current;
    setText($('agent-state'), AGENT_STATUS[current.status]);
    $('agent-indicator').dataset.state = current.status;
    $('toggle-dot').dataset.state = current.status;
    $('agent-hint').hidden = current.status !== 'idle';
    setText($('error'), current.error);
    $('error').hidden = !current.error;
    setText($('bridge-status'), current.bridgeStatus);
    setText($('instruction-status'), current.instructionStatus);
    $('connecting').hidden = !current.connecting;
    document.body.style.setProperty(
      '--frame-right',
      `${current.scrollbars.right}px`,
    );
    document.body.style.setProperty(
      '--frame-bottom',
      `${current.scrollbars.bottom}px`,
    );
    $('bar-toggle').setAttribute('aria-pressed', String(current.annotating));
    const session = current.session;
    if (!session) return;
    const title = `${session.title} · Humagent`;
    if (document.title !== title) document.title = title;
    const mutable = !session.ended;
    $('end').disabled = session.ended;
    $('update').hidden = !current.changed;
    const count = current.pending.length;
    $('toggle-count').hidden = !count;
    setText($('toggle-count'), String(count));
    $('pending-count').hidden = !count;
    $('pending-count').textContent = count ? `Pending (${count})` : '';
    renderChanged($('pending'), [current.pending, mutable], () =>
      drawPending(current, mutable),
    );
    if (
      !current.instructionPending &&
      document.activeElement !== $('instruction')
    )
      $('instruction').value = session.instruction;
    $('instruction').disabled = !mutable;
    autosize($('instruction'));
    showSendState(current.send);
    $('send').setAttribute('aria-busy', String(current.send === 'Sending…'));
    $('send').disabled =
      !current.sendable || (!count && !$('instruction').value.trim());
    $('send').dataset.tooltip = current.agent
      ? 'Send your feedback to your agent'
      : 'Connect an agent to send your feedback';
  }

  $('instruction').oninput = () => {
    autosize($('instruction'));
    actions.instruction($('instruction').value);
  };
  $('send').onclick = actions.send;
  $('bar-toggle').onclick = (event) => toggle(event.detail === 0);
  $('end').onclick = () => {
    if (confirm('End this session? Pending feedback stays saved.'))
      actions.end();
  };
  // While the page has unfinished input, the first outside press refocuses it instead of acting.
  let blockedClick = false;
  document.addEventListener(
    'pointerdown',
    (event) => {
      blockedClick = !!model?.editorDirty;
      if (!blockedClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      actions.outside();
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!blockedClick && !model?.editorDirty) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!blockedClick) actions.outside();
      blockedClick = false;
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    blockedClick = false;
    if (event.key === 'Escape' && isOpen()) {
      toggle();
      $('bar-toggle').focus();
    }
    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      !$('send').disabled
    ) {
      event.preventDefault();
      $('send').click();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!model?.instructionPending && !model?.editorDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  new ResizeObserver(actions.layout).observe($('bar'));
  window.addEventListener('resize', actions.layout);

  return {
    frame: $('frame'),
    update,
    barPosition() {
      const bar = $('bar').getBoundingClientRect();
      const frame = $('frame').getBoundingClientRect();
      return { x: bar.left - frame.left, y: bar.top - frame.top };
    },
    load(url) {
      $('frame').src = url;
    },
    focusToggle: () => $('bar-toggle').focus(),
  };
}
