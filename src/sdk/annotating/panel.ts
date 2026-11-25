/** What the open editor allows, and what the comment panel shows. */
import type { Point } from '@/sdk/layout';
import type { PanelModel } from '@/sdk/overlay';
import type { Capture } from './capture';
import { commentDraft } from '@/plugins/comment';
import type { Draft } from './types';

export function isChanged(capture: Capture | undefined) {
  if (!capture) return false;
  const { comment, editor, saved } = capture;
  return comment !== (saved?.review.comment || '') || !!editor?.changed();
}

/** Input that the human has not saved or discarded. */
export const isUnfinished = (capture: Capture | undefined) =>
  !!capture?.saving || isChanged(capture);

export function draftOf({
  editor,
  comment,
  saved,
}: Capture): Draft | undefined {
  return editor
    ? editor.build(comment)
    : commentDraft(comment, saved?.review.kind);
}

export function panelModel(
  capture: Capture,
  writable: boolean,
  position: Point | undefined,
): PanelModel {
  const readOnly = capture.saving || !writable;
  const confirmDisabled = readOnly || !draftOf(capture);
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
