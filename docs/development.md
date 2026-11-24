# Development

See [Contributing](../CONTRIBUTING.md) for local setup. This guide covers checks, architecture, plugins, pull requests, and release.

## Checks

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

Turbo caches successful tasks and build outputs in `.turbo/`. Source, configuration, lockfile, and runtime changes invalidate results. Markdown files and `docs/` do not invalidate results. Test files and `tsconfig.test.json` do not invalidate the build. Browser tests never reuse cached results.

Formatting, lint, and build can run together. Type checks, fast tests, and browser tests run together after the build. Local checks finish independent tasks after failures and show full logs. CI stops at the first test failure and cancels remaining tasks.

`tsconfig.json` emits the package. `tsconfig.test.json` checks tests against generated declarations, including browser globals, without emitting files.

## Architecture

The transport moves feedback reviews between the page, the workspace, the server, and the agent. It names no review kind. The server never imports a plugin. It checks the review envelope and the limits, and stores `data` as JSON. A plugin adds one kind of review. The built-in plugins are `comment`, `edit`, and `form`.

Each review has one envelope: `{ id, kind, comment?, data?, target? }`. A pending review adds `revision`, `key?`, and `local?`. `local` holds plugin data for the page and the bar. Agents do not receive it.

Rendering code builds Humagent's own DOM from a model and reports input through callbacks. It makes no requests. Logic holds state, rules, and transport calls. It builds no Humagent markup. In the hosts, `src/ui/bar.ts` and `src/sdk/overlay.ts` render. `src/ui/workspace.ts` and `src/sdk/targeting.ts` hold the logic.

## Add a plugin

A plugin is one module in `src/plugins/` that exports one object. Its `kind` is the review kind.

```ts
import type { Plugin } from '../shared/plugin.js';

export const flag: Plugin = {
  kind: 'flag',
  contract: { target: true, validate: () => undefined },
  page(host) { /* behavior in the page */ return {}; },
  card: { title: () => 'Flag' },
};
```

| Member | Purpose |
| --- | --- |
| `contract` | Data rules. The workspace applies them before it saves a review. `validate` checks the whole review and returns its `data`. `local` checks the local data of a pending review. |
| `page` | Behavior in the page. It saves pending reviews through the page host. It can register a tool with element targeting. Page authors mark its elements with `host.attribute`, which is `data-humagent-<kind>`. |
| `card` | Sets the title, optional body, and styles of a pending review in the bar. |

The page receives `discard` before the workspace removes a keyed review on the current revision. Forms use it to cancel pending saves and reset their controls.

1. Write the module. The interfaces are in `src/shared/plugin.ts`.
2. Add the plugin to `src/plugins/index.ts`. The order is the order in which targeting asks tools.
3. Extend a browser test in `test/browser/feedback.spec.ts` with the new workflow.

A plugin runs only in the browser. A large plugin can keep helper files in `src/plugins/<kind>/`. The registry refuses two plugins with one kind. The page host refuses two plugins with one `window.humagent` member. The transport, the server, and the CLI need no change.

Element targeting serves every plugin that acts on page elements. It owns pick mode, markers, the highlight, and the comment panel. A tool claims a pick with `hit`, opens an inline editor with `open`, and returns its review from `build`. Targeting asks the tool with the open editor first, then the other tools in registry order. The first review wins.

## Test coverage

Follow the test policy in [AGENTS](../AGENTS.md#checks). Cover each user workflow once through the browser or the CLI. Preserve coverage for permissions, revisions, receipts, persistence, and runtimes.

## CI

The [Check workflow](../.github/workflows/check.yml) has three jobs:

| Job | Purpose |
| --- | --- |
| `scope` | Detect documentation-only PRs before starting the test container. |
| `tests` | Run all checks through Turbo in the Playwright container. |
| `check` | Report the required merge status after successful tests or a documentation-only skip from `scope`. |

PRs limited to root Markdown files, `docs/`, or the pull request template skip tests. Those paths also skip automatic releases. Unknown paths run all tasks. Manual runs, merge queues, and failed scope detection run the full suite without cached results.

Keep the Playwright image version aligned with `@playwright/test`. External GitHub Actions use fixed commit hashes. Dependabot proposes grouped updates each week.

## Pull requests

- Keep commits focused and logical.
- State the user-visible effect.
- List the checks that you ran.
- Note any remaining limits.
- Require all Check workflow jobs to pass before merging.
- Do not commit archives, test output, `.local/`, or `.turbo/`.

## Release

Add a Changeset with `bun run changeset` for publishable API, behavior, type, or dependency changes. Tests, documentation, and internal tooling usually do not need one.

The [Release workflow](../.github/workflows/release.yml) creates a version PR when Changesets reach `main`. Merging that PR publishes the version automatically if its full checks pass.

`bun run release` uses standard Changesets publishing. Changesets skips versions already on npm. For unpublished versions, npm runs `prepublishOnly`, then builds and packs through `prepack`. `prepublishOnly` runs uncached checks, installs Chromium's headless shell, and runs browser tests. Run `npm publish --dry-run` to check that lifecycle without publishing.

Failed checks prevent publication. Version PR preparation does not install browsers or run publication hooks.

`CHANGELOG.md` lists released versions and their features. Changesets add later versions above them.

Automated publication needs npm trusted publishing for repository `souljorje/humagent` and workflow `release.yml`. Do not set a GitHub environment name. The workflow combines version PRs and publication.

### Build an archive

Run these commands from the repository root:

```sh
bun run check
bun pm pack --ignore-scripts --destination .local
npx --yes --package ./.local/humagent-VERSION.tgz humagent --version
```

Replace `VERSION` with the current package version. The archive includes compiled code, browser assets, examples, and all public guides. Use its absolute path when running npx from another directory. npm installation does not build or download application assets.

Check `npm view humagent version` before you change installation instructions. No automated test installs the archive. Use the commands above for that check.
