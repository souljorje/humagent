/** A minimal reactive value. Effects that read a signal run again after it changes. */
interface Effect {
  readonly fn: () => void;
  /** The readers of each signal that the effect read in its last run. */
  readonly sources: Set<Readers>;
}
type Readers = Set<Effect>;
interface Cell<T> {
  value: T;
  readonly readers: Readers;
}
let running: Effect | undefined;
let queued: Set<Effect> | undefined;

export interface Signal<T> {
  /** Read the value. An effect that reads it depends on it. */
  (): T;
  set(value: T): void;
}

function read<T>({ readers, value }: Cell<T>) {
  if (running) {
    readers.add(running);
    running.sources.add(readers);
  }
  return value;
}
function write<T>(cell: Cell<T>, value: T) {
  if (Object.is(value, cell.value)) return;
  cell.value = value;
  cell.readers.forEach(schedule);
}
export function signal<T>(value: T): Signal<T> {
  const cell: Cell<T> = { value, readers: new Set() };
  return Object.assign(() => read(cell), {
    set: (next: T) => write(cell, next),
  });
}

function run(effect: Effect) {
  const outer = running;
  for (const readers of effect.sources) readers.delete(effect);
  effect.sources.clear();
  running = effect;
  try {
    effect.fn();
  } finally {
    running = outer;
  }
}
function runQueued() {
  const batch = queued;
  queued = undefined;
  batch?.forEach(run);
}
/** Several changes in one task cause one run. */
function schedule(effect: Effect) {
  if (!queued) {
    queued = new Set();
    queueMicrotask(runQueued);
  }
  queued.add(effect);
}
/**
 * Run a function now, and again after a signal that it read changes.
 * Return a function that runs it at once, for changes that no signal holds.
 */
export function effect(fn: () => void) {
  const self: Effect = { fn, sources: new Set() };
  run(self);
  return () => run(self);
}
