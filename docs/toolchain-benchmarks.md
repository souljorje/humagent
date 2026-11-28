# Toolchain benchmarks

The adopted stack uses one pinned Bun canary for development, CI, and the application runtime. Native Bun commands format, lint, check types, and run tests. Vite builds browser assets. Humagent keeps tsrs for declarations. Turbo runs and caches tasks. Lefthook runs Git hooks. Playwright checks browser workflows.

`packageManager` selects the exact Bun npm package. `toolchain.json` records its full revision. The setup step verifies both before benchmarks run.

## Reproducible comparisons

The historical source and lockfile are fixed at `89a457c7f3e214ac713253c2d6d940a96bca6cc6`. Both the baseline and alternative tools use this source in disposable Git worktrees. The adopted stack uses the tested PR commit in another worktree. This keeps migration changes from silently changing the historical baseline.

| Workload | Comparison |
| --- | --- |
| Installs | Bun 1.4.4, stable 1.4.5, and the adopted canary with the historical lockfile |
| Formatting | Native Bun and Oxfmt 0.80 on the same source files |
| Lint | Historical Oxlint, Oxlint 1.95, and native Bun with a shared rule policy |
| Type checks | Historical checker, tsrs, TypeScript 7.0.2, and native Bun |
| Builds | Historical Vite and Vite 8.4 on Node, stable Bun, and canary Bun |
| Full checks | Historical orchestration with updated tools and native Bun gates |
| Build caching | Turbo 2.11.13 and Vite Task 1.8.0 with identical build commands |
| Adopted checks | Frozen install, cold checks, warm checks, restored outputs, and documentation, test, and source edits |
| Tests | Existing suites on each runtime and selected worker counts |
| Packaging | Humagent npm/Bun archives and Stelz archive acceptance |

All runtime versions are fixed. The workflow records their actual revisions. Stable Bun and Node remain comparison tools. They do not replace the adopted application runtime.

The workflow runs on Linux and macOS. It starts for relevant PR changes or a manual dispatch. It does not publish packages.

## Evidence

Open the **Toolchain benchmarks** workflow in Actions. Each job provides a Markdown summary and an artifact. Artifacts contain trials, logs, exit codes, manifests, lockfiles, formatter patches, build inventories, median, p95, and peak RSS.

A failed command has no speed result. Baseline failures, adopted check failures, and the native canary quality gate fail the job. Other alternatives remain visible as invalid results.

Lint comparisons include intentional errors and diagnostic parity. Type checkers must reject an intentional assignment error. Formatting checks require convergence on each formatter's normalized output.

Cache checks parse numeric hit counts and successful task totals. Zero hits cannot count as a hit. Saved-time suffixes do not change the result. Source edits can leave independent build commands cached. A miss needs positive execution evidence. Focused regression tests cover zero, complete, partial, failed, and missing reports. Restored build outputs must match the recorded SHA-256 inventory.

The adopted warm checks include tasks that the project deliberately leaves uncached. Partial cache hits are valid for that workload. Warm and restored build outputs require complete hits in the separate build-cache comparison. Adopted checks require a build cache hit after documentation and test edits. Humagent also requires its other cacheable checks to remain cached after documentation edits.

## Limits

The [previous completed run](https://github.com/souljorje/humagent/actions/runs/46124889470) used the earlier canary revision. The cache parser treated `0/2 cache hit` as a hit. This made the Humagent Vite Task cold result invalid. The parser now reads the numeric counts. Use the new run before comparing cache results.

Long workloads use few trials. Hosted runner load and network downloads add variance. Compare alternatives within the same job. Peak RSS covers the direct child process. It does not sum concurrent workers.

The browser checks use existing workflows. Humagent also measures Vite workspace readiness. Stelz measures its local development server. Live HMR latency and the full custom-browser suite are outside this comparison.
