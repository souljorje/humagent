# Contributing

Open an issue for a bug report or a large change. Documentation fixes can go straight to a pull request.

Do not report vulnerabilities in public issues. Read [Security and limits](docs/SECURITY.md).

## Setup

Install Node.js 24 or later. Install Bun 1.4.4 or later.

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

The build compiles TypeScript and copies browser assets into `dist/`. Tests are in `test/`.

## Checks

Run lint and the main check after code changes:

```sh
bun run lint
bun run check
```

Run browser tests after changes to `src/ui/` or `src/sdk/`:

```sh
bunx --no-install playwright install chromium
bun run test:browser
```

Set `HUMAGENT_BROWSER_PATH` to use an installed Chromium binary. Test output stays in `.local/`.

Run release checks before a release:

```sh
bun run check:release
```

The release check builds, tests, packs, and verifies the package. It also checks an npm install without Bun.

CI tests installation on Linux, macOS, and Windows.

## Pull requests

- Keep commits focused and logical.
- State the user-visible effect.
- List the checks that you ran.
- Note any remaining limits.
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
