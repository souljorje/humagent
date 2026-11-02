# Contributing

Use Bun 1.4.4. Read [AGENTS.md](AGENTS.md) and [the specification](docs/SPEC.md) before changing behavior.

## Checks

```sh
bun install --frozen-lockfile
bun run check
bunx --bun playwright-core install chromium
bun run test:browser
```

Linux CI uses `--with-deps` for browser system dependencies. Set `HUMAGENT_BROWSER_PATH` to use an existing Chromium executable.

Package checks also need Node.js 22+:

```sh
bun pm pack
bun run test:package
bun run test:install
```

These checks install the archive in a temporary directory without publishing it.

## Changes

Preserve application behavior in Interact mode. Keep task-specific requests as data, not new backend handlers.

Do not write source files during review. Add regression tests for changes to delivery, revisions, security, or attachment.

Follow the writing and attribution rules in `AGENTS.md`. Record compatibility limits. Keep screenshots, state, and logs in `.local/`.

Do not commit credentials or generated archives.
