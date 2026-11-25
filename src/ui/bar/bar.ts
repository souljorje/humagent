/** The workspace bar. It draws a model and reports input. It makes no requests. */
import type { Plugin } from '../../shared/plugin.js';
import {
  adoptStyles,
  autosize,
  createElement,
  setText,
} from '../../shared/dom.js';
import { icon } from '../../shared/icons.js';
import { installTooltips } from '../../shared/tooltips.js';
import { inputStyles } from '../../shared/input-styles.js';
import { effect, signal } from '../../shared/signal.js';
import type {
  AgentStatus,
  BarActions,
  BarModel,
  BarView,
} from '../workspace/model.js';
import { $ } from './controls.js';
import { guardOutsidePress } from './outside-press.js';
import { renderPending } from './pending.js';

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
  let model: BarModel | undefined;

  $('toggle-icon').innerHTML = icon('comment');
  $('end').innerHTML = icon('power');
  $('reload-page').onclick = actions.reload;
  /** The Send icon shows the state. Hidden text keeps it readable and announced. */
  const sendState = signal<BarModel['send']>('Send');
  effect(() => {
    const label = sendState();
    const send = $('send');
    send.dataset.state = label;
    send.setAttribute('aria-busy', String(label === 'Sending…'));
    const name =
      label === 'Sending…' ? 'spinner' : label === 'Sent' ? 'check' : 'send';
    send.innerHTML = icon(name);
    send.append(
      createElement('span', { className: 'sr-only', textContent: label }),
    );
  });
  installTooltips(document);
  adoptStyles(
    document,
    [
      inputStyles,
      ...Array.from(plugins.values(), (plugin) => plugin.summary?.styles),
    ].join('\n'),
  );

  const isOpen = signal(false);
  /** Closed, the bar is one button. Open, it shows the instruction, Send, and the pending reviews. */
  effect(() => {
    const open = isOpen();
    $('bar').dataset.open = String(open);
    $('details').inert = !open;
    $('details').dataset.expanded = String(open);
    $('bar-toggle').setAttribute('aria-expanded', String(open));
  });
  function setOpen(open: boolean) {
    isOpen.set(open);
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
    setText($('pending-count'), count ? `Pending (${count})` : '');
    renderPending(current.pending, mutable, plugins, actions);
    if (
      !current.instructionPending &&
      document.activeElement !== $('instruction')
    )
      $('instruction').value = session.instruction;
    $('instruction').disabled = !mutable;
    autosize($('instruction'));
    sendState.set(current.send);
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
  guardOutsidePress(
    () => !!model?.editorDirty,
    () => actions.outside(),
  );
  document.addEventListener('keydown', (event) => {
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
