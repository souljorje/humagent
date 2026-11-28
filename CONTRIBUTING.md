# Contributing

See [Development](docs/development.md) for checks, architecture, plugins, pull requests, and release.

## Setup

Install Node.js 24 or later. Install the exact Bun canary declared in `package.json`.

```sh
git clone https://github.com/souljorje/humagent.git
cd humagent
npm install --global "$(node -p 'require("./package.json").packageManager')"
bun run check:toolchain
bun install --frozen-lockfile
bun run hooks:install
bun run dev
```

Open the printed workspace URL. See [Local development](docs/development.md#local-development).

Bun reuses its local package cache automatically. Playwright reuses installed browsers.

`toolchain.json` records the expected Bun revision. Change the package pin and revision together when upgrading Bun.

Git hooks check staged formatting and lint before commit. They run the cached main check before push.
