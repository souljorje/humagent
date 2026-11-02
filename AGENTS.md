# Engineering

Read [the specification](docs/SPEC.md) before changing behavior. Preserve application behavior. Do not add task-specific backend handlers.

## Runtime and checks

Use Bun 1.4.4 for development, dependencies, builds, and tests. Keep `bun.lock` and frozen installation in CI.

Use TypeScript for the server and CLI. Use browser-native modules for the workspace.

Published JavaScript must run on Node.js 22+ and Bun 1.4.4+. Keep the Node shebang for npm/npx compatibility.
Child servers must use the CLI's runtime executable. npm users must not need Bun.

Run `bun run check` after code changes. Run `bun run test:browser` after browser changes.

Run `bun pm pack` before `bun run test:package` and `bun run test:install`.
Test both an existing app and a generated mini-app. Record checks that cannot run.

Keep temporary output in `.local/`.

## Data and permissions

Include target and revision in each interaction. Keep input until receipt-specific acknowledgment. Do not reassign stale input to another target.

Never serialize a running application's DOM into source. Keep control credentials outside frames. Follow the agent's existing permissions for consequential actions.

## Attribution

Limit dependencies. Keep upstream names, authors, source references, and complete license notices only in the root README.

Include that README in every package. Link helper headers to its notices. Check source and package contents.

## Documentation

Use the [ASD-STE100 skill](https://github.com/danyuchn/asd-ste100-skill/blob/master/SKILL.md).
Use strict rules for procedures and agent instructions, and prose rules for explanations.

Keep instructions within 20 words per sentence and descriptions within 25. Use one instruction per sentence, active voice, and consistent terms.

Remove repetition and obvious statements. Define necessary terms. Do not use semicolons in prose.
Preserve conditions, numbers, scope, and uncertainty. Do not claim dictionary compliance or untested compatibility.

## Release

Ship compiled JavaScript, browser assets, examples, and the skill. Installation must not run build or download scripts.

Do not publish, merge, deploy, or expose local ports without authorization.
