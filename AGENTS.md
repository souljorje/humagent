# Humagent engineering

Read [docs/SPEC.md](docs/SPEC.md) before changing behavior. Humagent connects an existing agent to an interface. It is not a business renderer or an agent runner.

Preserve application behavior by default. Do not add task-specific backend handlers.

## Runtime and checks

Use Bun 1.4.4 for runtime, dependencies, tests, and packaging. Keep the supported minimum in `package.json`. Keep the CI version consistent with that requirement.

Use TypeScript for the server and CLI. Use browser-native modules for the workspace. Bun can use the existing `node:*` APIs. Do not introduce a Node.js subprocess.

Use `bun.lock` as the dependency lockfile. Run `bun install --frozen-lockfile` for reproducible installation. Do not restore `package-lock.json`.

Run `bun run check` after code changes. Run `bun run test:browser` when a browser is available. Run `bun pm pack` before `bun run test:package`. Record any check that cannot run.

Test an existing application and a generated mini-app. Neither test should need platform changes. Keep screenshots, state, and logs in `.local/`.

## Data and permissions

Give each interaction an explicit target, revision, and delivery receipt. Do not remove feedback when an agent reads it. Do not silently attach stale feedback to a new target.

Do not serialize a running application's DOM into its source. Keep control credentials outside frames and artifacts. Apply the existing agent's permission rules to source changes and external actions.

## Reuse

Keep dependencies limited. Preserve attribution for copied or adapted code. Do not depend on Lavish or Human Review to reuse an isolated helper. Do not rewrite their license notices.

## Documentation

Use the [ASD-STE100 writing skill](https://github.com/danyuchn/asd-ste100-skill/blob/master/SKILL.md) for English documentation.

Use its strict rules for procedures, safety text, and agent instructions. Use its prose rules for READMEs, explanations, and PR descriptions.

Keep instructions within 20 words per sentence. Keep descriptions within 25 words per sentence. Use one instruction per sentence. Use active voice and consistent terms. Define necessary technical terms. Do not use semicolons in prose.

Preserve scope, conditions, numbers, and uncertainty. Do not convert an untested capability into a verified claim. Do not claim official dictionary compliance without the official dictionary.

## Delivery

Do not publish packages without authorization. Do not expose local servers, merge branches, or deploy without authorization.
