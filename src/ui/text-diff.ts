export interface DiffPart {
  kind: 'same' | 'remove' | 'add';
  text: string;
}

const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Preserve exact text while bounding comparison work for large replacements. */
export function textDiff(before: string, after: string): DiffPart[] {
  const a = [...words.segment(before)].map((word) => word.segment);
  const b = [...words.segment(after)].map((word) => word.segment);
  const anchors = a.map((word) => /[\p{L}\p{N}\p{S}]/u.test(word));
  const parts: DiffPart[] = [];
  function append(kind: DiffPart['kind'], text: string) {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous?.kind === kind) previous.text += text;
    else parts.push({ kind, text });
  }
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  append('same', a.slice(0, start).join(''));
  const n = a.length - start - end,
    m = b.length - start - end;
  if ((n + 1) * (m + 1) > 250000) {
    append('remove', a.slice(start, start + n).join(''));
    append('add', b.slice(start, start + m).join(''));
  } else {
    const width = m + 1;
    const matches = (i: number, j: number) =>
      anchors[start + i] && a[start + i] === b[start + j];
    const lengths = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lengths[i * width + j] = matches(i, j)
          ? 1 + lengths[(i + 1) * width + j + 1]!
          : Math.max(
              lengths[(i + 1) * width + j]!,
              lengths[i * width + j + 1]!,
            );
    let i = 0,
      j = 0,
      fromA = 0,
      fromB = 0;
    function flush() {
      const removed = a.slice(start + fromA, start + i).join('');
      const added = b.slice(start + fromB, start + j).join('');
      if (removed === added) append('same', removed);
      else {
        append('remove', removed);
        append('add', added);
      }
    }
    while (i < n || j < m) {
      if (i < n && j < m && matches(i, j)) {
        flush();
        append('same', a[start + i++]!);
        j++;
        fromA = i;
        fromB = j;
      } else if (
        i < n &&
        (j === m ||
          lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)
      ) {
        i++;
      } else j++;
    }
    flush();
  }
  append('same', end ? a.slice(a.length - end).join('') : '');
  return parts;
}
