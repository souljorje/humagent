# Development

See [Contributing](../CONTRIBUTING.md) for local setup. This guide covers local development, checks, architecture, plugins, pull requests, and release.

## Local development

```sh
bun run dev
```

Open the printed workspace URL. It shows the page in `src/examples/`.

| Change | Result |
| --- | --- |
| CSS | Updates in place. Open editors stay open. |
| Browser code or HTML | Reloads the page. Saved reviews remain. |
| A module that the server imports | Restarts Vite and the server, then reloads. |

One process runs three kinds of servers:

| Server | Purpose |
| --- | --- |
| Vite, port 5173 | Browser code and the example. It proxies `/api` to the control server. |
| Control server, port 4170 | Sessions and agent commands |
| Page server, one per session | The reviewed page on its own origin |

The package has the last two servers only. There the control server also serves the workspace build.

The data directory is `.local/dev`. To use another source, run this command while Vite runs:

```sh
bun src/cli/index.ts SOURCE --home .local/dev --network --no-wait
```

`--network` lets an HTML file page load code from Vite.

## Checks

Install Chromium before the first browser test:

```sh
bunx --no-install playwright install chromium
```

| Command | Purpose |
| --- | --- |
| `bun run format` | Format source, tests, and configuration with Bun. Options live in `bunfig.toml`. |
| `bun run lint` | Run Bun's native linter. |
| `bun run typecheck` | Run Bun's native type checker. Build declarations first. |
| `bun run check:toolchain` | Verify the pinned Bun revision and record the runtime cache inputs. |
| `bun run check` | Run formatting checks, lint, build, type checks, and fast tests. |
| `bun run test:browser:built` | Run browser tests against an existing build. |
| `bun run test` | Run all checks, including browser tests, through Turbo. |
| `bun run check --force` | Run every main-check task without cached results. |

Turbo caches successful tasks and build outputs in `.turbo/`. Source, configuration, lockfile, and runtime changes invalidate results. Markdown files and `docs/` do not invalidate results. Test files and `tsconfig.test.json` do not invalidate the build. Browser tests never reuse cached results.

The runtime fingerprint includes Bun's full revision, the external Node version, the operating system, and the architecture.

Formatting, lint, and build can run together. Type checks, fast tests, and browser tests run together after the build. Local checks finish independent tasks after failures and show full logs. CI stops at the first test failure and cancels remaining tasks.

`bun run build` runs Vite under Bun. It writes `dist/client`, `dist/node`, and `dist/examples`, and empties them first. The Vite declaration plugin uses `tsrs` only to emit the public declarations. Bun checks source, tests, Vite configuration, and scripts through their TypeScript configurations.

### Git hooks

Run `bun run hooks:install` once per clone. Lefthook checks staged formatting and lint without changing the index. Bun reads staged content, including partially staged files. The pre-push hook runs `bun run check`. CI runs the full checks and browser acceptance. Published packages do not install hooks.

## Architecture

The transport moves feedback reviews between the page, the workspace, the server, and the agent. It names no review kind. The server never imports a plugin. It checks the review envelope and the limits, and stores `data` as JSON. A plugin adds one kind of review. The built-in plugins are `comment`, `edit`, and `form`.

Each review has one envelope: `{ id, kind, comment?, data?, target? }`. A pending review adds `revision`, `key?`, `marker?`, and `local?`. The SDK owns the marker position. Plugins use `local` for private data. The agent receives only the review envelope.

Rendering code builds Humagent's own DOM from a model and reports input through callbacks. It makes no requests. Logic holds state, rules, and transport calls. It builds no Humagent markup. In the hosts, `src/ui/bar/` and `src/sdk/overlay.ts` render. `src/ui/workspace/` manages workspace state. `src/sdk/annotating/` manages annotation input and the editor. `src/sdk/host.ts` runs the plugins of a page. `src/sdk/bridge.ts` exchanges messages with the workspace. `src/sdk/targets.ts` describes and resolves targets.

The functions of annotating share one state object, `Annotator` in `state.ts`. Each part changes its own field only. `capture.ts` changes the open editor. `placement.ts` changes the pointed element and the overlay positions. `pointer.ts` changes the marker press. `cursor.ts` changes the keyboard cursor. The workspace and the server do the same with `Workspace` and `Runtime`.

`src/shared/api.ts` holds the control-route types that the server, the workspace, and the commands share. `src/server/client.ts` is the client of the commands. `src/ui/session.ts` is the client of the workspace.

Browser code has the path prefix `/__humagent/` on the workspace and page origins. The rules are in `src/server/assets.ts`. Development loads it from Vite instead.

## Styles

Import a style sheet where you need it: `import './index.css'`. Vite loads it and updates it in place. Styles for more than one place are in `src/shared/styles/`.

| Place | Sheet |
| --- | --- |
| Workspace | `src/ui/app.css` |
| Overlay | `src/sdk/overlay.css` |
| Reviewed page, while annotating | `src/sdk/annotating/selection.css` |
| A plugin, in the workspace and the reviewed page | `index.css` of the plugin |
| Example | `src/examples/index.css` |

The overlay is a shadow root, so page styles cannot reach its content. Its sheet is the only one that code adopts. Its `:host` rules are important, because the page can match the host. A plugin's elements in the reviewed page share the page's styles. Use important rules for them.

Select elements in one way:

- Select a look by class only. An ID is for code, labels, and tests.
- Select a state by `hidden`, `disabled`, or an ARIA attribute. Use a `data-` attribute when none fits.
- Select by tag only for base rules of a document and for children without a class of their own.
- Start each class of a plugin with `ha-<kind>-`. Its sheet also loads in the reviewed page.
- Start each other name in the reviewed page with `data-humagent-`.
- Set only runtime positions and sizes in TypeScript.

Import from another directory with `@`, which is `src/`: `import { ensure } from '@/shared/validate'`. Import from the same directory with `./`. Omit file extensions, except `.css`.

## Add a plugin

A plugin is one module in `src/plugins/` that exports one object. Use `<kind>.ts` for one file. Use `<kind>/index.ts` for more files. Its `kind` is the review kind.

```ts
import type { Plugin } from '@/shared/plugin';
import { ensure } from '@/shared/validate';

export const flag: Plugin = {
  kind: 'flag',
  contract: {
    validateReview(review) {
      ensure(review.target, 'A flag requires a target');
      return undefined;
    },
  },
  page(host) { /* behavior in the page */ return {}; },
  summary: { title: () => 'Flag' },
};
```

| Member | Purpose |
| --- | --- |
| `contract` | `validateReview` checks the review, including any target rule, and returns the data for the agent. Optional `validateLocal` checks private data such as form labels. |
| `page` | Behavior in the page. It saves pending reviews through the page host. It can supply a tool for annotating. Page authors mark its elements with `host.attribute`, which is `data-humagent-<kind>`. |
| `summary` | Sets the title and optional body of the review summary. The bar displays it. |

The interfaces between annotating and a tool are in `src/sdk/annotating/types.ts`.

A plugin reports input that it has not saved through `host.unsaved`. Send waits while a plugin is saving. Unsaved input blocks the automatic reload.

The page receives `discard` before the workspace removes a keyed review on the current revision. Forms use it to cancel pending saves and reset their controls.

1. Write the module. The interfaces are in `src/shared/plugin.ts`.
2. Add the plugin to `src/plugins/index.ts`. The SDK asks tools in registry order.
3. Extend a browser test in `test/browser/feedback.spec.ts` with the new workflow.

A plugin runs only in the browser. To style it, import `./index.css` in `index.ts`. The registry refuses two plugins with one kind. The page host refuses two plugins with one `window.humagent` member. The transport, the server, and the CLI need no change.

The SDK manages annotating, markers, the highlight, and the comment panel for all plugins. A tool claims a pick with `hit`, opens an inline editor with `open`, and returns its review from `build`. The SDK asks the tool with the open editor first, then the other tools in registry order. The first review wins. A saved review asks only the tool of its kind.

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
