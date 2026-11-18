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
| `bun run test` | Run the main check, then browser tests. |
| `bun run check --force` | Run every main-check task without cached results. |

Turbo caches successful tasks and build outputs in `.turbo/`. Source, configuration, lockfile, and runtime changes invalidate results.
Browser tests never reuse cached results.

Formatting, lint, and build can run together. Test type checks and fast tests wait for the build.
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
| `tests` | Run the main check, then browser tests in the Playwright container. |
| `check` | Report the required merge status after successful tests or a documentation-only skip from `scope`. |

PRs limited to root Markdown files, `docs/`, or the pull request template skip tests. Those paths also skip automatic releases.
Unknown paths run all tasks. Manual runs, merge queues, and failed scope detection run the full suite without cached results.

Keep the Playwright image version aligned with `@playwright/test`.
External GitHub Actions use fixed commit hashes. Dependabot proposes grouped updates each week.
