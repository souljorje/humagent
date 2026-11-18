# CI

## Current strategy

The smoke suite has 10 fast tests and six browser tests. The required status remains `check`, with strict branch protection.
Documentation-only PRs skip the browser container through `dorny/paths-filter`. Unknown paths run all tasks.
Manual runs, merge-queue runs, and failed scope detection bypass cached results. Browser tests always execute.

Turbo uses its standard `.turbo/` directory. All repository inputs participate in task hashes.
`precheck` records the actual Node version. Bun's package-manager identity supplies its version, platform, and architecture.
The build must finish before type checks and fast tests because they import generated modules.

Check and Release share one setup action for Node, Bun, frozen installation, and the task cache.
Cache keys include OS, architecture, runtime versions, lockfile, Turbo configuration, and commit.
The restore prefix omits the commit so new commits can reuse matching tasks. Identical reruns avoid duplicate uploads.
GitHub branch scopes isolate PR caches. Release runs can populate the default-branch cache for later PRs.

## What transfers from d3-maps

The [reference setup](https://github.com/souljorje/d3-maps/tree/19339fd82c0a665d5e9c86b35196ddeba4660308/.github) uses Turbo, shared setup, a job matrix, and affected-package selection.

| Strategy | Decision |
| --- | --- |
| Shared setup, standard Turbo cache, merge-queue trigger | Adopted. |
| Short tool commands and standard Changesets publishing | Adopted. |
| Four-job matrix | Deferred. This small suite would repeat setup across four runners. |
| `--affected` package selection | Deferred. There is one package, and browser tests load generated files and HTTP assets. |
| Dependency cache | Deferred. Installation took 0–1 seconds in measured CI runs. |

`release` delegates to Changesets. During automated releases, only unpublished versions invoke npm's `prepublishOnly` hook.
That hook runs fresh checks, installs Chromium's headless shell, and runs browser tests. Failure stops publication.
Then `prepack` builds the package. This replaces the earlier custom archive-publishing flow.
No install hook builds or downloads application assets.

## Measured baseline

These historical samples precede the final command simplification. They are observations, not forecasts.

| Sample | Feedback seconds | Runner-seconds |
| --- | ---: | ---: |
| [Baseline 1](https://github.com/souljorje/humagent/actions/runs/44267988630), `75bffda` | 352 | 348 |
| [Baseline 2](https://github.com/souljorje/humagent/actions/runs/44269163736), `75bffda` | 435 | 430 |
| [Prepared image](https://github.com/souljorje/humagent/actions/runs/44271523047), `353a32b` | 77 | 69 |
| [Task cache, cold/warm attempts](https://github.com/souljorje/humagent/actions/runs/44279115474), `de32c1a` | 87 / 74 | 79 / 64 |

The cached check step fell from 8 seconds to 1 second. Both attempts ran all six browser tests fresh.
Local checks took 4.477 seconds cold and 0.377 seconds warm. The compressed hosted task cache was 62,929 bytes.
Slow Ubuntu downloads inflated the baseline. Earlier healthy runs used 47–73 runner-seconds.
The prepared image transfers 966 MiB, versus 327 MiB of baseline browser archives. Its version must match Playwright.

Feedback includes queue time. Rerun feedback starts at each attempt's `run_started_at`.
Runner time sums job durations, not CPU utilization. Public standard-runner charges and reported billable time were zero.
Setup variation and small samples prevent reliable long-term cost or latency estimates.

The [full historical audit](https://github.com/souljorje/humagent/blob/d1ed3b3/.github/CI.md) contains experiment failures, selection probes, release checks, and measurement commands.
The [OpenClaw article](https://vincent.build/openclaw-ci-cost-reduction/) motivated the audit.
Its [implementation](https://github.com/openclaw/openclaw/blob/a7d05c7af04aa17ac57c994da238d0c60f058ca6/.github/workflows/ci.yml) serves a different workload. Its selection rules and savings do not transfer unchanged.

## Verification and rollback

Run `bun run check --force` and `bun run test:browser:built` for fresh validation.
Use `npm publish --dry-run` to exercise publication hooks without publishing.
Revert optimization commits in reverse order. Keep the required `check` status when changing job layout.
Live publication and merge-queue execution need separate verification. This audit does not publish or merge.
