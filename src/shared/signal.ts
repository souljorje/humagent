/** A minimal reactive value. Effects that read a signal run again after it changes. */
interface Effect {
  run(): void;
  /** The signals that the effect read in its last run. */
  sources: Set<Set<Effect>>;
}
let running: Effect | undefined;
let queued: Set<Effect> | undefined;

export interface Signal<T> {
  /** Read the value. An effect that reads it depends on it. */
  (): T;
  set(value: T): void;
}
export function signal<T>(value: T): Signal<T> {
  const readers = new Set<Effect>();
  const read = (() => {
    if (running) {
      readers.add(running);
      running.sources.add(readers);
    }
    return value;
  }) as Signal<T>;
  read.set = (next) => {
    if (Object.is(next, value)) return;
    value = next;
    readers.forEach(schedule);
  };
  return read;
}
/** Several changes in one task cause one run. */
function schedule(effect: Effect) {
  if (!queued) {
    queued = new Set();
    queueMicrotask(() => {
      const batch = queued!;
      queued = undefined;
      batch.forEach((item) => item.run());
    });
  }
  queued.add(effect);
}
/**
 * Run a function now, and again after a signal that it read changes.
 * Return a function that runs it at once, for changes that no signal holds.
 */
export function effect(fn: () => void) {
  const self: Effect = {
    sources: new Set(),
    run() {
      self.sources.forEach((readers) => readers.delete(self));
      self.sources.clear();
      const outer = running;
      running = self;
      try {
        fn();
      } finally {
        running = outer;
      }
    },
  };
  self.run();
  return self.run;
}
