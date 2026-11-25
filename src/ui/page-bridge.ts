/** Messages between the workspace and the page in the frame. */
import type {
  PageEvents,
  PageMessage,
  Requests,
  WorkspaceEvents,
} from '@/shared/bridge';
import type { WorkspaceView } from '@/shared/feedback';
import { errorMessage } from '@/shared/errors';

type Page = WorkspaceView['page'];
interface Options {
  frame: HTMLIFrameElement;
  /** Where the page is served, or nothing before the first session view. */
  page(): Page | undefined;
  /** Whether a message comes from the attached page document. */
  attached(msg: PageMessage): boolean;
  hello(msg: PageMessage): void;
  requests: {
    [M in keyof Requests]: (
      params: Requests[M]['params'],
      revision: string,
    ) => Promise<Requests[M]['result']>;
  };
  events: {
    [M in Exclude<keyof PageEvents, 'hello'>]: (params: PageEvents[M]) => void;
  };
  failed(message: string): void;
}
type PageRequest = Extract<PageMessage, { id: string }>;
type Reply = { result: unknown } | { error: string };

const isRequest = (msg: PageMessage): msg is PageRequest =>
  'id' in msg && typeof msg.id === 'string';

/** Reply to the sender, not the current page address, because it can change while a request runs. */
function reply(event: MessageEvent, { channel, id }: PageRequest, body: Reply) {
  (event.source as Window).postMessage(
    { channel, method: 'result', id, ...body },
    event.origin,
  );
}

/** Each page request gets exactly one reply. */
async function answer(
  { failed, requests }: Options,
  event: MessageEvent,
  msg: PageRequest,
  attached: boolean,
) {
  try {
    // After a server restart the old page still runs and gets an error.
    if (!attached || !Object.hasOwn(requests, msg.method))
      throw new Error('Refresh the page to reconnect.');
    const run = requests[msg.method] as (
      params: unknown,
      revision: string,
    ) => Promise<unknown>;
    reply(event, msg, { result: await run(msg.params, msg.revision) });
  } catch (e) {
    const error = errorMessage(e);
    failed(error);
    reply(event, msg, { error });
  }
}

function receive(options: Options, event: MessageEvent<PageMessage | null>) {
  const { events, frame } = options;
  const msg = event.data;
  const page = options.page();
  if (!page || event.source !== frame.contentWindow) return;
  if (typeof msg !== 'object' || !msg) return;
  const current = event.origin === page.origin && msg.channel === page.channel;
  if (msg.method === 'hello') {
    if (current) options.hello(msg);
    return;
  }
  const attached = current && options.attached(msg);
  if (isRequest(msg)) void answer(options, event, msg, attached);
  else if (attached && Object.hasOwn(events, msg.method))
    (events[msg.method] as (params: unknown) => void)(msg.params);
}

/** Listen to the page in the frame. */
export function connectPage(options: Options) {
  window.addEventListener('message', (event) => receive(options, event));
}

export function postToPage<M extends keyof WorkspaceEvents>(
  frame: HTMLIFrameElement,
  { channel, origin }: Page,
  method: M,
  params: WorkspaceEvents[M],
) {
  frame.contentWindow?.postMessage({ channel, method, params }, origin);
}
