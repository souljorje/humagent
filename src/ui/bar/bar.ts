/** The workspace bar. It draws a model and reports input. It makes no requests. */
import { autosize, createElement, setText } from '@/shared/dom';
import type { WorkspaceView } from '@/shared/feedback';
import { icon } from '@/shared/icons';
import type { Plugin } from '@/shared/plugin';
import { effect, signal, type Signal } from '@/shared/signal';
import { installTooltips } from '@/shared/tooltips';
import type {
  AgentStatus,
  BarActions,
  BarModel,
  BarView,
} from '@/ui/workspace/model';
import { $ } from './controls';
import { guardOutsidePress } from './outside-press';
import { renderPending } from './pending';

const AGENT_STATUS: Record<AgentStatus, string> = {
  ended: 'Session ended',
  offline: 'Connection unavailable',
  connected: 'Agent connected',
  sent: 'Feedback sent',
  working: 'Agent working',
  idle: 'No agent connected',
};
const SEND_ICON = {
  Send: 'send',
  'Sending…': 'spinner',
  Sent: 'check',
} as const;

interface Bar {
  readonly plugins: ReadonlyMap<string, Plugin>;
  readonly actions: BarActions;
  readonly isOpen: Signal<boolean>;
  readonly sendState: Signal<BarModel['send']>;
  /** The shown model. */
  model?: BarModel;
}

/** The Send icon shows the state. Hidden text keeps it readable and announced. */
function drawSend(label: BarModel['send']) {
  const send = $('send');
  send.dataset.state = label;
  send.setAttribute('aria-busy', String(label === 'Sending…'));
  send.innerHTML = icon(SEND_ICON[label]);
  send.append(
    createElement('span', { className: 'sr-only', textContent: label }),
  );
}

/** Closed, the bar is one button. Open, it shows the instruction, Send, and the pending reviews. */
function drawOpen(open: boolean) {
  $('bar').dataset.open = String(open);
  $('details').inert = !open;
  $('bar-toggle').setAttribute('aria-expanded', String(open));
}

function setOpen({ isOpen, actions }: Bar, open: boolean) {
  isOpen.set(open);
  if (!open) actions.highlight();
}

/** The button opens the bar and turns annotating on. A second press reverses both. */
function toggle(bar: Bar, keyboard = false) {
  const { actions, isOpen, model } = bar;
  if (!isOpen()) {
    setOpen(bar, true);
    // The human can pick page elements only on an attached page of a live session.
    if (!model?.attached || !model.session || model.session.ended) return;
    $('frame').focus();
    actions.annotate(true, keyboard);
  }
  // The page confirms. It keeps annotating on while it has unfinished input.
  else if (model?.annotating) actions.annotate(false, false);
  else setOpen(bar, false);
}

/** Draw what does not need a session. */
function drawState(model: BarModel) {
  const { status, scrollbars } = model;
  const { style } = document.body;
  setText($('agent-state'), AGENT_STATUS[status]);
  $('agent-indicator').dataset.state = status;
  $('toggle-dot').dataset.state = status;
  $('agent-hint').hidden = status !== 'idle';
  setText($('error'), model.error);
  $('error').hidden = !model.error;
  setText($('bridge-status'), model.bridgeStatus);
  setText($('instruction-status'), model.instructionStatus);
  $('connecting').hidden = !model.connecting;
  // Keep the bar clear of the page's scrollbars.
  style.setProperty('--frame-right', `${scrollbars.right}px`);
  style.setProperty('--frame-bottom', `${scrollbars.bottom}px`);
  $('bar-toggle').setAttribute('aria-pressed', String(model.annotating));
}

function drawSession(
  { actions, plugins, sendState }: Bar,
  model: BarModel,
  session: WorkspaceView,
) {
  const { ended } = session;
  const count = model.pending.length;
  const title = `${session.title} · Humagent`;
  const instruction = $('instruction');
  if (document.title !== title) document.title = title;
  $('end').disabled = ended;
  $('update').hidden = !model.changed;
  $('toggle-count').hidden = !count;
  setText($('toggle-count'), String(count));
  $('pending-count').hidden = !count;
  setText($('pending-count'), count ? `Pending (${count})` : '');
  renderPending(model.pending, !ended, plugins, actions);
  // The human's typed text wins until it is saved.
  if (!model.instructionPending && document.activeElement !== instruction)
    instruction.value = session.instruction;
  instruction.disabled = ended;
  autosize(instruction);
  sendState.set(model.send);
  $('send').disabled = !model.sendable || (!count && !instruction.value.trim());
  $('send').dataset.tooltip = model.agent
    ? 'Send your feedback to your agent'
    : 'Connect an agent to send your feedback';
}

function update(bar: Bar, model: BarModel) {
  // The bar follows annotating: the page can turn it off, and can refuse to.
  if (bar.model && bar.model.annotating !== model.annotating)
    setOpen(bar, model.annotating);
  bar.model = model;
  drawState(model);
  if (model.session) drawSession(bar, model, model.session);
}

function onInstruction(actions: BarActions) {
  autosize($('instruction'));
  actions.instruction($('instruction').value);
}

function end(actions: BarActions) {
  if (confirm('End this session? Pending feedback stays saved.')) actions.end();
}

function onKeydown(bar: Bar, event: KeyboardEvent) {
  const send = $('send');
  const submits = event.key === 'Enter' && (event.ctrlKey || event.metaKey);
  if (event.key === 'Escape' && bar.isOpen()) {
    toggle(bar);
    $('bar-toggle').focus();
  } else if (submits && !send.disabled) {
    event.preventDefault();
    send.click();
  }
}

function onBeforeunload({ model }: Bar, event: BeforeUnloadEvent) {
  if (!model?.instructionPending && !model?.editorDirty) return;
  event.preventDefault();
  event.returnValue = '';
}

function listen(bar: Bar) {
  const { actions } = bar;
  $('reload-page').onclick = actions.reload;
  $('instruction').oninput = () => onInstruction(actions);
  $('send').onclick = actions.send;
  $('bar-toggle').onclick = (event) => toggle(bar, event.detail === 0);
  $('end').onclick = () => end(actions);
  guardOutsidePress(
    () => !!bar.model?.editorDirty,
    () => actions.outside(),
  );
  document.addEventListener('keydown', (event) => onKeydown(bar, event));
  window.addEventListener('beforeunload', (e) => onBeforeunload(bar, e));
  new ResizeObserver(actions.layout).observe($('bar'));
  window.addEventListener('resize', actions.layout);
}

/** Top-left corner of the bar, in frame viewport pixels. */
function barPosition() {
  const bar = $('bar').getBoundingClientRect();
  const frame = $('frame').getBoundingClientRect();
  return { x: bar.left - frame.left, y: bar.top - frame.top };
}

export function createBar(
  plugins: ReadonlyMap<string, Plugin>,
  actions: BarActions,
): BarView {
  const bar: Bar = {
    plugins,
    actions,
    isOpen: signal(false),
    sendState: signal<BarModel['send']>('Send'),
  };
  $('toggle-icon').innerHTML = icon('comment');
  $('end').innerHTML = icon('power');
  effect(() => drawSend(bar.sendState()));
  installTooltips(document);
  effect(() => drawOpen(bar.isOpen()));
  listen(bar);
  return {
    frame: $('frame'),
    update: (model) => update(bar, model),
    barPosition,
    load(url) {
      $('frame').src = url;
    },
    focusToggle: () => $('bar-toggle').focus(),
  };
}
