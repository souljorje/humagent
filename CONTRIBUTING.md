# Contribute to Humagent

Use Bun 1.4.4 for development. Read [AGENTS.md](AGENTS.md) and [the specification](docs/SPEC.md) before changing behavior.

## Install and check

```sh
bun install --frozen-lockfile
bun run check
bunx --bun playwright-core install chromium
bun run test:browser
```

Linux CI installs browser system dependencies with `--with-deps`. Set `HUMAGENT_BROWSER_PATH` to use an existing Chromium executable.

## Check the package

Install Node.js 22+ for npm compatibility checks.

```sh
bun pm pack
bun run test:package
bun run test:install
```

The checks install the archive in a temporary directory. They do not publish to a registry.

## Keep the scope clear

Preserve ordinary application behavior in Interact mode. Use structured input for task-specific requests. Do not add a backend handler for each new workflow.

Keep source files unchanged during browser review. Add a regression test for delivery, revision, security, or attachment changes.

Retain license notices for adapted code. Use the documentation rules in `AGENTS.md`. Record compatibility limits rather than claiming unsupported behavior.

Keep screenshots, state, and logs in `.local/`. Do not commit credentials or generated archives.
