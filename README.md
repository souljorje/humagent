# Humagent

[![Check](https://github.com/souljorje/humagent/actions/workflows/check.yml/badge.svg)](https://github.com/souljorje/humagent/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Show your agent what you mean.** Comment on, rewrite, and answer any local page or app. Humagent sends it all to your AI agent as one structured review.

Works with any agent that can run shell commands. Runs on your computer. Needs no account or API key.

## How it works

1. **Open.** Your agent opens a page or local app with `humagent open`. It can also generate the page first.
2. **Review.** You comment on elements, rewrite text in place, and answer forms. Drafts collect in the floating bar.
3. **Send.** Your agent receives one review through `humagent wait`. It changes the source, then acknowledges the review.

The agent waits for your review during its turn. Its harness must allow a long-running shell command.

[![humagent.png](./docs/humagent.png)](./docs/humagent.png)

## Features

- Attach comments to any element, or rewrite page text in place. Source files stay unchanged until the agent applies feedback.
- The floating bar collects comments, edits, and form answers into one review.
- Drafts save on the server, so they survive reloads, restarts, and other tabs.
- Marked forms turn agent questions into choices. The [SDK](docs/SDK.md) adds programmatic input.
- Sandboxed frames and loopback-only serving. Read [Security and limits](docs/SECURITY.md).
- Opens local HTML files and HTTP localhost apps. Version 0.1 does not support remote sites or cookie-authenticated apps.

## Install

Requires Node.js 24+, or Bun 1.4.4+.

```sh
npm i -g humagent
```

Or run without installation:

```sh
npx humagent@latest
```

Building from source works too. See [Contributing](CONTRIBUTING.md#setup).

## Quick start

Install the agent skill with the [skills CLI](https://github.com/vercel-labs/skills). It asks which agents to install it for:

```sh
npx skills add souljorje/humagent
```

Try demo:

```sh
humagent demo
```

Or open your own file or local app:

```sh
humagent open ./page.html

humagent open http://127.0.0.1:3000
```

Generate an interactive page:

> Read the Humagent skill. Create an interactive plan for next feature and open it in Humagent.

## Docs

- [Usage](docs/USAGE.md)
- [CLI](docs/CLI.md)
- [SDK](docs/SDK.md)
- [Security](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Contribute

Open an issue for bugs and feature requests. Report vulnerabilities privately through the [security policy](SECURITY.md). Read [Contributing](CONTRIBUTING.md) before your first pull request.

## Inspiration

Humagent is inspired by [Lavish AXI](https://github.com/kunchenguid/lavish-axi) and [Human Review](https://github.com/petergyang/human-review).

## License

[MIT License](LICENSE)
