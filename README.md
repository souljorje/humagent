# Humagent

[![Check](https://github.com/souljorje/humagent/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/souljorje/humagent/actions/workflows/check.yml?query=branch%3Amain)
[![npm version](https://img.shields.io/npm/v/humagent)](https://www.npmjs.com/package/humagent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Collaborate with your AI agent in HTML: make edits, leave comments, and generate interactive plans.**

Works with any harness. Runs locally. Needs no account or API key.

[![Humagent demo: review a page and send structured feedback to your agent](./docs/humagent-demo.gif)](./docs/humagent-demo.gif)

### Use cases

- Interactive plans and reports
- Disposable prototypes
- Design refinement

## Quick start

Requires Node.js 24+, or Bun 1.4.4+.

```sh
npm i -g humagent
```

Run without installation:

```sh
npx humagent@latest
```

Try demo:

```sh
humagent demo
```

Or open your own file or local app:

```sh
humagent open ./page.html
```

## Agent skill

```sh
npx skills add souljorje/humagent
```

Use with Agent:

```text
/humagent ./page.html
```

Generate an interactive page:

> Create an interactive plan for next feature using /humagent.

## Docs

- [Usage](docs/USAGE.md)
- [CLI](docs/CLI.md)
- [SDK](docs/SDK.md)
- [Security](docs/SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Edit the demo video](assets/humagent-film/README.md)

## Contribute

Open an issue for bugs and feature requests. Report vulnerabilities privately through the [security policy](SECURITY.md). Read [Contributing](CONTRIBUTING.md) before your first pull request.

## Inspiration

Humagent is inspired by [Lavish AXI](https://github.com/kunchenguid/lavish-axi) and [Human Review](https://github.com/petergyang/human-review).

## License

[MIT License](LICENSE)
