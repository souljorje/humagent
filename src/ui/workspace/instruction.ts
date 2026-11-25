/** The typed instruction. It saves itself shortly after typing stops. */
import { errorMessage } from '@/shared/errors';
import { signal, type Signal } from '@/shared/signal';

const TYPING_DELAY = 300;

export interface Instruction {
  readonly save: (text: string) => Promise<unknown>;
  readonly failed: (message: string) => void;
  /** The typed text is not saved yet. */
  readonly pending: Signal<boolean>;
  readonly status: Signal<string>;
  text: string;
  /** Counts edits, so an older save cannot confirm newer text. */
  edits: number;
  timer?: ReturnType<typeof setTimeout>;
}

export const createInstruction = (
  save: Instruction['save'],
  failed: Instruction['failed'],
): Instruction => ({
  save,
  failed,
  pending: signal(false),
  status: signal(''),
  text: '',
  edits: 0,
});

/** Save the text now. */
export async function saveInstruction(instruction: Instruction) {
  clearTimeout(instruction.timer);
  const { edits, text } = instruction;
  try {
    await instruction.save(text);
  } catch (error) {
    instruction.status.set('Not saved');
    throw error;
  }
  // A newer edit still needs its own save.
  if (edits !== instruction.edits) return;
  instruction.pending.set(false);
  instruction.status.set('Saved.');
}

function saveTyped(instruction: Instruction) {
  saveInstruction(instruction).catch((error) =>
    instruction.failed(errorMessage(error)),
  );
}

export function editInstruction(instruction: Instruction, text: string) {
  instruction.text = text;
  instruction.edits++;
  clearTimeout(instruction.timer);
  instruction.timer = setTimeout(() => saveTyped(instruction), TYPING_DELAY);
  instruction.pending.set(true);
}
