/** Stream the result of one agent wait. */
import type { Store } from '@/server/sessions/store';
import { failure, JSON_HEADERS } from './http';

/** A wait can last hours. Regular spaces keep idle-connection and fetch timeouts from ending it. */
const HEARTBEAT_MS = 5000;
const SPACE = new Uint8Array([32]);

type Controller = ReadableStreamDefaultController<Uint8Array>;
interface Wait {
  readonly stop: AbortController;
  readonly result: Promise<unknown>;
  beat?: ReturnType<typeof setInterval>;
}

async function stream(wait: Wait, controller: Controller) {
  wait.beat = setInterval(() => controller.enqueue(SPACE), HEARTBEAT_MS);
  const value = await wait.result;
  clearInterval(wait.beat);
  try {
    controller.enqueue(Buffer.from(JSON.stringify(value)));
    controller.close();
  } catch {
    // The agent disconnected. Unfinished feedback returns on its next wait.
  }
}

function cancel({ beat, stop }: Wait) {
  clearInterval(beat);
  stop.abort();
}

export function waitResponse({ signal }: Request, store: Store, id: string) {
  const stop = new AbortController();
  signal.addEventListener('abort', () => stop.abort(), { once: true });
  // Ownership and session errors throw here, before the response starts.
  const wait: Wait = {
    stop,
    result: store.wait(id, stop.signal).catch(failure),
  };
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => void stream(wait, controller),
    cancel: () => cancel(wait),
  });
  return new Response(body, { headers: JSON_HEADERS });
}
