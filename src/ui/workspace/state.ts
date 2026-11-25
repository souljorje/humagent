/** The state of the workspace. State that the bar shows lives in signals. */
import type { WorkspaceEvents } from '@/shared/bridge';
import type { WorkspaceView } from '@/shared/feedback';
import type { Plugin } from '@/shared/plugin';
import { signal, type Signal } from '@/shared/signal';
import { postToPage } from '@/ui/page-bridge';
import type { Session } from '@/ui/session';
import { createInstruction, type Instruction } from './instruction';
import type { BarModel, BarView } from './model';
import { createPageInput, type PageInput } from './page-input';

export interface Workspace {
  readonly plugins: ReadonlyMap<string, Plugin>;
  readonly server: Session;
  readonly session: Signal<WorkspaceView | undefined>;
  /** The page document attached to the server, after its handshake. */
  readonly page: Signal<{ documentId: string; revision: string } | undefined>;
  readonly connected: Signal<boolean>;
  readonly annotating: Signal<boolean>;
  readonly input: PageInput;
  readonly instruction: Instruction;
  readonly sending: Signal<boolean>;
  readonly sent: Signal<boolean>;
  readonly message: Signal<string>;
  readonly bridgeStatus: Signal<string>;
  readonly connecting: Signal<boolean>;
  readonly scrollbars: Signal<BarModel['scrollbars']>;
  readonly available: Signal<ReadonlyMap<string, boolean>>;
  // Not shown in the bar, so no effect depends on these.
  /** The bar, after the start. */
  view?: BarView;
  /** Draw the bar now. */
  render(): void;
  attaching?: string;
  lastPresentation: string;
  /** The source revision that last reloaded the page on its own. */
  reloadedFor: string;
  sentTimer?: ReturnType<typeof setTimeout>;
}

export const createState = (
  plugins: Workspace['plugins'],
  server: Session,
  message: Signal<string>,
): Workspace => ({
  plugins,
  server,
  session: signal<WorkspaceView | undefined>(undefined),
  page: signal<{ documentId: string; revision: string } | undefined>(undefined),
  connected: signal(false),
  annotating: signal(false),
  input: createPageInput(),
  instruction: createInstruction(server.setInstruction, message.set),
  sending: signal(false),
  sent: signal(false),
  message,
  bridgeStatus: signal('Connecting'),
  connecting: signal(true),
  scrollbars: signal({ right: 0, bottom: 0 }),
  available: signal<ReadonlyMap<string, boolean>>(new Map()),
  render: () => {},
  lastPresentation: '',
  reloadedFor: '',
});

/** Show an error above the bar. Without a message, clear the error. */
export function fail({ message }: Workspace, text = '') {
  message.set(text);
}

/** Whether a revision matches both the server and the attached page. */
export const isFresh = ({ session, page }: Workspace, revision?: string) =>
  revision === session()?.revision && revision === page()?.revision;

/** Load the page in the frame. */
export function loadPage({ view }: Workspace, { page }: WorkspaceView) {
  view?.load(page.frameUrl);
}

export function post<M extends keyof WorkspaceEvents>(
  { session, view }: Workspace,
  method: M,
  params: WorkspaceEvents[M],
) {
  const page = session()?.page;
  if (view && page) postToPage(view.frame, page, method, params);
}
