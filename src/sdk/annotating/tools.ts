/** What annotating asks the tools of the plugins. */
import type { NewReview, SavedReview, Target } from '@/shared/feedback';
import type { Editor, Pick, Tool } from './types';

export type RegisteredTool = Tool & { kind: string };
type Tools = readonly RegisteredTool[];
/** What the human entered in the open editor. */
export interface Draft {
  saved?: SavedReview;
  /** The tool that claimed the pick, and its inline editor. */
  tool?: RegisteredTool;
  editor?: Editor;
  comment: string;
}

/** The first answer of any tool. */
function firstOf<T>(
  tools: Tools,
  ask: (tool: RegisteredTool) => T | undefined,
): T | undefined {
  for (const tool of tools) {
    const answer = ask(tool);
    if (answer !== undefined) return answer;
  }
  return undefined;
}

export const findTool = (tools: Tools, kind: string) =>
  tools.find((tool) => tool.kind === kind);

/** The text of a node as the application wrote it, without the changes of any tool. */
export function originalText(tools: Tools, node: Node): string {
  const original = firstOf(tools, (tool) => tool.textOf?.(node));
  if (original !== undefined) return original;
  if (node instanceof Text) return node.data;
  return Array.from(node.childNodes, (child) =>
    originalText(tools, child),
  ).join('');
}

function buildWith(
  tool: RegisteredTool,
  comment: string,
  target: Target,
): NewReview | undefined {
  const review = tool.build?.(comment);
  return review && { ...review, kind: tool.kind, target };
}

/**
 * The open editor builds the review first. Then a saved review asks only the tool of its kind.
 * A new review asks each tool in registry order.
 */
export function buildReview(
  tools: Tools,
  { editor, tool: owner, saved, comment }: Draft,
  target: Target,
): NewReview | undefined {
  const fields = editor?.build(comment);
  if (fields && owner) return { ...fields, kind: owner.kind, target };
  if (!saved) return firstOf(tools, (tool) => buildWith(tool, comment, target));
  if (editor) return undefined;
  const { kind } = saved.review;
  const tool = findTool(tools, kind);
  if (tool?.build) return buildWith(tool, comment, target);
  // A kind without its own builder can still change its comment.
  return comment.trim() ? { comment, kind, target } : undefined;
}

function hitWith(tool: RegisteredTool, pick: Pick) {
  const hit = tool.hit?.(pick);
  return hit && { tool, hit };
}

/** The first tool to claim or block a pick decides it. */
export const hitTools = (tools: Tools, pick: Pick) =>
  firstOf(tools, (tool) => hitWith(tool, pick));

/** Start a positioning pass. */
export function layoutTools(tools: Tools) {
  for (const tool of tools) tool.layout?.();
}
