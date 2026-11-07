# Engineering

Preserve application behavior. Keep task-specific requests as data, not backend handlers.

## Runtime

Use Bun 1.4.4 for development, dependencies, builds, and tests. Keep `bun.lock` and frozen installation in CI.

Use TypeScript for application code, examples, scripts, and tests. Compile browser code to native JavaScript modules.

Published JavaScript must run on Node.js 24+ and Bun 1.4.4+. Keep the Node shebang for npm/npx compatibility.
Child servers must use the CLI's runtime executable. npm users must not need Bun.

Keep temporary output in `.local/`.

## Validation

Run `bun run check` after each coding increment. CI runs this same command on pull requests.

The fast check builds required output, checks format and types, and runs unit tests.
Run `bun run test:browser:built` locally after browser or SDK changes.

The manual release runs `bun run check:release`. It tests the browser and the exact archive before publishing.
Never rebuild or modify the archive after acceptance testing.

Add a Changeset with `bun run changeset` for publishable API, behavior, or dependency changes.
Internal tests, documentation, and CI-only changes usually need no Changeset.

Report which commands ran, failures, and limits. Do not claim unexecuted tests passed.


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
