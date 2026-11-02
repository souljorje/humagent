# Humagent

Humagent connects a human and an existing agent through a local visual interface. The interface can be an existing application or a generated HTML mini-app.

**This is a preview release.** Humagent does not require a model, API key, cloud service, or mandatory component framework. It contains no telemetry or Good Place OS dependency.

Read the [specification](docs/SPEC.md) for the product contract. Read the [verification record](docs/VERIFICATION.md) for test results and limits.

## Run from source

Use **Bun 1.4.4 or later**. CI uses Bun 1.4.4. Node.js and npm are not required to run Humagent.

1. Clone the implementation branch.
2. Enter the repository directory.
3. Install the dependencies from the lockfile.
4. Open the planning example.

```sh
git clone --branch feat/initial-runtime https://github.com/souljorje/humagent.git
cd humagent
bun install --frozen-lockfile
bun dist/cli.js open examples/plan.html
```

Installation runs the TypeScript build with Bun. The compiled runtime has no external package dependencies. New HTML interfaces do not require a Humagent rebuild.

Run `bun link` to make the `humagent` command available locally. The executable starts Bun through its shebang. Otherwise, replace `humagent` in the commands below with `bun dist/cli.js`.

This repository does not publish an npm package yet. Do not assume that `bunx humagent` installs this code.

Before updating an earlier installation, run its `humagent stop` command. This stops the previous server without deleting its sessions. The next `open` command starts the server with Bun.

Try `examples/calculator.html` for a mini-app. Try `examples/existing.html` for a page without Humagent bindings.

## Work with an agent

The `open` command returns a session ID and a private browser URL. Give the session ID to your agent. Do not share the URL publicly.

1. Run `wait` to receive human input.
2. Apply authorized changes to the actual source.
3. Check the result.
4. Run `reply` with the returned receipt.
5. Run `wait` again to continue the session.

```sh
humagent wait SESSION_ID --consumer my-agent --timeout 50 --lease 600
humagent reply SESSION_ID --receipt RECEIPT_ID --message "Updated the plan. I did not execute it."
humagent wait SESSION_ID --consumer my-agent --timeout 50 --lease 600
```

The browser starts in **Interact** mode. **Annotate** captures an element or selected text. **Propose edit** sends an exact replacement without writing source files. Messages, annotations, edits, and form submissions use the same session.

The agent must read the current source before changing it. A source change causes a refresh notice, not an automatic page reset. Explicit refresh preserves form values with persistence enabled and the workspace draft. It does not preserve all application state.

### Delivery and completion

A lease reserves a batch for one agent. Its default duration is 120 seconds. `--lease 600` requests 600 seconds.

Use `humagent renew SESSION_ID --receipt RECEIPT_ID --lease 600` before the lease expires. `reply --receipt` records the reply and completes only that batch. `ack --receipt` completes the batch without a reply.

Identical retries do not create duplicate submissions or acknowledgments. An expired lease permits delivery again. Agents must use event IDs to prevent repeated external actions.

**Polling does not schedule an agent.** Keep `wait` attached to an active agent invocation. Background use requires a verified callback that resumes the same agent. Humagent cannot resume an ended agent turn. The interface shows when no agent waits for input.

To install the skill into the current project, run:

```sh
humagent setup --directory .agents/skills/humagent
```

## Generate an interactive interface

Use ordinary HTML forms. New intent names do not need backend handlers.

```html
<form id="plan" data-humagent-intent="revise_plan"
      data-humagent-message="Revise the plan. Do not execute it."
      data-humagent-persist>
  <label>Approach
    <select name="approach">
      <option>pilot-first</option>
      <option>platform-first</option>
    </select>
  </label>
  <textarea name="constraints"></textarea>
  <button type="submit">Revise the plan</button>
</form>
```

The bridge collects values when the user submits this marked form. An intent describes work for the agent. It is not a server function.

A stable form `id` and `data-humagent-persist` enable persistence. Do not enable persistence for sensitive fields.

Custom mini-apps can use the SDK:

```js
window.addEventListener('humagent:ready', async () => {
  const { humagent } = window;
  await humagent.setState({ selected: ['a', 'c'] });
  document.querySelector('#discuss').onclick = () => humagent.submit({
    intent: 'compare_choices',
    message: 'Compare these options. Do not take external actions.',
    values: { selected: humagent.getState().selected }
  });
});
```

Read the [SDK contract](docs/SDK.md) for field types and limits. Sliders, sorting, navigation, and calculations remain local. These actions do not automatically call a model.

## Attach to an existing application

Start the application with its existing command. Then open its local route:

```sh
humagent open http://127.0.0.1:3000/your-route
```

Humagent creates a proxy on a separate loopback origin. The proxy forwards paths, assets, HTTP requests, and WebSocket upgrades to one selected application. Humagent injects the bridge into HTML responses. It does not require changes to application source.

### Compatibility limits

Only HTTP targets on `localhost` or `127.0.0.1` are supported. Remote sites, HTTPS targets, cookie authentication, and transparent service-worker support are not supported.

The proxy does not forward `Cookie` or `Set-Cookie` headers. Existing frame protections or Content Security Policy (CSP) can block injection. Absolute URLs to the original server can bypass the proxy.

The HTTP and WebSocket tests do not establish compatibility with every framework. Test the intended application before relying on the proxy. Do not attach to a privileged internal service.

### Local files

File mode serves supported files inside the artifact directory. This includes JavaScript and JSON assets. Use a dedicated directory that contains no secrets.

Humagent rejects hidden paths, traversal, and symlinks that escape the artifact directory. Default file surfaces block external connections and assets. `--network` relaxes these restrictions for trusted HTML. Application mode does not isolate a malicious application from the network.

## Commands and local data

```text
humagent open TARGET [--no-open] [--network]
humagent wait SESSION [--consumer NAME] [--timeout SECONDS] [--lease SECONDS]
humagent reply SESSION --message TEXT [--receipt RECEIPT]
humagent ack SESSION --receipt RECEIPT
humagent renew SESSION --receipt RECEIPT [--lease SECONDS]
humagent status [SESSION]
humagent end SESSION
humagent server [--port PORT]
humagent stop
humagent setup [--directory DIRECTORY]
```

Session files use `~/.humagent` by default. `HUMAGENT_HOME` or `--home` selects another directory. Only one server can write to that directory.

The workspace uses port **4455** by default. `HUMAGENT_PORT` selects another port. Each interface uses a separate loopback port.

`open` starts or reuses the server. `stop` stops the server without deleting sessions. Ended sessions reject new input. Opening an ended target creates a new session.

Browser drafts remain in that browser's local storage. Server transcripts and persisted form values survive server restarts.

The CLI owns the control token. The browser receives a separate credential limited to its session. Neither credential enters the application frame. Read the [security guide](docs/SECURITY.md) before handling sensitive work.

## Develop and check

```sh
bun install --frozen-lockfile
bun run check
bunx --bun playwright-core install chromium
bun run test:browser
bun pm pack
bun run test:package
```

To use an existing Chromium executable, set `HUMAGENT_BROWSER_PATH`:

```sh
HUMAGENT_BROWSER_PATH=/path/to/chromium bun run test:browser
```

Bun runs TypeScript, the test runner, the browser driver, and the package checks. TypeScript uses Node-compatible API types for the `node:*` modules that Bun implements. Those type definitions do not require a Node.js process.

```text
humagent/
├── src/                  # Protocol, store, server, proxy, and CLI
├── web/                  # Workspace, SDK, and attributed helpers
├── examples/             # Plan, calculator, and ordinary page
├── test/                 # Core, HTTP, CLI, browser, and package checks
├── skills/humagent/      # Agent instructions
└── docs/                 # Specification, SDK, security, and evidence
```

## Scope and provenance

This is a selective extraction, not a complete Lavish fork. Lavish supplies adapted targeting helpers and the interaction pattern. Human Review supplies adapted quote anchors and exact-edit semantics. Humagent owns the typed store, delivery receipts, and proxy. Neither application is a runtime dependency.

[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) identifies copied code, source revisions, and original MIT notices.

Markdown, rich-text editing, automatic source patches, MCP Apps, schema renderers, React compilation, remote websites, and hosted collaboration remain outside v0.1. Later adapters must use the existing session contract.
