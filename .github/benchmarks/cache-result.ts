import { stripVTControlCharacters } from "node:util";

export type CacheResult = "hit" | "miss" | "partial" | "unknown";

function counts(hits: number, total: number, successful: number): CacheResult {
  if (total <= 0 || hits > total || successful !== total) return "unknown";
  if (hits === total) return "hit";
  return hits === 0 ? "miss" : "partial";
}

// Read the runner's result, including zero hits. Replayed task output alone does
// not establish a hit, and an absent hit message does not establish a miss.
export function cacheResult(tool: "turbo" | "vite-task", output: string): CacheResult {
  const text = stripVTControlCharacters(output);
  if (tool === "turbo") {
    const cached = [...text.matchAll(/^Cached:\s+(\d+) cached, (\d+) total\s*$/gm)].at(-1);
    const tasks = [...text.matchAll(/^\s*Tasks:\s+(\d+) successful, (\d+) total\s*$/gm)].at(-1);
    if (!cached || !tasks || cached[2] !== tasks[2]) return "unknown";
    return counts(Number(cached[1]), Number(cached[2]), Number(tasks[1]));
  }
  const summary = [...text.matchAll(/^vp run: (\d+)\/(\d+) cache hits? \(\d+%\), (\d+)\/(\d+) successful\./gm)].at(-1);
  if (summary) {
    if (summary[2] !== summary[4]) return "unknown";
    return counts(Number(summary[1]), Number(summary[2]), Number(summary[3]));
  }
  // Vite Task uses a shorter report for the single-command Stelz build. Its
  // uncached command banner plus completed Vite output proves actual execution.
  if (/^vp run: cache hit, /m.test(text) && /^\$ vite build .*cache hit, replaying/m.test(text)) return "hit";
  const executed = /^\$ vite build\s*$/m.test(text) || /^\$ vite build .*cache miss: .+, executing$/m.test(text);
  if (executed && /^vite v[\d.]+ building /m.test(text) && /^✓ built in /m.test(text)) return "miss";
  return "unknown";
}
