# Engineering

Humagent adds a feedback layer to local pages. A human annotates a page. An agent applies the feedback. The agent completes a receipt.

Preserve application behavior. Keep task-specific requests as data, not backend handlers.

Treat inputs and shared snapshots as read-only. Prefer collection methods that return new values. Keep local mutation when it avoids repeated copies or makes an algorithm clearer.

Write functions at module level and pass state as an explicit argument. Keep decisions pure. Nest a function only as a short callback.

Extract a function when code reuses it, when it handles an event, or when it is one complete decision. Keep other steps in the function that uses them.

## Map

| Path | Contains |
| --- | --- |
| `src/cli/` | Commands, options, and server startup |
| `src/server/` | Server startup, the client of a running server, assets |
| `src/server/control/` | Control routes and their access rules |
| `src/server/pages/` | Page serving, sources, and the app proxy |
| `src/server/sessions/` | Sessions and their store |
| `src/ui/` | Workspace entry, session access, page bridge |
| `src/ui/workspace/` | Workspace state and logic |
| `src/ui/bar/` | Bar rendering |
| `src/sdk/` | Injected page host, bridge, targets, and overlay |
| `src/sdk/annotating/` | Annotation input, the editor, and placement |
| `src/plugins/` | One review kind per module |
| `src/shared/` | Contracts, validation, helpers |
| `src/examples/` | The demo page, which is also the development page |
| `vite.config.ts` | Build and development server of browser code |
| `test/` | CLI, server, and browser tests |

## Invariants

- Keep the transport free of review kinds. One module in `src/plugins/` defines each kind.
- The server stores `data` as JSON. It checks the envelope and the limits only.
- Include the target and the revision in each interaction. Never reassign stale input.
- Keep input until the agent completes its receipt.
- Never serialize a running application's DOM into source. Keep credentials outside frames.
- Follow the agent's existing permissions for consequential actions.

## Runtime

- Use Bun 1.4.4 for installs, builds, and tests. Keep `bun.lock` frozen in CI.
- Use TypeScript everywhere. Vite builds all JavaScript and declarations. `tsrs` checks types.
- Keep Vite out of `src/server/` and `src/cli/`.
- Follow the [style and import rules](docs/development.md#styles).
- Support Node.js 24+ and Bun 1.4.4+ in published code. npm users must not need Bun.
- Keep temporary output in `.local/`, except `.turbo/`.

## Checks

- Run `bun run check` after each increment.
- Run `bun run test:browser:built` for browser, SDK, or test changes.
- Keep the suite a smoke suite. Test each workflow once, through the browser or the CLI.
- Extend a test before you add a test. Keep coverage for permissions, revisions, receipts, persistence, and runtime.
- Report the checks that you ran. Do not claim unexecuted checks passed.
- See [Development](docs/development.md#checks) for browser setup, caching, and CI.

## Names

Use the [glossary](docs/GLOSSARY.md). Change the glossary first when a name changes.

## Documentation

- Write for an agent first and a human second.
- Describe what exists and what constrains it. Leave mechanics to code.
- Keep one fact in one file. Link to the owner of each other fact.
- Keep procedures under 20 words per sentence. Keep descriptions under 25.
- Use active voice and one instruction per sentence. Do not use semicolons in prose.
- Follow the [ASD-STE100 skill](https://github.com/danyuchn/asd-ste100-skill/blob/master/SKILL.md).
- Keep upstream names, authors, source references, and license notices only in the root README. Include that README in each package.

## Release

Follow [Development](docs/development.md#release). Do not publish, merge, deploy, or expose local ports without authorization.
