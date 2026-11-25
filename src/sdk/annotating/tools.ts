/** The tools of the plugins, in registry order. */
import type { NewReview, SavedReview, Target } from '../../shared/feedback.js';
import type { Editor, Pick, Tool } from '../../shared/plugin.js';

export type RegisteredTool = Tool & { kind: string };
/** What the human entered in the open editor. */
export interface Draft {
  saved?: SavedReview;
  /** The tool that claimed the pick, and its inline editor. */
  tool?: RegisteredTool;
  editor?: Editor;
  comment: string;
}

export function createTools() {
  const tools: RegisteredTool[] = [];
  /** The text of a node as the application wrote it, without the changes of any tool. */
  function textOf(node: Node): string {
    for (const tool of tools) {
      const original = tool.textOf?.(node);
      if (original !== undefined) return original;
    }
    if (node instanceof Text) return node.data;
    return [...node.childNodes].map(textOf).join('');
  }
  const find = (kind: string) => tools.find((tool) => tool.kind === kind);
  /**
   * The open editor builds the review first. Then a saved review asks only the tool of its kind.
   * A new review asks each tool in registry order.
   */
  function build(
    { editor, tool: owner, saved, comment }: Draft,
    target: Target,
  ): NewReview | undefined {
    const fields = editor?.build(comment);
    if (fields && owner) return { ...fields, kind: owner.kind, target };
    if (saved) {
      if (editor) return undefined;
      const { kind } = saved.review;
      const tool = find(kind);
      // A kind without its own builder can still change its comment.
      const review = tool?.build
        ? tool.build(comment)
        : comment.trim()
          ? { comment }
          : undefined;
      return review && { ...review, kind, target };
    }
    for (const tool of tools) {
      const review = tool.build?.(comment);
      if (review) return { ...review, kind: tool.kind, target };
    }
    return undefined;
  }
  /** The first tool to claim or block a pick decides it. */
  function hit(next: Pick) {
    for (const tool of tools) {
      const found = tool.hit?.(next);
      if (found) return { tool, hit: found };
    }
  }
  return {
    register(kind: string, tool: Tool) {
      tools.push({ ...tool, kind });
    },
    find,
    hit,
    build,
    textOf,
    /** Start a positioning pass. */
    layout() {
      for (const tool of tools) tool.layout?.();
    },
  };
}
export type Tools = ReturnType<typeof createTools>;
