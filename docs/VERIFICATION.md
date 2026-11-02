# v0.1 verification record

Date: 2026-11-02. Status: local development preview.

The implementation is on `feat/initial-runtime` in [PR #1](https://github.com/souljorje/humagent/pull/1). This work does not merge, publish, or deploy the project.

## Bun migration

The user selected Bun after the initial Node.js implementation. Bun now runs the CLI, server, TypeScript compiler, tests, browser driver, and packaging.

Tested runtime: **Bun 1.4.4 on Ubuntu 24.04**. TypeScript remains at 5.8.3. Playwright remains at 1.56.1 with its Chromium 141 browser.

Verified runtime commit: `1b2857715da9669dea8949232ad0f8ae562f632b`.

The [first complete Bun CI run](https://github.com/souljorje/humagent/actions/runs/41460266495) passed these checks:

| Command or check | Observed result |
| --- | --- |
| `bun install` | Installation and the prepare build passed. Bun generated the new lockfile. |
| `bun run typecheck` | Type checking passed under Bun. |
| `bun run test` | Core, HTTP, and CLI tests passed with `bun:test`. |
| CLI subprocess test | The CLI started a Bun server and completed wait, delivery, renewal, reply, end, setup, and stop. |
| `bunx --bun playwright-core install --with-deps chromium` | Browser installation passed. |
| `bun run test:browser` | All existing browser scenarios passed under Bun. |
| `bun pm pack` | Bun created the package archive. |
| `bun run test:package` | The extracted executable used its Bun shebang without a `node_modules` directory. |

The committed `bun.lock` comes from this run. The delivery workflow uses `bun install --frozen-lockfile` and no npm lockfile. Use the current PR's Check run for the frozen-install result after these documentation changes.

No Node.js process runs the project scripts. GitHub's own actions can use their internal JavaScript runtime. That action implementation is not a Humagent runtime dependency.

## Browser coverage

The browser suite checks these behaviors:

- Form values survive workspace reload. Coverage includes radio, text, textarea, select, and checkbox controls.
- Form submission reaches a waiting agent as structured JSON. A receipt-specific reply appears in conversation and completes the batch.
- A new intent with nested values needs no runtime handler.
- Element annotations and exact replacements reach the session without browser writes to source.
- A selected range retains quote, prefix, and suffix evidence.
- A stale source revision returns `STALE_REVISION`.
- Explicit refresh loads changed source and preserves the workspace draft and persisted form values.
- Server restart retains session data. Explicit refresh reconnects the frame to its new origin.
- The calculator changes locally without creating agent events. Explicit submission creates an event.
- An existing localhost application retains buttons, assets, CSS, and JSON API requests through the proxy.
- An application frame cannot read the control API without credentials.
- Desktop and 390 px layouts remain within the viewport.

These tests use a simulated agent consumer. They are not real user sessions in Claude Code or Codex.

## Core and HTTP coverage

The core tests cover protocol validation, payload limits, reserved keys, persistence, input retries, reply retries, and source revisions.

They also cover state versions, receipt-specific completion, competing consumers, lease expiry, renewal, restart, ended sessions, corrupt state, and quote anchors.

HTTP tests cover separate origins, SDK injection, session permissions, hostile headers, and the single-writer lock.

They reject unsafe paths, escaped symlinks, remote targets, and credential-bearing URLs. They check wait results, HTTP proxy behavior, external redirect refusal, and WebSocket upgrades.

## Earlier evidence

The original specification preceded implementation in commit `9ac726ec0d20cacb51e583e307300441fdd81db2`.

[Original Node.js CI](https://github.com/souljorje/humagent/actions/runs/41458116439) passed before this migration. Its runtime was Node.js 22 on Ubuntu 24.04. It checked 22 core/HTTP tests, browser behavior, and package creation.

The earlier authoring session also checked CLI processes and an extracted package locally with Node.js. These results are historical evidence, not the Bun requirement.

The earlier session inspected desktop and mobile CI screenshots. It corrected refresh after server restart and a browser assertion that read the previous document too early.

The earlier container blocked localhost browser navigation. This migration environment has no Bun binary and cannot resolve GitHub through its shell. This migration therefore uses GitHub Actions for Bun execution and browser evidence. No local Bun test result is claimed.

## Documentation

The README, specification, SDK guide, security guide, and agent skill use the selected writing guide. Engineering instructions link to the [ASD-STE100 skill](https://github.com/danyuchn/asd-ste100-skill/blob/master/SKILL.md).

The rewrite preserves commands, conditions, permissions, and uncertainty. It does not claim certification against ASD's official dictionary. License notices remain unchanged.

## Remaining limits

Real agent sessions, macOS, Windows, Safari, Firefox, assistive technology, and teammate onboarding remain untested.

Existing-app tests use a small HTTP application and a WebSocket fixture. They do not establish general Vite, Next.js, or SvelteKit compatibility.

Cookie authentication and transparent service-worker behavior are unsupported. The proxy accepts explicit HTTP loopback targets only.

A source revision hashes entry HTML, not every dependency. Dynamic nonces, timestamps, and client-only changes need additional care.

Form persistence is explicit. Humagent does not preserve the full application heap, scroll position, or every framework state value.

Exact edits remain proposals. Markdown rendering, rich-text editing, automatic source patches, MCP Apps, schema renderers, React compilation, and multi-user hosting remain outside v0.1.

The tests are not a security audit. Use trusted development artifacts and dedicated directories. Do not treat generated pages as safe merely because they run inside a frame.
