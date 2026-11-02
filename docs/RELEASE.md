# Release

Publication requires maintainer authorization and access to the npm package name.

## Build and check

1. Select the reviewed commit.
2. Set the version in `package.json`.
3. Update `CHANGELOG.md` and the README's publication status.
4. Run the checks.

```sh
bun install --frozen-lockfile
bun run check
bunx --bun playwright-core install --with-deps chromium
bun run test:browser
bun pm pack
bun run test:package
bun run test:install
```

Bun 1.4.4 builds and tests the package. Installation checks need Node.js 22+.

`prepack` compiles TypeScript. The archive includes compiled JavaScript, declarations, browser assets, examples, user documentation, and the agent skill.

It excludes development source, tests, credentials, and session data. Installation needs no build step or runtime dependencies.

Inspect the archive:

```sh
npm pack --dry-run
npm publish ./humagent-0.1.0.tgz --dry-run --access public
```

Replace `0.1.0` with the release version. A dry run checks packaging, not registry ownership.

## First publication

Check the package name and account:

```sh
npm view humagent name version maintainers --json
npm whoami
```

`E404` means the registry returned no package. A network error does not prove availability. Resolve name conflicts before publishing.

Authenticate, then publish the tested archive:

```sh
npm login
npm publish ./humagent-0.1.0.tgz --access public
```

Do not substitute an untested build. Follow npm's authentication requirements.

## GitHub Actions

The manual `Release` workflow defaults to `publish: false`. It runs all checks and publishes only from `main` with `publish: true`.

Configure npm trusted publishing for this repository, `.github/workflows/release.yml`, and the `npm` environment.
Configure required reviewers for that GitHub environment separately.

The publication job checks the version and publishes the tested archive with provenance. Do not store long-lived npm tokens in the repository.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for account requirements.

## Check the published package

```sh
npx humagent@0.1.0 --version
npx humagent@0.1.0 demo
bunx --bun humagent@0.1.0 --version
pnpm dlx humagent@0.1.0 --version
```

Check a local file, a localhost app, and the agent's wait/reply loop. Record untested frameworks and known limits.
