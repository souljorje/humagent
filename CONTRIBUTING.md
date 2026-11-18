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

Bun reuses its local package cache automatically. Playwright also reuses installed browsers.

Source files belong to one package:

- `src/cli/` contains commands and process startup.
- `src/runtime/` contains the server, sessions, persistence, and surface serving.
- `src/ui/` contains the browser interface.
- `src/sdk/` contains the injected bridge, forms, and element targeting.
- `src/shared/` contains common contracts, validation, and browser-safe helpers.
- `src/examples/` contains example pages and their TypeScript modules.

All executable source uses TypeScript. The build compiles application and example modules into `dist/`, then copies HTML and CSS.
Build, check, and release commands live in `package.json`. The main check also checks test types.

## Build an archive

Run these commands from the repository root:

```sh
bun run check
bun pm pack --ignore-scripts --destination .local
npx --yes --package ./.local/humagent-0.1.0.tgz humagent --version
```

The archive includes compiled code, browser assets, examples, and all public guides.
Use its absolute path when running npx from another directory. npm installation does not build or download application assets.

Check `npm view humagent version` before you change installation instructions.
No automated test installs the archive. Use the commands above for that check.

## Checks

Run `bun run test` for the full smoke suite.
See [Development](docs/development.md) for browser setup, individual checks, caching, and CI behavior.

## Pull requests

- Keep commits focused and logical.
- State the user-visible effect.
- List the checks that you ran.
- Note any remaining limits.
- Require all Check workflow jobs to pass before merging.
- Do not commit archives, test output, `.local/`, or `.turbo/`.

## Documentation

Follow [AGENTS.md](AGENTS.md) for engineering and documentation rules. Use clear sentences and consistent terms.

Keep user guides focused on installation, common use, and troubleshooting.
Put testing and CI notes in [Development](docs/development.md). Keep release steps in this guide.

## Changesets and release

Add a Changeset with `bun run changeset` for publishable API, behavior, type, or dependency changes.
Tests, documentation, and internal tooling usually do not need one.

The [Release workflow](.github/workflows/release.yml) creates a version PR when Changesets reach `main`.
Merging that PR publishes the version automatically if its full checks pass.

Store a fine-grained GitHub token in the `RELEASE_GITHUB_TOKEN` repository Actions secret.
Limit it to this repository with Contents and Pull requests read/write permissions.
Changesets uses this token so version-PR checks start automatically. Replace the secret when the token expires.

`bun run release` uses standard Changesets publishing. Changesets skips versions already on npm.
For unpublished versions, npm runs `prepublishOnly`, then builds and packs through `prepack`.
`prepublishOnly` runs uncached checks, installs Chromium's headless shell, and runs browser tests.
Run `npm publish --dry-run` to check that lifecycle without publishing.
Failed checks prevent publication. Version PR preparation does not install browsers or run publication hooks.

Version `0.1.0` is on npm. Its notes in `CHANGELOG.md` list the initial features. Changesets add later versions above them.

Automated publication needs npm trusted publishing for repository `souljorje/humagent` and workflow `release.yml`.
Do not set a GitHub environment name. The workflow combines version PRs and publication.
