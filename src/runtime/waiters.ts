import type { Store } from './store.js';
import { ensure } from './validate.js';

type Interrupted = { status: 'interrupted' };

/** Agents that wait for feedback. At most one agent waits per session. */
export function createWaiters(store: Store) {
  const waiting = new Set<string>();
  const cancels = new Set<() => void>();
  return {
    isWaiting: (id: string) => waiting.has(id),
    /**
     * Resolve with the first result of `take`, after each session change.
     * Resolve with an interruption when the signal aborts. Errors from `take` reject.
     */
    wait<T>(
      id: string,
      take: () => T | null,
      signal: AbortSignal,
    ): Promise<T | Interrupted> {
      ensure(
        !waiting.has(id),
        'Another agent is already waiting',
        'LISTENER_ACTIVE',
        409,
      );
      if (signal.aborted) return Promise.resolve({ status: 'interrupted' });
      const immediate = take();
      if (immediate) return Promise.resolve(immediate);
      waiting.add(id);
      return new Promise((resolve, reject) => {
        let done = false;
        const finish = (settle: () => void) => {
          if (done) return;
          done = true;
          store.off('change', changed);
          signal.removeEventListener('abort', cancel);
          waiting.delete(id);
          cancels.delete(cancel);
          settle();
        };
        const cancel = () => finish(() => resolve({ status: 'interrupted' }));
        const changed = (session: string) => {
          if (session !== id || done) return;
          try {
            const next = take();
            if (next) finish(() => resolve(next));
          } catch (error) {
            finish(() => reject(error));
          }
        };
        store.on('change', changed);
        cancels.add(cancel);
        signal.addEventListener('abort', cancel, { once: true });
      });
    },
    cancelAll() {
      for (const cancel of cancels) cancel();
    },
  };
}
