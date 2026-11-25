/** What the open editor allows, and what the comment panel shows. */
import type { Point } from '@/sdk/layout';
import type { PanelModel } from '@/sdk/overlay';
import type { Capture } from './capture';
import { buildReview, type RegisteredTool } from './tools';

type Tools = readonly RegisteredTool[];

export function isChanged(capture: Capture | undefined) {
  if (!capture) return false;
  const { comment, editor, saved } = capture;
  return comment !== (saved?.review.comment || '') || !!editor?.changed();
}

/** Input that the human has not saved or discarded. */
export const isUnfinished = (capture: Capture | undefined) =>
  !!capture?.saving || isChanged(capture);

/** Input is valid when the inline editor accepts it and a tool builds a review from it. */
export const isValid = (tools: Tools, capture: Capture) =>
  (!capture.editor || capture.editor.valid()) &&
  !!buildReview(tools, capture, capture.target);

/** A saved review needs a change. */
export const canSave = (tools: Tools, capture: Capture) =>
  isValid(tools, capture) && (!capture.saved || isChanged(capture));

export function panelModel(
  tools: Tools,
  capture: Capture,
  writable: boolean,
  position: Point | undefined,
): PanelModel {
  const readOnly = capture.saving || !writable;
  const confirmDisabled = readOnly || !isValid(tools, capture);
  return {
    existing: !!capture.saved,
    confirmLabel: capture.editor?.confirmLabel ?? 'Add comment',
    confirmDisabled,
    saveDisabled: confirmDisabled || (!!capture.saved && !isChanged(capture)),
    readOnly,
    locked: !writable,
    error: capture.error,
    position,
  };
}
