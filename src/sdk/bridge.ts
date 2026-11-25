/** Messages between the page and the workspace. Same-window messages are not lost, so each request is sent once. */
import type {
  Bootstrap,
  Requests,
  WorkspaceEvents,
  WorkspaceMessage,
} from '@/shared/bridge';

type Call = PromiseWithResolvers<unknown>;
export interface Bridge {
  readonly boot: Bootstrap;
  /** Requests without an answer. */
  readonly calls: Map<string, Call>;
  /** Settles when the workspace attached the page. */
  readonly ready: PromiseWithResolvers<void>;
  ended: boolean;
}
export type Handlers = {
  [M in keyof WorkspaceEvents]: (params: WorkspaceEvents[M]) => void;
};

export const createBridge = (boot: Bootstrap): Bridge => ({
  boot,
  calls: new Map(),
  ready: Promise.withResolvers(),
  ended: false,
});

export function post(
  { boot }: Bridge,
  method: string,
  params: unknown,
  id?: string,
) {
  const { channel, documentId, revision, parentOrigin } = boot;
  const message = { channel, documentId, revision, method, params };
  parent.postMessage(id ? { ...message, id } : message, parentOrigin);
}

/** Send a request and wait for its one answer. */
export async function request<M extends keyof Requests>(
  bridge: Bridge,
  method: M,
  params: Requests[M]['params'],
): Promise<Requests[M]['result']> {
  await bridge.ready.promise;
  if (bridge.ended) throw new Error('The session has ended');
  const id = crypto.randomUUID();
  const call: Call = Promise.withResolvers();
  bridge.calls.set(id, call);
  post(bridge, method, params, id);
  return call.promise as Promise<Requests[M]['result']>;
}

function receive(
  { boot, calls }: Bridge,
  handlers: Handlers,
  { data, origin, source }: MessageEvent<WorkspaceMessage | undefined>,
) {
  if (
    source !== parent ||
    origin !== boot.parentOrigin ||
    data?.channel !== boot.channel
  )
    return;
  if (data.method === 'result') {
    const call = calls.get(data.id);
    calls.delete(data.id);
    if (data.error === undefined) call?.resolve(data.result);
    else call?.reject(new Error(data.error));
  } else if (Object.hasOwn(handlers, data.method))
    (handlers[data.method] as (params: unknown) => void)(data.params);
}

export function listenBridge(bridge: Bridge, handlers: Handlers) {
  window.addEventListener('message', (event) =>
    receive(bridge, handlers, event),
  );
}
