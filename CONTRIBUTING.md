# Contributing

See [Development](docs/development.md) for checks, architecture, plugins, pull requests, and release.

## Setup

Install Node.js 24 or later. Use Bun 1.4.4 for development.

```sh
git clone https://github.com/souljorje/humagent.git
cd humagent
bun install --frozen-lockfile
bun run dev
```

Open the printed workspace URL. See [Local development](docs/development.md#local-development).

Bun reuses its local package cache automatically. Playwright reuses installed browsers.
