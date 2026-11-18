# Development

See [Contributing](../CONTRIBUTING.md) for setup, package archives, and releases.

## Local checks

Install Chromium before the first browser test:

```sh
bunx --no-install playwright install chromium
```

| Command | Purpose |
| --- | --- |
| `bun run format` | Format source and tests with Bun. Options live in `bunfig.toml`. |
| `bun run check` | Run formatting checks, lint, build, type checks, and fast tests. |
| `bun run test:browser:built` | Run browser tests against an existing build. |
| `bun run test` | Run all checks, including browser tests, through Turbo. |
| `bun run check --force` | Run every main-check task without cached results. |

Turbo caches successful tasks and build outputs in `.turbo/`. Source, configuration, lockfile, and runtime changes invalidate results.
Markdown files and `docs/` do not invalidate results.
Test files and `tsconfig.test.json` do not invalidate the build.
Browser tests never reuse cached results.

Formatting, lint, and build can run together. Type checks, fast tests, and browser tests run together after the build.
Local checks finish independent tasks after failures and show full logs. CI stops at the first test failure and cancels remaining tasks.
`tsconfig.json` emits the package. `tsconfig.test.json` checks tests against generated declarations, including browser globals, without emitting files.

## Test coverage

Keep tests as a smoke suite. Cover each user workflow once through the browser or CLI.
Extend existing tests before adding tests. Avoid unit tests for behavior that workflow tests cover.
Preserve coverage for permissions, revisions, receipts, persistence, and runtimes.

## CI

The [Check workflow](../.github/workflows/check.yml) has three jobs:

| Job | Purpose |
| --- | --- |
| `scope` | Detect documentation-only PRs before starting the test container. |
| `tests` | Run all checks through Turbo in the Playwright container. |
| `check` | Report the required merge status after successful tests or a documentation-only skip from `scope`. |

PRs limited to root Markdown files, `docs/`, or the pull request template skip tests. Those paths also skip automatic releases.
Unknown paths run all tasks. Manual runs, merge queues, and failed scope detection run the full suite without cached results.

Keep the Playwright image version aligned with `@playwright/test`.
External GitHub Actions use fixed commit hashes. Dependabot proposes grouped updates each week.
