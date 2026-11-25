export interface DiffPart {
  kind: 'same' | 'remove' | 'add';
  text: string;
}
/** Positions of one word in both texts. */
type Match = readonly [before: number, after: number];
type Words = readonly string[];

/** The most comparisons of words. Larger changes show as one replacement. */
const COMPARISONS = 250000;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
/** Before the first word of both texts. */
const START: Match = [-1, -1];
const ANCHOR = /[\p{L}\p{N}\p{S}]/u;

const wordsOf = (text: string): Words =>
  Array.from(segmenter.segment(text), (word) => word.segment);

/** Spaces and punctuation do not align two texts. */
const aligns = (a: string | undefined, b: string | undefined) =>
  a !== undefined && a === b && ANCHOR.test(a);

function commonPrefix(a: Words, b: Words) {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a[length] === b[length]) length++;
  return length;
}

function commonSuffix(a: Words, b: Words, limit: number) {
  let length = 0;
  while (length < limit && a.at(-1 - length) === b.at(-1 - length)) length++;
  return length;
}

/** The length of the longest common subsequence from each pair of positions. Each row has `b.length + 1` values. */
function commonLengths(a: Words, b: Words) {
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i * width + j] = aligns(a[i], b[j])
        ? 1 + lengths[(i + 1) * width + j + 1]!
        : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
  return lengths;
}

/** The words that both texts share, in order. */
function matchesOf(a: Words, b: Words): Match[] {
  const width = b.length + 1;
  const lengths = commonLengths(a, b);
  const matches: Match[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (aligns(a[i], b[j])) matches.push([i++, j++]);
    else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i++;
    else j++;
  }
  return matches;
}

function replacement(removed: string, added: string): DiffPart[] {
  return removed === added
    ? [{ kind: 'same', text: removed }]
    : [
        { kind: 'remove', text: removed },
        { kind: 'add', text: added },
      ];
}

/** What changed between two matches, and the word of the second one. */
function partsUntil(
  a: Words,
  b: Words,
  [fromA, fromB]: Match,
  [i, j]: Match,
): DiffPart[] {
  const removed = a.slice(fromA + 1, i).join('');
  const added = b.slice(fromB + 1, j).join('');
  return [...replacement(removed, added), { kind: 'same', text: a[i] ?? '' }];
}

/** Each match ends one replacement. The end of both texts ends the last one. */
function alignedParts(a: Words, b: Words): DiffPart[] {
  const matches = matchesOf(a, b);
  const ends: Match[] = [...matches, [a.length, b.length]];
  return ends.flatMap((end, index) =>
    partsUntil(a, b, ends[index - 1] ?? START, end),
  );
}

/** Omit empty parts, and join neighbors of one kind. */
function joined(parts: readonly DiffPart[]): DiffPart[] {
  const result: DiffPart[] = [];
  for (const { kind, text } of parts) {
    if (!text) continue;
    const previous = result.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else result.push({ kind, text });
  }
  return result;
}

/** Preserve exact text while bounding comparison work for large replacements. */
export function textDiff(before: string, after: string): DiffPart[] {
  const a = wordsOf(before);
  const b = wordsOf(after);
  const start = commonPrefix(a, b);
  const end = commonSuffix(a, b, Math.min(a.length, b.length) - start);
  const changedA = a.slice(start, a.length - end);
  const changedB = b.slice(start, b.length - end);
  const comparisons = (changedA.length + 1) * (changedB.length + 1);
  return joined([
    { kind: 'same', text: a.slice(0, start).join('') },
    ...(comparisons > COMPARISONS
      ? replacement(changedA.join(''), changedB.join(''))
      : alignedParts(changedA, changedB)),
    { kind: 'same', text: a.slice(a.length - end).join('') },
  ]);
}
