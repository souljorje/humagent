/** What annotating asks the tools of the plugins. */
import type { Pick, Tool } from './types';

export type RegisteredTool = Tool & { kind: string };
type Tools = readonly RegisteredTool[];
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

/** The first tool to claim or block a pick decides it. */
export const hitTools = (tools: Tools, pick: Pick) =>
  firstOf(tools, (tool) => tool.hit?.(pick));

/** Start a positioning pass. */
export function layoutTools(tools: Tools) {
  for (const tool of tools) tool.layout?.();
}
