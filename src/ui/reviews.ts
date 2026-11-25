/** Prepare page requests for storage after checking their plugin contracts. */
import type { Requests } from '@/shared/bridge';
import type { SavedReview } from '@/shared/feedback';
import type { Plugin } from '@/shared/plugin';
import { ensure, envelope, reviewComment } from '@/shared/validate';

/** The plugin of an untrusted review. A review without a registered kind is refused. */
function pluginOf(plugins: ReadonlyMap<string, Plugin>, kind: string) {
  const plugin = plugins.get(kind);
  ensure(plugin, 'Unsupported review kind');
  return plugin;
}
/** A keyed save replaces the pending review of the same kind and key. */
export function prepareSave(
  plugins: ReadonlyMap<string, Plugin>,
  pending: readonly SavedReview[],
  { review, key, local, marker }: Requests['save']['params'],
) {
  const input = envelope(review);
  const plugin = pluginOf(plugins, input.kind);
  const previous =
    key === undefined
      ? undefined
      : pending.find(
          (saved) => saved.review.kind === input.kind && saved.key === key,
        );
  const data = plugin.validateReview(input, previous?.review);
  ensure(
    local === undefined || plugin.validateLocal,
    `A ${input.kind} review cannot include local data`,
  );
  return {
    review: { ...input, data },
    key,
    marker,
    local: plugin.validateLocal?.(local),
  };
}

/** An edit keeps the saved kind and target. The plugin checks the complete review. */
export function prepareEdit(
  plugins: ReadonlyMap<string, Plugin>,
  pending: readonly SavedReview[],
  { reviewId, comment, data }: Requests['edit']['params'],
) {
  const saved = pending.find((saved) => saved.review.id === reviewId);
  if (!saved) throw new Error('Review not found');
  const previous = saved.review;
  const { kind, target } = previous;
  const plugin = pluginOf(plugins, kind);
  const input = {
    kind,
    target,
    comment: comment === undefined ? undefined : reviewComment(comment),
    data: data === undefined ? previous.data : data,
  };
  const checked = plugin.validateReview(input, previous);
  return {
    comment: input.comment ?? '',
    data: data === undefined ? undefined : checked,
  };
}
