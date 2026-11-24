import type {
  PageEvents,
  PageMessage,
  Requests,
  WorkspaceEvents,
} from '../shared/bridge.js';
import type { WorkspaceView } from '../shared/feedback.js';
import { errorMessage } from '../shared/errors.js';

interface Options {
  frame: HTMLIFrameElement;
  /** Where the page is served, or nothing before the first session view. */
  page(): WorkspaceView['page'] | undefined;
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

/** Talk to the page in the frame. Each page request gets exactly one reply. */
export function connectPage(options: Options) {
  const { frame, requests, events } = options;
  window.addEventListener('message', (event) => {
    const msg = event.data as PageMessage;
    const page = options.page();
    if (
      !page ||
      event.source !== frame.contentWindow ||
      typeof msg !== 'object' ||
      !msg
    )
      return;
    const current =
      event.origin === page.origin && msg.channel === page.channel;
    if (msg.method === 'hello') {
      if (current) options.hello(msg);
      return;
    }
    const attached = current && options.attached(msg);
    if ('id' in msg && typeof msg.id === 'string') {
      // After a server restart the old page still runs and gets an error.
      // Reply to the sender, not the current page address, because it can change while a request runs.
      const source = event.source as Window;
      const reply = (body: { result: unknown } | { error: string }) =>
        source.postMessage(
          { channel: msg.channel, method: 'result', id: msg.id, ...body },
          event.origin,
        );
      const handle = requests[msg.method] as (
        params: unknown,
        revision: string,
      ) => Promise<unknown>;
      (attached && Object.hasOwn(requests, msg.method)
        ? handle(msg.params, msg.revision)
        : Promise.reject(new Error('Refresh the page to reconnect.'))
      ).then(
        (result) => reply({ result }),
        (e) => {
          options.failed(errorMessage(e));
          reply({ error: errorMessage(e) });
        },
      );
    } else if (attached && Object.hasOwn(events, msg.method))
      (events[msg.method as keyof typeof events] as (params: unknown) => void)(
        msg.params,
      );
  });
  return {
    post<M extends keyof WorkspaceEvents>(
      method: M,
      params: WorkspaceEvents[M],
    ) {
      const page = options.page();
      if (page)
        frame.contentWindow?.postMessage(
          { channel: page.channel, method, params },
          page.origin,
        );
    },
  };
}
