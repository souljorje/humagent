import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cacheResult, turboTaskCacheResult } from "./cache-result";

test("Vite Task distinguishes zero, full, and partial hits", () => {
  expect(cacheResult("vite-task", "vp run: 0/2 cache hit (0%), 2/2 successful. (Run `vp run --last-details` for full details)")).toBe("miss");
  expect(cacheResult("vite-task", "vp run: 2/2 cache hit (100%), 2/2 successful.")).toBe("hit");
  expect(cacheResult("vite-task", "vp run: 1/2 cache hit (50%), 2/2 successful.")).toBe("partial");
  expect(cacheResult("vite-task", "vp run: 0/2 cache hit (0%), 1/2 successful.")).toBe("unknown");
  expect(cacheResult("vite-task", "vp run: 0/0 cache hit (0%), 0/0 successful.")).toBe("unknown");
});

test("Vite Task requires positive evidence for a single-command result", () => {
  expect(cacheResult("vite-task", "$ vite build ◉ cache hit, replaying\n✓ built in 137ms\nvp run: cache hit, 332ms saved.")).toBe("hit");
  expect(cacheResult("vite-task", "$ vite build\nvite v8.4.0 building client environment for production...\n✓ built in 137ms")).toBe("miss");
  expect(cacheResult("vite-task", "$ vite build ○ cache miss: 'ui/src/main.tsx' modified, executing\nvite v8.4.0 building client environment for production...\n✓ built in 137ms")).toBe("miss");
  expect(cacheResult("vite-task", "$ vite build\nvite v8.4.0 building client environment for production...")).toBe("unknown");
  expect(cacheResult("vite-task", "No cache hit was reported.")).toBe("unknown");
});

test("Turbo uses numeric totals and successful tasks, including colored output", () => {
  expect(cacheResult("turbo", " Tasks:    1 successful, 1 total\nCached:    0 cached, 1 total")).toBe("miss");
  expect(cacheResult("turbo", "\u001b[32m Tasks:    1 successful, 1 total\nCached:    1 cached, 1 total\u001b[0m")).toBe("hit");
  expect(cacheResult("turbo", " Tasks:    2 successful, 2 total\nCached:    1 cached, 2 total")).toBe("partial");
  expect(cacheResult("turbo", " Tasks:    1 successful, 2 total\nCached:    1 cached, 2 total")).toBe("unknown");
  expect(cacheResult("turbo", "cache hit, replaying logs")).toBe("unknown");
});

function fixture(name: string) {
  return readFileSync(new URL("fixtures/" + name, import.meta.url), "utf8");
}

test("recorded Vite Task reports include saved-time suffixes and partial source invalidation", () => {
  expect(cacheResult("vite-task", fixture("vite-task-cold.log"))).toBe("miss");
  expect(cacheResult("vite-task", fixture("vite-task-warm.log"))).toBe("hit");
  expect(cacheResult("vite-task", fixture("vite-task-source-edit.log"))).toBe("partial");
});

test("recorded Turbo task evidence catches the documentation/build cache regression", () => {
  const warm = fixture("turbo-unchanged.log");
  const changed = fixture("turbo-docs-edit-regression.log");
  for (const task of ["format:check", "lint", "build", "typecheck", "test:fast"])
    expect(turboTaskCacheResult(warm, task)).toBe("hit");
  expect(turboTaskCacheResult(warm, "clean:build")).toBe("miss");
  expect(turboTaskCacheResult(changed, "format:check")).toBe("hit");
  expect(turboTaskCacheResult(changed, "build")).toBe("miss");
  expect(turboTaskCacheResult(changed, "typecheck")).toBe("miss");
  expect(turboTaskCacheResult(changed, "test:fast")).toBe("miss");
  expect(turboTaskCacheResult(changed, "missing-task")).toBe("unknown");
});
