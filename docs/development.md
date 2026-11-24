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

## Architecture

The transport moves feedback reviews between the page, the workspace, the server, and the agent. It names no review kind.
The server never imports a plugin. It checks the review envelope and the limits, and stores `data` as JSON.
A plugin adds one kind of review. The built-in plugins are `comment`, `edit`, and `form`.

Each review has one envelope: `{ id, kind, comment?, data?, target? }`. A pending review adds `revision`, `key?`, and `local?`.
`local` holds plugin data for the page and the bar. Agents do not receive it.

Rendering code builds Humagent's own DOM from a model and reports input through callbacks. It makes no requests.
Logic holds state, rules, and transport calls. It builds no Humagent markup.
In the hosts, `src/ui/bar.ts` and `src/sdk/overlay.ts` render. `src/ui/workspace.ts` and `src/sdk/targeting.ts` hold the logic.

## Add a plugin

A plugin is one module in `src/plugins/` that exports one object. Its `kind` is the review kind.

The [comment plugin](../src/plugins/comment.ts) is a complete example of a targeting tool.
The [form plugin](../src/plugins/form.ts) shows how a page method saves a review.

| Member | Purpose |
| --- | --- |
| `contract` | The workspace checks each review before saving it. `validate` checks the whole review and returns its `data`. `local` checks the plugin's private data. |
| `page` | The page host supplies the plugin's kind when it saves a review. A plugin can return a `tool` for element targeting. Its pending reviews belong to the current page revision. |
| `workspace` | The pending review in the bar: `discardOnPage`, and the `card` that draws it. |

1. Export an object of type `Plugin` from the module. The interfaces are in `src/shared/plugin.ts`.
2. Add the plugin to `src/plugins/index.ts`. The order is the order in which targeting asks tools.
3. Extend a browser test in `test/browser/feedback.spec.ts` with the new workflow.

A plugin runs only in the browser. A large plugin can keep helper files in `src/plugins/<kind>/`.
The registry refuses two plugins with one kind. The page host refuses two plugins with one `window.humagent` member.
For public page methods, extend `PageMethods` from `src/shared/plugin.ts` in the plugin module. Return the methods in `page().api`.
The transport, the server, and the CLI need no change.

Element targeting serves every plugin that acts on page elements. It owns pick mode, markers, the highlight, and the comment panel.
The workspace validates `local.marker` for targeted reviews. A plugin can validate additional local fields and return them as an object.
A tool can claim a pick by returning its element and an `open` method from `hit`.
Targeting records the target before it opens the editor. It adds the target and kind to the fields returned by `build`.
The open editor builds first. If it supplies no review, targeting asks the tools in registry order. The first review wins.

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
