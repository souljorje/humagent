/** Send the pending reviews and the instruction. */
import { errorMessage } from '@/shared/errors';
import { saveInstruction } from './instruction';
import { inputSettled } from './page-input';
import { fail, type Workspace } from './state';

const SENT_TIME = 1500;

/** Wait until the page saved its input. The page can change while it saves. */
async function saveInput({ input, page }: Workspace) {
  if (input.unsaved() !== 'saving') return;
  const waiting = page()?.documentId;
  await inputSettled(input);
  if (input.unsaved() || page()?.documentId !== waiting)
    throw new Error('Some page input is not saved. Check it, then send.');
}

export async function send(w: Workspace) {
  if (w.sending()) return;
  w.sending.set(true);
  w.sent.set(false);
  clearTimeout(w.sentTimer);
  try {
    if (w.instruction.pending()) await saveInstruction(w.instruction);
    await saveInput(w);
    if (w.input.editorDirty())
      throw new Error('Save or cancel your review before sending.');
    await w.server.send(w.page()?.revision);
    fail(w);
    w.sent.set(true);
    w.sentTimer = setTimeout(() => w.sent.set(false), SENT_TIME);
  } catch (e) {
    fail(w, errorMessage(e));
  } finally {
    w.sending.set(false);
  }
}
