/** A review kind owns its data rules and the summary of its saved reviews. */
import type { Review, SavedReview } from './feedback';
import type { Json } from './json';
import { Failure, type Envelope } from './validate';

export interface Contract<
  Data extends Json | undefined = Json | undefined,
  Local extends Json = Json,
> {
  /** An edit or a keyed replacement also receives the previous review. */
  validateReview(review: Envelope, previous?: Review): Data;
  validateLocal?(value: unknown): Local | undefined;
}

export type DecodedReview<
  Data extends Json | undefined,
  Local extends Json = Json,
> = SavedReview & {
  readonly review: Review & { readonly data: Data };
  readonly local?: Local;
};

interface Summary {
  title: string;
  body?: Node;
}

export interface Plugin extends Contract {
  summary?(saved: SavedReview): Summary | undefined;
}

/** The server stores opaque JSON. A review with unrecognized data keeps its generic row. */
export function readSaved<Data extends Json | undefined, Local extends Json>(
  contract: Contract<Data, Local>,
  saved: SavedReview,
): DecodedReview<Data, Local> | undefined {
  try {
    const data = contract.validateReview(saved.review);
    const local = contract.validateLocal?.(saved.local);
    return { ...saved, review: { ...saved.review, data }, local };
  } catch (error) {
    if (error instanceof Failure) return undefined;
    throw error;
  }
}

export function definePlugin<Data extends Json | undefined, Local extends Json>(
  contract: Contract<Data, Local>,
  summarize: (saved: DecodedReview<Data, Local>) => Summary,
): Plugin {
  return {
    ...contract,
    summary(saved) {
      const decoded = readSaved(contract, saved);
      return decoded && summarize(decoded);
    },
  };
}
