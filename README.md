# Humagent

[![Check](https://github.com/souljorje/humagent/actions/workflows/check.yml/badge.svg)](https://github.com/souljorje/humagent/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Review local pages with your AI agent. Collect comments, exact replacement proposals, and structured decisions, then send one review.

```mermaid
flowchart TB
  I["HTML / Web App"]
  A["AI agent"]
  H["Human"]
  A -->|"creates or connects"| I
  I -->|"Send: one review batch"| A
  H -->|"interact and add feedback"| I
```

Works with your harness. Runs on your computer. Needs no account or API key.

## Use cases

- Interactive plans and reports
- Disposable prototypes
- Design refinement

## Install

Requires Node.js 24+, or Bun 1.4.4+.

```sh
npm i -g humagent
```

```sh
npx humagent@latest
```

## Quick start

1. Install the agent skill:

```sh
humagent setup
```

2. Open a local page or the built-in demo. Run one of these commands:

```sh
humagent demo
```

Use `humagent open http://127.0.0.1:3000` for a local app.

3. Ask your agent:

> Read `.agents/skills/humagent/SKILL.md`. Wait for feedback from the open page.

4. Enable commenting from the floating bar.
5. Add a comment to an element.
6. Choose **Send** when your feedback is ready.

Click a numbered marker to edit or delete its comment. Disable commenting to interact with the page normally.
Select text while commenting to suggest an exact replacement. Expand the bar to inspect pending items or retry delivery.

Confirmed sends remove their markers. The bar shows delivery status. Your agent explains its work in its own chat.

The page stays interactive. Replacement proposals do not change its text. Your agent edits source after receiving the review.

[Commands](docs/CLI.md) · [Forms and SDK](docs/SDK.md) · [Security and limits](docs/SECURITY.md)

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](https://github.com/souljorje/humagent/blob/main/CONTRIBUTING.md).

## Inspiration

Humagent is inspired by [Lavish AXI](https://github.com/kunchenguid/lavish-axi) and [Human Review](https://github.com/petergyang/human-review).

## Licence

Humagent uses the [MIT License](LICENSE)
