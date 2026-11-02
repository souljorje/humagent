# Prepare and publish a release

This guide prepares a public npm package. Publication requires registry access and explicit maintainer authorization.

## Prepare

1. Select the reviewed commit.
2. Set the release version in `package.json`.
3. Update `CHANGELOG.md`.
4. Update publication status in the README.
5. Run the checks below.

```sh
bun install --frozen-lockfile
bun run check
bunx --bun playwright-core install --with-deps chromium
bun run test:browser
bun pm pack
bun run test:package
bun run test:install
```

Use Node.js 22+ for npm installation checks. Bun 1.4.4 builds the package and runs development checks.

The `prepack` hook compiles TypeScript with Bun. The archive includes compiled JavaScript, declarations, browser assets, examples, documentation, and the agent skill.

The archive excludes development source, tests, credentials, and session data. It has no runtime dependencies or install-time build scripts.

Inspect the archive before publication:

```sh
npm pack --dry-run
npm publish ./humagent-0.1.0.tgz --dry-run --access public
```

Replace `0.1.0` with the selected version. The dry run does not publish the package or prove ownership of its registry name.

## Check registry ownership

Check whether the name is available or belongs to your npm account:

```sh
npm view humagent name version maintainers --json
npm whoami
```

An `E404` result means the registry did not return a package. A network failure does not establish name availability.

Resolve any name conflict before publication. Do not publish over another maintainer's package.

## First publication

Authenticate with the npm account that will own the package:

```sh
npm login
npm publish ./humagent-0.1.0.tgz --access public
```

Publish the tested archive, not a different build. Follow npm's account authentication requirements.

These commands are instructions for the maintainer. Preparing this repository does not run them.

## Later releases through GitHub Actions

The `Release` workflow is manual. Its `publish` input defaults to false.

The workflow runs the full check workflow first. It publishes only from `main` when `publish` is true.

Configure an npm trusted publisher for this repository and `.github/workflows/release.yml`. Match the `npm` environment name in its configuration.

Configure required reviewers on the GitHub `npm` environment. The workflow file cannot configure that account-level protection for you.

The publication job validates the requested version. It then publishes the exact archive from the verification job with provenance.

No long-lived npm token belongs in this repository. Trusted-publisher configuration and a real publication remain separate from build verification.

See the [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/) for account requirements.

## Verify the published package

```sh
npx humagent@0.1.0 --version
npx humagent@0.1.0 demo
bunx --bun humagent@0.1.0 --version
pnpm dlx humagent@0.1.0 --version
```

Check one local file and one localhost application. Check the agent's wait and reply loop.

Do not describe untested framework combinations as supported. Keep known limits in the README and security guide.
