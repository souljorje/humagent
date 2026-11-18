# CI audit: 18 November 2026

## Scope and decisions

The baseline is `75bffda`. The suite has 10 fast tests and six browser tests.
The baseline uses one `ubuntu-24.04` job for formatting, lint, compilation, types, runtime checks, and browser checks.
The required status remains `check`, with strict branch protection enabled.
The application, test inventory, runtime versions, lockfile, and runner size do not change.

| Priority | Decision | Evidence |
| --- | --- | --- |
| 1 | Use the version-matched browser image after checking the PR scope. | Repeated Ubuntu package downloads dominate the current baseline. |
| 2 | Defer release browser setup until an unpublished archive passes the main check. | Version-PR preparation installed browsers without running them. |
| 3 | Run the full suite when the PR diff is unavailable. | Missing history cannot prove that a change affects only documentation. |
| Defer | Test selection, sharding, alternate runners, compiler replacement, and caches. | The full smoke suite is small. Dependency installation took 0–1 seconds. |

Only the existing documentation exemption skips tests. Unknown paths and mixed changes run everything.
Browser tests consume generated files and load assets through HTTP. A source import graph alone would miss those dependencies.
Keep the full suite until a broader selection rule has evidence from this repository.
Keep existing cancellation, frozen installation, failure artifacts, release gates, and version-PR checks.

The `scope` job uses no browser image. Documentation-only changes skip `tests`, and the required `check` verifies that decision.
For other changes, `tests` uses the prepared image and runs the full suite.
The required `check` runs after both jobs. Failed, cancelled, or unexpectedly skipped tests cannot produce a passing check.
Manual runs skip scope detection and run all tests.

The image requires `unzip` for Bun setup. Its tag must match the pinned Playwright version.
It downloads 965.8 MiB of compressed layers, more than the baseline's 327.2 MiB of browser archives.
This trades additional transfer and small orchestration jobs for less repeated environment preparation.

## Baseline

The two recent successful smoke-suite jobs took 47 and 73 runner-seconds.
Browser setup took 19 and 36 seconds. Browser tests took 11 and 10 seconds.
These runs use different revisions. They provide context, not a controlled comparison.

- [Smoke-suite PR](https://github.com/souljorje/humagent/actions/runs/44061707890)
- [Version-PR check](https://github.com/souljorje/humagent/actions/runs/44062150264)
- [Version-PR preparation](https://github.com/souljorje/humagent/actions/runs/44062050608): 38 runner-seconds, including 21 seconds of unused browser setup.

The local baseline took 5.286 seconds for `bun run check` and 8.289 seconds for browser tests.
These macOS measurements used installed dependencies and browsers. Do not compare them directly with fresh Linux jobs.

## Hosted comparisons

| Run | Revision | Feedback seconds | Runner-seconds | Browser setup seconds | Result |
| --- | --- | ---: | ---: | ---: | --- |
| [Baseline 1](https://github.com/souljorje/humagent/actions/runs/44267988630) | `75bffda` | 352 | 348 | 313 | 16 tests passed |
| [Baseline 2](https://github.com/souljorje/humagent/actions/runs/44269163736) | `75bffda` | 435 | 430 | 393 | 16 tests passed |
| [Headless-only 1](https://github.com/souljorje/humagent/actions/runs/44268509911) | `aceeab9` | 290 | 286 | 247 | 16 tests passed |
| [Headless-only 2](https://github.com/souljorje/humagent/actions/runs/44269362985) | `2241d42` | 327 | 324 | 287 | 16 tests passed |
| [Container prerequisite failure](https://github.com/souljorje/humagent/actions/runs/44269995733) | `e905476` | 42 | 36 | 27 | Bun setup lacked `unzip` |
| [Container prototype](https://github.com/souljorje/humagent/actions/runs/44270291281) | `0f0d860` | 72 | 67 | 22 | 16 tests passed |
| [Final PR layout](https://github.com/souljorje/humagent/actions/runs/44271523047) | `353a32b` | 77 | 69 | 21 | 16 tests passed |
| [Final manual layout](https://github.com/souljorje/humagent/actions/runs/44271629791) | `353a32b` | 74 | 67 | 26 | 16 tests passed |
| [Documentation fixture](https://github.com/souljorje/humagent/actions/runs/44271809163) | `3fa19a3` | 14 | 8 | 0 | Tests skipped, required check passed |

Container setup times in this table cover image initialization. Whole-job totals also include installing `unzip` and other setup.
The prototype has no separate scope or result jobs. Final-layout totals include those jobs when they run.
The documentation fixture uses the unchanged file rules against the existing README-only revision `f2ddc49` on an isolated experiment branch.
The workflow skipped `tests` and did not pull a browser image.
The two current baselines average 393.5 feedback seconds and 389 runner-seconds.
The final PR and manual runs average 75.5 feedback seconds and 68 runner-seconds: observed reductions of 80.8% and 82.5%.
This is a small comparison during slow Ubuntu downloads, not a fleetwide saving or a forecast.
Earlier healthy baseline runs took 47–73 runner-seconds. The container may not improve those conditions.
The nine recorded audit runs consumed 1,635 runner-seconds, including the failed container attempt.
This excludes historical runs and later checks of documentation-only commits.
The headless-only change removed 199.3 MiB of browser downloads, but Ubuntu package transfer dominated its timings.
Do not attribute its whole-job difference to the smaller browser download.
The release change removes a measured 21-second step from the historical version-PR run. Its future whole-job saving remains unmeasured.

## Verification

Every implementation step passed `bun run check`.
The hosted candidate runs the same 10 fast tests and six browser tests as the baseline.
Thirteen temporary file-rule checks covered documentation, mixed changes, unknown paths, configuration, deletions, renames, missing history, and multi-commit PRs.
Missing history, unknown paths, and code moved into documentation selected the full suite.
Twelve result-gate cases covered passing tests, documentation skips, missing results, failures, cancellations, and manual runs.

An isolated unpublished-version release dry run passed all 16 tests with `CI=true`.
Deliberate type errors and browser failures each stopped that dry run.
An already-published version skipped browser setup and tests.
This audit did not publish a package. The live release workflow has not run with these changes.

## Measurement method

Use the workflow run and job endpoints for each immutable revision:

```sh
gh api repos/souljorje/humagent/actions/runs/RUN_ID
gh api 'repos/souljorje/humagent/actions/runs/RUN_ID/jobs?per_page=100'
gh api repos/souljorje/humagent/actions/runs/RUN_ID/timing
gh run view RUN_ID --log
```

Feedback time is workflow creation to the final job completion, including queue time.
Compute usage is the sum of job completion minus job start times. It does not measure CPU utilization.
Step timings and download sizes come from job timestamps and logs.
All comparison runs use fresh runners without added caches. No test or application files change between comparisons.
The sample is too small for a useful p90 estimate or a delivery-time claim.

This public repository uses standard hosted runners, so runner charges are zero before and after.
The timing API also reports zero billable milliseconds. Runner-seconds remain useful for measuring resource use.
See [GitHub billing](https://docs.github.com/en/actions/concepts/billing-and-usage).

## Source assessment

The [article](https://vincent.build/openclaw-ci-cost-reduction/) reports organization-wide changes with changing workloads, not a reusable saving percentage.
Its [pinned implementation](https://github.com/openclaw/openclaw/blob/a7d05c7af04aa17ac57c994da238d0c60f058ca6/.github/workflows/ci.yml) separates planning, cache trust, execution, and required result aggregation.
Its [test planner](https://github.com/openclaw/openclaw/blob/a7d05c7af04aa17ac57c994da238d0c60f058ca6/scripts/lib/ci-changed-node-test-plan.mts#L436) retains smoke checks and rejects unresolved owner plans.
The learned selector remains observational. Those ownership rules and measurements do not transfer to this repository.
Here, removing unused setup has stronger evidence than building a selector or adding jobs.

Playwright documents [prepared images](https://playwright.dev/docs/docker), [headless-only installation](https://playwright.dev/docs/browsers#chromium-headless-shell), and [browser-cache limitations](https://playwright.dev/docs/ci#caching-browsers).
PR containers include browser dependencies. Release checks install dependencies when needed.
No cached build or previous green result replaces current checks.

## Rollback

Revert the prepared-image commit to restore the single-job, headless-only setup.
Revert the earlier browser-download commit to restore the original PR setup and diff handling.
Revert the release-setup commit to restore unconditional browser preparation.
Manual Check runs always provide the full suite. Required-check settings need no changes.
