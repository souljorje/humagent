# Contributing

Open an issue for a bug report or a large change. Documentation fixes can go straight to a pull request.

Do not report vulnerabilities in public issues. Read [Security and limits](docs/SECURITY.md).

## Setup

Install Node.js 24 or later. Use Bun 1.4.4 for development.

```sh
git clone https://github.com/souljorje/humagent.git
cd humagent
bun install --frozen-lockfile
bun run build
bun dist/cli/index.js demo
```

Source files belong to one package:

- `src/cli/` contains commands and process startup.
- `src/runtime/` contains the server, sessions, persistence, and surface serving.
- `src/ui/` contains the browser interface.
- `src/sdk/` contains the injected bridge, forms, and element targeting.
- `src/shared/` contains common contracts, validation, and browser-safe helpers.
- `src/examples/` contains example pages and their TypeScript modules.

All executable source uses TypeScript. The build compiles application and example modules into `dist/`, then copies HTML and CSS.
Scripts and tests remain in `scripts/` and `test/`. The main check also checks their types.

## Build an archive

Run these commands from the repository root:

```sh
bun run check
bun pm pack --ignore-scripts --destination .local
npx --yes --package ./.local/humagent-0.1.0.tgz humagent --version
```

The archive includes compiled code, browser assets, examples, the agent skill, and all public guides.
Use its absolute path when running npx from another directory. npm installation does not build or download application assets.

Version 0.1.0 is not published to npm. The README uses the local archive until a release exists.
Check `npm view humagent version` and the release archive before changing installation instructions.

## Checks

Run the main check after each implementation increment:

```sh
bun run check
```

The main check runs formatting, lint, build, type checks, and unit tests.
Fix failures before continuing.

After UI, SDK, or browser interaction changes, run browser tests against the checked build:

```sh
bunx --no-install playwright install chromium
bun run test:browser:built
```

Set `HUMAGENT_BROWSER_PATH` to use an installed Chromium binary. Test output stays in `.local/`.

Run release checks before review of runtime, build, dependency, or package changes, and before a release:

```sh
bun run check:release
```

The release check builds, tests, packs, and verifies the package. It also checks an npm install without Bun.

CI tests installation on Linux, macOS, and Windows.
Use `HUMAGENT_TEST_ARCHIVE` to test a specific archive with `bun run test:install` after packing it.
Check relative documentation links and the README notices in that archive.

Before changing stored-session formats, follow the [compatibility procedure](docs/CLI.md#stored-session-compatibility).
Never replace unreadable feedback with an empty session.

## Pull requests

- Keep commits focused and logical.
- State the user-visible effect.
- List the checks that you ran.
- Note any remaining limits.
- Require all Check workflow jobs to pass before merging.
- Do not commit archives, test output, or `.local/`.

## Documentation

Follow [AGENTS.md](AGENTS.md) for engineering and documentation rules. Use clear sentences and consistent terms.

Keep user guides focused on installation, common use, and troubleshooting. Put maintainer and release steps in this guide.

## Release

Run the GitHub **Release** workflow from `main` with the version in `package.json`.
Set `publish: true` to publish the verified archive to npm and create a GitHub release.
Use `publish: false` to run verification only.

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for `release.yml` and the `npm` environment.
Enable `npm publish` in the trusted publisher settings.
