# Humagent

**Work with your AI agent through pages, prototypes, and local apps.**

Open an interface. Select text, leave a comment, or propose an exact edit. Your existing agent receives the request and replies in the same workspace.

Generated interfaces can submit forms and structured choices. New interactions do not require new server handlers.

Humagent runs locally. It does not run a model, require an API key, collect telemetry, or change your source files.

## Start

Use **Node.js 22+** for npm, npx, and pnpm. Use **Bun 1.4.4+** for `bunx --bun`. You do not need both runtimes.

> Registry publication is separate from this repository. Until the first npm release, install a package from the CI artifacts or build from source.

After publication, try the included planning example:

```sh
npx humagent@latest demo
```

Equivalent commands:

```sh
bunx --bun humagent@latest demo
pnpm dlx humagent@latest demo
```

Or install the command:

```sh
npm install --global humagent
humagent demo
```

The package includes compiled JavaScript and browser files. Users do not compile the package or install development dependencies.

### Before the first npm release

Download `humagent-0.1.0.tgz` from a successful [CI run](https://github.com/souljorje/humagent/actions).

```sh
npm install --global ./humagent-0.1.0.tgz
humagent demo
```

The local archive contains this repository's code. A repository commit does not publish the npm package.

## Connect your agent

Humagent uses the coding agent you already run. Opening a page does not start an agent.

1. Install the skill in your project:

   ```sh
   npx humagent@latest setup
   ```

2. Ask your agent to read `.agents/skills/humagent/SKILL.md`.
3. Ask your agent to open a page and continue the review through Humagent.

For example:

> Read the Humagent skill. Create an interactive plan for this task. Open the plan and wait for my choices.

Use `setup --directory PATH` when your agent reads skills from another directory. The command preserves an existing modified skill unless you pass `--force`.

The browser shows whether an agent is listening. Input remains queued when no agent is connected. Resume your agent to process queued input.

## Open your own work

Review a local HTML file:

```sh
humagent open ./proposal.html
```

Review a trusted development application:

```sh
humagent open http://127.0.0.1:3000
```

The application keeps its own renderer and build process. Humagent adds review controls through a local proxy.

The command prints a private browser URL and session ID. Use `--no-open` to prevent automatic browser opening.

## Work in the browser

| Mode | What you can do |
| --- | --- |
| **Interact** | Use links, forms, and application controls normally. This is the default. |
| **Annotate** | Select words or click an element. Send a comment with that context. |
| **Propose edit** | Select text or an element. Enter its exact replacement. Your agent applies the change. |

Press Escape inside the interface to return to Interact mode. Use the conversation panel for requests that do not need a selected target.

Source changes appear as a refresh notice. Refresh explicitly to load the new version. Humagent retains its drafts and opted-in form values.

Application-owned state can reset during refresh. Humagent cannot preserve every application's memory.

## Add structured choices

Add attributes to an ordinary HTML form:

```html
<form
  id="plan"
  data-humagent-intent="revise_plan"
  data-humagent-message="Revise the plan. Do not execute it."
  data-humagent-persist
>
  <label>
    Approach
    <select name="approach">
      <option value="pilot-first">Pilot first</option>
      <option value="platform-first">Platform first</option>
    </select>
  </label>
  <button type="submit">Revise plan</button>
</form>
```

Humagent sends the named values to the agent. `revise_plan` is a request description, not executable code or an authorization.

Custom mini-apps can use `window.humagent.submit()`. The [SDK guide](docs/SDK.md) describes state, form bindings, replies, and delivery.

## Agent commands

Use `--json` for explicit machine-readable output. Piped output also uses JSON.

```sh
humagent open ./proposal.html --json
humagent wait SESSION --consumer my-agent --timeout 50 --lease 600
humagent reply SESSION --receipt RECEIPT --message "Updated the proposal."
humagent wait SESSION --consumer my-agent --timeout 50 --lease 600
```

Replace `SESSION` and `RECEIPT` with the returned IDs. Keep `wait` attached to the active agent turn.

A reply with a receipt completes that batch only. New input remains queued. The [CLI guide](docs/CLI.md) includes all commands.

## Examples

```sh
humagent demo plan
humagent demo calculator
humagent demo existing
```

The demos cover structured planning, local calculations, and review of an ordinary page. Humagent copies them into its data directory before opening them.

You can edit those copies. A repeated demo command does not overwrite your changes.

## Privacy and limits

Humagent stores session data under `~/.humagent`. Use `--home PATH` or `HUMAGENT_HOME` to select another directory.

Keep session URLs private. Use trusted local pages and development applications. Do not expose the server through a public tunnel.

Local HTML blocks external resources by default. Add `--network` only for a trusted file that needs external resources.

This release supports HTML files and HTTP localhost applications. It does not support remote sites, cookie authentication, Markdown rendering, or MCP Apps.

Application security policies, service workers, and development-server settings can prevent attachment. Test your application before relying on the proxy.

The [security guide](docs/SECURITY.md) describes the boundaries. The [troubleshooting guide](docs/CLI.md#troubleshooting) covers common failures.

## Develop and release

Use Bun for development:

```sh
git clone https://github.com/souljorje/humagent.git
cd humagent
bun install --frozen-lockfile
bun run build
bun dist/cli.js demo
```

Before the implementation PR merges, use its `feat/initial-runtime` branch.

See [CONTRIBUTING.md](https://github.com/souljorje/humagent/blob/feat/initial-runtime/CONTRIBUTING.md) for checks. See [docs/RELEASE.md](https://github.com/souljorje/humagent/blob/feat/initial-runtime/docs/RELEASE.md) for packaging and publication.

## Inspiration and license

Humagent is inspired by [Lavish AXI](https://github.com/kunchenguid/lavish-axi) and [Human Review](https://github.com/petergyang/human-review).

Some targeting and text-anchoring helpers adapt their MIT-licensed code. Neither project is a runtime dependency.

Targeting helpers derive from revision `69bf3090b24a04773ffd05d2e0b23d91ca41923b`, file `src/artifact-sdk.js`.
Text anchors derive from revision `dbcb7a69fa4739c4245ee178468f2bc2d6fb2991`, file `src/anchor-text.js`.

Humagent uses the [MIT License](LICENSE). The notices below apply to the adapted helpers.

### Source credits

| Helper | Project | Author |
| --- | --- | --- |
| `web/vendor/targets.js` | [Lavish](https://github.com/kunchenguid/lavish-axi) | Kun Chen |
| `web/vendor/anchors.js` | [Human Review](https://github.com/petergyang/human-review) | Peter Yang |

### Third-party notices

Keep these notices with copies of the adapted helpers. The npm package includes this README.

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
