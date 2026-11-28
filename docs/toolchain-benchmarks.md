# Toolchain benchmark experiment

This branch compares pinned dependencies against candidate tools in two disposable Git worktrees of the same commit. The checked-in manifest and lockfile remain the baseline. Candidate tool versions are installed with exact pins in the temporary candidate worktree. GitHub Actions runs on Linux and macOS. The workflow never publishes packages or changes the base branch.

## Results

Open the **Toolchain benchmarks** workflow run in Actions. Each matrix job has a Markdown summary and an artifact with raw trials, exit codes, logs, exact Bun revisions, candidate manifest and lockfile, build inventories, median, p95, and peak RSS. Failed candidate runs are invalid results, not speedups. Review diagnostics and artifact contracts before selecting a tool.

- Installs: Bun 1.4.4, 1.4.5, and the current canary. Same original lockfile. One cold sample and five fresh installs with warm package cache.
- Formatting: pinned, stable and canary Bun fmt versus Oxfmt 0.80. Same TS, TSX and CSS files. Restore original files before each write. Measure checks on each formatter's own normalized output.
- Lint: original pinned Oxlint, latest Oxlint 1.95 and native canary Bun lint. Use a shared correctness policy for direct comparison. Save JSON diagnostics and test an intentional error.
- Type checks: pinned checker, tsrs 7.1 beta, TypeScript 7.0.2, Bun check stable and canary. Preserve both Humagent configurations. Test an intentional error.
- Build: pinned Vite, Vite 8.4 with Node, stable Bun and canary Bun. Delete dist before every trial. Verify expected outputs and record inventories.
- Full checks: compare pinned, updated and candidate native quality gates. Keep the original task orchestration.
- Task caching: direct build, Turbo 2.11.13 and Vite Task 1.8.0. Compare cold, unchanged, restore missing outputs, and changes to documentation, tests and source. The comparison is one real build task, not a full Vite+ migration.
- Tests: existing Bun suites with the pinned runtime, stable, canary and different worker counts. Humagent also compares Playwright on Node and Bun, and measures actual Vite workspace readiness. Stelz runs the real local dev server smoke test, not the browser-download or public-site QA suites.
- Packaging: npm and pinned/stable/canary Bun pack on the same Humagent build. Stelz's existing archive acceptance on baseline and candidate.

The November 28 stable versions are pinned. The canary moves, so every run records its revision. The candidate lockfile is an artifact, not a committed change.

The small sample size for long tests and different hosted runner hardware limit statistical confidence. Compare variants within the same job. Peak RSS is not summed across worker processes. Cold installs include network variance. Formatting check inputs differ after normalization. Diagnostic parity and build inventory review are required before adoption. Do not infer a performance win from a nonzero exit or missing work.

No Vitest migration is included: both existing browser workloads test the actual application or process boundary rather than an equivalent component suite. Live HMR latency and full custom-browser smoke tests require a separate dedicated experiment.

## Second round

The first run passed the benchmark workflow but failed some candidates. This round fixes the missing Vite CSS types in Stelz, requires formatter convergence before timing checks, and normalizes the disposable candidate before each full check. Download the generated patches to review formatting changes. It does not exclude the problematic file. A non-convergent formatter remains invalid.

Bun stable is the native checker candidate, with Oxlint as the stable lint gate. The canary tests native lint as well. Humagent keeps tsrs for declaration generation; the native candidate no longer calls it for routine type checks. The original lockfiles remain unchanged. Diagnostic parity compares the current code and several intentionally broken fixtures using the shared rule policy, rather than assuming zero warnings means equivalence.

Cache measurements require reported hits or misses and compare restored output hashes. Stelz uses a separate Turbo cache directory and explicit build inputs. The command exit status comes directly from the child process; peak RSS comes from Bun's resource usage API. A missing memory reading does not invalidate a passing command.
