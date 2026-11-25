/** Stream the result of one agent wait. */
import { failure, JSON_HEADERS } from './http.js';
import type { Store } from '../sessions/store.js';

/** A wait can last hours. Regular spaces keep idle-connection and fetch timeouts from ending it. */
const HEARTBEAT_MS = 5000;

export function waitResponse(request: Request, store: Store, id: string) {
  const stop = new AbortController();
  request.signal.addEventListener('abort', () => stop.abort(), { once: true });
  // Ownership and session errors throw here, before the response starts.
  const result = store.wait(id, stop.signal).catch(failure);
  let beat: ReturnType<typeof setInterval> | undefined;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        beat = setInterval(
          () => controller.enqueue(new Uint8Array([32])),
          HEARTBEAT_MS,
        );
        void result.then((value) => {
          clearInterval(beat);
          try {
            controller.enqueue(Buffer.from(JSON.stringify(value)));
            controller.close();
          } catch {
            // The agent disconnected. Unfinished feedback returns on its next wait.
          }
        });
      },
      cancel() {
        clearInterval(beat);
        stop.abort();
      },
    }),
    { headers: JSON_HEADERS },
  );
}
