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

```sh
bun run check
```

This is the agent and PR check: build, formatting, lint, types, and unit tests.

For browser work, install Chromium once and run Playwright locally:

```sh
bunx --no-install playwright install chromium
bun run test:browser:built
```

Release verification adds all browser tests, packaging, installation with Node.js, and Bun runner checks. Run `bun run check:release` locally before a release.


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

## Changesets and release

Add a Changeset for publishable behavior, API, type, or dependency changes:

```sh
bun run changeset
```

Commit it with the change. Tests, internal refactors, and CI-only changes usually need no Changeset.

When a Changeset reaches `main`, the **Release** workflow opens or updates a version pull request.
Merge that PR after its CI check passes.

To publish, manually dispatch the **Release** workflow from `main`. The `npm` environment can require approval.
The workflow verifies the browser and package, then publishes the **same tested tarball** to npm.
It creates a GitHub release with the archive and SHA-256 checksum.

Configure npm trusted publishing for GitHub repository `souljorje/humagent`, workflow filename `release.yml`, environment `npm`, and permission to run `npm publish`.
The package must exist on npm before you can configure its trusted publisher. Publish the first `0.1.0` release using the checked archive with maintainer credentials, then use the workflow for later versions.

See [Changesets](.changeset/README.md) for versioning instructions. The first release is not yet published.
