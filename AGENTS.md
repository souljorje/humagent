# Humagent engineering

Read [docs/SPEC.md](docs/SPEC.md) before changing behavior. Humagent connects an existing agent to an interface.

Preserve application behavior by default. Do not add task-specific backend handlers.

## Runtime and checks

Use Bun 1.4.4 for development, dependencies, tests, and builds. Keep `bun.lock`. Use frozen installation in CI.

Use TypeScript for the server and CLI. Use browser-native modules for the workspace.

The published JavaScript must run on Node.js 22+ and Bun 1.4.4+. Keep the Node shebang for npm and npx compatibility.

The CLI starts its server with the same runtime executable. Do not require Bun for an npm user's installation.

Run `bun run check` after code changes. Run `bun run test:browser` after browser changes.

Run `bun pm pack` before package checks. Run `bun run test:package` and `bun run test:install`.

Record checks that cannot run. Test an existing application and a generated mini-app. Keep temporary output in `.local/`.

## Data and permissions

Give each interaction an explicit target and revision. Preserve input until receipt-specific acknowledgment.

Do not silently attach stale input to another target. Never serialize an application's DOM into its source.

Keep control credentials outside frames. Apply the existing agent's permission rules to consequential actions.

## Attribution

Keep dependencies limited. Preserve copyright and license notices for copied or adapted code.

Keep upstream project names, author names, source references, and full license notices only in the root README.

Include that README in every package. Use a README link in helper headers. Check both source files and the package.

## Documentation

Use the [ASD-STE100 writing skill](https://github.com/danyuchn/asd-ste100-skill/blob/master/SKILL.md) for English documentation.

Use its strict rules for procedures and agent instructions. Use its prose rules for explanations and READMEs.

Keep instructions within 20 words per sentence. Keep descriptions within 25 words per sentence.

Use one instruction per sentence. Use active voice and consistent terms. Define necessary technical terms. Do not use semicolons in prose.

Preserve scope, conditions, numbers, and uncertainty. Do not claim official dictionary compliance or unsupported compatibility.

## Release

Ship compiled JavaScript, browser assets, examples, and the skill. Installation must not execute build or download scripts.

Do not publish, merge, deploy, or expose local ports without authorization. Preparing a release is not permission to publish it.
