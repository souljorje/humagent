# Humagent

Review local pages and apps with your AI agent. Leave comments, propose text changes, or send form values. Your agent edits the source and replies.

Humagent runs locally without a model service, API key, or telemetry.

## Use

Requires Node.js 24+ or Bun 1.4.4+.

After npm publication:

```sh
npm install --global humagent
humagent setup
humagent demo
```

For one-off use, replace `humagent` with `npx humagent@latest`, `bunx --bun humagent@latest`, or `pnpm dlx humagent@latest`.

Ask your agent:

> Read `.agents/skills/humagent/SKILL.md`. Open my page and wait for feedback.

Opening a page does not start an agent. Input stays queued until your agent runs `wait` during an active turn.

```sh
humagent open ./proposal.html
humagent open http://127.0.0.1:3000
```

Use **Interact** for normal controls, **Annotate** for comments, and **Propose edit** for exact replacements. Humagent does not edit source files.

[Commands](docs/CLI.md) · [Forms and SDK](docs/SDK.md) · [Security and limits](docs/SECURITY.md)

## Build and publish

Use Bun 1.4.4, Node.js 24+, and pnpm.

Server and CLI: `src/`. Browser modules: `web/`. Tests: `test/`.

```sh
bun install --frozen-lockfile
bun run build
bun dist/cli.js demo
```

For local release checks, install Chromium or set `HUMAGENT_BROWSER_PATH`:

```sh
bunx --no-install playwright install chromium
bun run check:release
```

`bun run test:browser` runs independent browser cases. Failure screenshots, traces, and the HTML report stay under `.local/`.

Run the GitHub **Release** workflow on `main` with the package version. It checks the build first. Set `publish: true` to publish to npm and GitHub.

GitHub releases include the source ZIP.

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for `release.yml` and the `npm` environment.
For the first release, set the `NPM_TOKEN` repository secret if trusted publishing is unavailable.

## Inspiration and license

Humagent is inspired by [Lavish AXI](https://github.com/kunchenguid/lavish-axi) and [Human Review](https://github.com/petergyang/human-review).

Humagent uses the [MIT License](LICENSE). Third-party code has the notices below.

### Source credits

| Helper | Source | License |
| --- | --- | --- |
| `web/targets.js` | [source](https://github.com/kunchenguid/lavish-axi/blob/69bf3090b24a04773ffd05d2e0b23d91ca41923b/src/artifact-sdk.js) | [notice](#third-party-notices) |
| `web/targets.js` | [source](https://github.com/petergyang/human-review/blob/dbcb7a69fa4739c4245ee178468f2bc2d6fb2991/src/anchor-text.js) | [notice](#third-party-notices) |

### Runtime dependencies

| Package | Source | License |
| --- | --- | --- |
| `hono` | [source](https://github.com/honojs/hono) | [notice](#third-party-notices) |
| `@hono/node-server` | [source](https://github.com/honojs/node-server) | [notice](#third-party-notices) |

### Third-party notices

Keep these notices with copies of the third-party code. Every release archive includes this README.

<details>
<summary><code>hono</code>: copyright and MIT license</summary>

```text
MIT License

Copyright (c) 2021 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary><code>@hono/node-server</code>: copyright and MIT license</summary>

```text
MIT License

Copyright (c) 2022 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>Element targeting helpers: copyright and MIT license</summary>

```text
MIT License

Copyright (c) 2026 Kun Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary>Text anchoring helpers: copyright and MIT license</summary>

```text
MIT License

Copyright (c) 2026 Peter Yang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>
