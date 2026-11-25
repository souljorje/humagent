/** Prepare page requests for storage after checking their plugin contracts. */
import type { Requests } from '../shared/bridge.js';
import type {
  NewReview,
  Review,
  SavedReview,
  Target,
} from '../shared/feedback.js';
import { markerPosition, type MarkerPosition } from '../shared/marker.js';
import type { Plugin } from '../shared/plugin.js';
import { ensure, envelope, object, type Envelope } from '../shared/validate.js';

/** The plugin of an untrusted review. A review without a registered kind is refused. */
function pluginOf(plugins: ReadonlyMap<string, Plugin>, kind: string) {
  const plugin = plugins.get(kind);
  ensure(plugin, 'Unsupported review kind');
  return plugin;
}
/** Apply a plugin's rules to an untrusted review. Return the review to save. */
function checkReview(
  plugin: Plugin,
  review: Envelope,
  previous?: Review,
): NewReview {
  const { kind, contract } = plugin;
  const data = contract.validateReview(review, previous);
  return {
    kind,
    ...(review.comment ? { comment: review.comment } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(review.target ? { target: review.target } : {}),
  };
}
/** Validate the marker separately from the plugin's local data. */
function checkLocal(
  { kind, contract }: Plugin,
  target: Target | undefined,
  value: unknown,
) {
  let marker: MarkerPosition | undefined;
  if (target && value && typeof value === 'object' && 'marker' in value) {
    object(value, 'Local data');
    const { marker: position, ...fields } = value;
    marker = markerPosition(position);
    value =
      contract.validateLocal && Object.keys(fields).length ? fields : undefined;
  }
  ensure(
    value === undefined || contract.validateLocal,
    `A ${kind} review cannot include local data`,
  );
  const local = contract.validateLocal?.(value);
  if (!marker) return local;
  if (local !== undefined) object(local, 'Local data with a marker');
  return { ...local, marker };
}

/** A keyed save replaces the pending review of the same kind and key. */
export function prepareSave(
  plugins: ReadonlyMap<string, Plugin>,
  pending: readonly SavedReview[],
  { review, key, local }: Requests['save']['params'],
) {
  const input = envelope(review);
  const plugin = pluginOf(plugins, input.kind);
  const previous =
    key === undefined
      ? undefined
      : pending.find(
          (saved) => saved.review.kind === plugin.kind && saved.key === key,
        );
  const checked = checkReview(plugin, input, previous?.review);
  const privateData = checkLocal(plugin, checked.target, local);
  return {
    review: checked,
    ...(key !== undefined ? { key } : {}),
    ...(privateData !== undefined ? { local: privateData } : {}),
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
  const checked = checkReview(
    pluginOf(plugins, kind),
    envelope({
      kind,
      target,
      comment,
      data: data === undefined ? previous.data : data,
    }),
    previous,
  );
  return {
    comment: checked.comment ?? '',
    ...(data !== undefined ? { data: checked.data } : {}),
  };
}
