/** What annotating asks the page pickers. */
import type { Pick, Picker } from './types';

type Pickers = readonly Picker[];
/** The first answer of any picker. */
function firstOf<T>(
  pickers: Pickers,
  ask: (picker: Picker) => T | undefined,
): T | undefined {
  for (const picker of pickers) {
    const answer = ask(picker);
    if (answer !== undefined) return answer;
  }
  return undefined;
}

export const pickerFor = (pickers: Pickers, kind: string) =>
  pickers.find((picker) => picker.kind === kind);

/** The text of a node as the application wrote it, without the changes of any picker. */
export function originalText(pickers: Pickers, node: Node): string {
  const original = firstOf(pickers, (picker) => picker.textOf?.(node));
  if (original !== undefined) return original;
  if (node instanceof Text) return node.data;
  return Array.from(node.childNodes, (child) =>
    originalText(pickers, child),
  ).join('');
}

/** The first picker to claim or block a pick decides it. */
export const hitPickers = (pickers: Pickers, pick: Pick) =>
  firstOf(pickers, (picker) => picker.hit(pick));

/** Start a positioning pass. */
export function layoutPickers(pickers: Pickers) {
  for (const picker of pickers) picker.layout?.();
}
