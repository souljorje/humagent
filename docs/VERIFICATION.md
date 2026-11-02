# Verification

## Release candidate

The check workflow builds the archive with Bun 1.4.4. It tests the browser and agent loop on Ubuntu 24.04.

A separate matrix installs that same archive with npm. The matrix covers Node.js 24 on Linux and Node.js 22 on macOS and Windows.

A runner job checks Bun execution, pnpm execution, and npx installation from a fresh cache. These jobs do not publish a package.

See [Check runs](https://github.com/souljorje/humagent/actions/workflows/check.yml) for the result of a specific commit. Do not infer success from this document alone.

## Recorded result

Commit `f35fc67e20dbe1f2bb0939211ffa36a3bee5c6fd` passed [all five CI jobs](https://github.com/souljorje/humagent/actions/runs/41467473992).

The build, 27 core/HTTP/CLI checks, browser suite, and package checks passed. npm installation passed on Linux, macOS, and Windows.

The command-runner tests passed for npx, `bunx --bun`, and `pnpm dlx`. These tests used the exact archive from the build job.

The downloaded CI source matched the local source. The desktop and narrow-layout screenshots were inspected.

A local `npm publish --dry-run` accepted that archive. The command warned that authentication is required for actual publication.

The dry run does not prove registry ownership or publish the package.

## Checks

- Protocol tests check bounded input, exact edit values, and structured submissions.
- Store tests check retries, leases, acknowledgments, restart, and conflicting revisions.
- HTTP tests check credentials, origin separation, paths, proxy requests, and WebSocket upgrades.
- CLI tests check Bun execution, help, versions, arguments, and skill installation.
- Browser tests check forms, annotations, replies, refresh, restart, and narrow layouts.
- Package tests check files, license notices, executable behavior, and the absence of installation build hooks.
- Installation tests exercise the packaged server through npm and npx without requiring Bun.

## Local checks for this change

Node.js 22.16.0 executed the compiled archive after a clean npm installation. The test exercised the session loop and localhost proxy.

The local npx test passed. The authoring environment cannot install Bun through its shell. CI supplies the pinned Bun and browser checks.

## Remaining limits

The suite uses representative local pages and a small HTTP application. It does not prove compatibility with every application framework.

Real agent-provider sessions, assistive technology, Safari, and Firefox require separate checks. The tests are not an independent security audit.

Cookie authentication, remote websites, and transparent service-worker behavior are unsupported.

A source revision hashes entry HTML rather than every dependency. Dynamic HTML can invalidate a revision without an apparent content change.

Humagent preserves explicit form state and its own drafts. It does not preserve an arbitrary application's memory.

Registry publication, trusted-publisher configuration, and post-publication checks require maintainer action.
