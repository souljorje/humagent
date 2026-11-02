# Humagent

A local visual collaboration layer for humans and existing agents. Open an existing interface or generate a disposable HTML mini-app, work together in the browser, and send contextual input back to the same agent.

**Preview release.** No model, API key, cloud service, telemetry, mandatory component framework, or Good Place OS dependency. See [the detailed specification](docs/SPEC.md) and [verification and limits](docs/VERIFICATION.md).

## Run from source

Node.js 22 or later:

```sh
git clone --branch feat/initial-runtime https://github.com/souljorje/humagent.git
cd humagent
npm install
node dist/cli.js open examples/plan.html
```

`npm install` runs the TypeScript build. Once built, the runtime has no external package dependencies. Alternatively, `npm link` exposes `humagent` locally. This repository has **not** been published to npm; do not assume `npx humagent` installs this code.

Try `examples/calculator.html` for a disposable mini-app, or `examples/existing.html` for a page with no Humagent bindings. New HTML interfaces do not rebuild Humagent.

## Human and agent loop

The open command returns a session ID and a browser URL. Give that session ID to your existing coding agent:

```sh
humagent wait SESSION_ID --consumer my-agent --timeout 50
# Apply requested changes to the real source, then:
humagent reply SESSION_ID --receipt RECEIPT_ID --message "Updated the plan. Nothing was executed."
# Continue collaborating:
humagent wait SESSION_ID --consumer my-agent --timeout 50
```

The browser starts in **Interact** mode. **Annotate** captures an element or selected words. **Propose edit** sends an exact before/after replacement without writing the source. Chat, annotations, edits and generated form submissions share one durable session.

The agent should re-read source before modifying it. Source changes show a refresh notice instead of resetting an active mini-app. Refresh preserves opted-in form state and browser composer drafts; arbitrary application state is not automatically preserved.

A batch is leased for 120 seconds by default, not consumed when read. Use `--lease 600` for a longer job, or `humagent renew SESSION_ID --receipt RECEIPT_ID --lease 600`. `reply --receipt` atomically records the reply and completes only that batch. `ack` completes without a reply. Repeated identical submissions and acknowledgments are idempotent. Expired leases can be redelivered: deduplicate consequential work by event ID.

**Polling is not an agent scheduler.** Keep `wait` attached to an active tool invocation, or use a harness with a verified completion callback. An ended agent turn cannot be awakened by this tool. The UI tells the human when nobody is listening.

Install the portable skill into a project only when desired:

```sh
humagent setup --directory .agents/skills/humagent
```

## Generate interactive surfaces without new handlers

Ordinary HTML forms are enough:

```html
<form id="plan" data-humagent-intent="revise_plan"
      data-humagent-message="Revise only; do not execute." data-humagent-persist>
  <label>Approach
    <select name="approach"><option>pilot-first</option><option>platform-first</option></select>
  </label>
  <textarea name="constraints"></textarea>
  <button type="submit">Revise the plan</button>
</form>
```

The bridge collects structured values only when this marked form is submitted. Intent names are data for the agent, not registered backend functions. A stable form `id` plus `data-humagent-persist` opts in to saving values. Do not opt sensitive forms into persistence.

For custom mini-apps:

```js
window.addEventListener('humagent:ready', async () => {
  const { humagent } = window;
  await humagent.setState({ selected: ['a', 'c'] });
  // Call this in your explicit user action, not automatically on every update:
  document.querySelector('#discuss').onclick = () => humagent.submit({
    intent: 'compare_choices',
    message: 'Compare these options; do not take external actions.',
    values: { selected: humagent.getState().selected }
  });
});
```

See [the SDK contract](docs/SDK.md). Sliders, sorting, navigation and calculations remain local. Application actions do not automatically call the model.

## Existing localhost applications

Start your application normally, then:

```sh
humagent open http://127.0.0.1:3000/your-route
```

Humagent creates a fixed-target reverse proxy on a separate loopback origin. Paths, local assets, HTTP APIs and WebSocket upgrades are forwarded; the bridge is injected into HTML. No app-source modification or mandatory UI framework is required.

**Compatibility limits:** only HTTP `localhost`/`127.0.0.1` targets; no remote sites, HTTPS local apps, cookie authentication, or transparent service-worker support. Cookies and Set-Cookie are intentionally not forwarded. Existing CSP or frame protections may block injection. Absolute URLs to the original dev server can bypass the proxy. HTTP/WebSocket smoke tests are not proof that every Vite/Next/Svelte app works. Test your app before relying on it. Never point the proxy at a privileged internal service.

HTML file mode shares supported files within the artifact's directory, including local JavaScript and JSON; use a dedicated artifact directory, not your home folder or a secrets folder. Dotfiles, escaped symlinks and traversal are refused. Default file surfaces block outbound connections and external assets; `--network` explicitly relaxes this for trusted HTML. Local app mode is a trusted-development convenience, not a network isolation sandbox.

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

Data lives in `~/.humagent` or `HUMAGENT_HOME` / `--home`. Default workspace port: **4455** (`HUMAGENT_PORT` for an alternate). Each interface has its own loopback port. `open` starts/reuses the local server. `stop` shuts it down without deleting sessions. Ended sessions reject new input; opening the same target again creates a new session. Browser drafts stay in that browser's local storage. Server transcripts and opted-in form state survive restarts. Only one server may write a state directory.

The control token is private to the CLI; a browser capability can operate only its session. Neither is injected into the application frame. See [security boundaries](docs/SECURITY.md).

## Develop and verify

```sh
npm run check
npx playwright-core install chromium
npm run test:browser
# Or use an installed browser:
HUMAGENT_BROWSER_PATH=/path/to/chromium npm run test:browser
npm pack --dry-run
```

```text
humagent/
├── src/                  # Typed protocol, durable store, service, proxy and CLI
├── web/                  # Workspace, browser SDK and attributed donor helpers
├── examples/             # Plan, calculator and unmodified existing page
├── test/                 # Core, HTTP and real-browser checks
├── skills/humagent/      # Portable agent instructions
└── docs/                 # Specification, SDK, security and release evidence
```

## Scope and provenance

This is a selective extraction, **not a full fork**: Lavish supplies adapted selector/interactive-control helpers and the conversation/SDK/wait architecture; Human Review supplies adapted quote anchoring and exact-edit semantics. The typed event store, receipts and security-separated proxy are new to meet this specification. Neither application is installed as a dependency. Exact source identities and original MIT notices are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Markdown, rich-text editing, automatic source patches, MCP Apps, schema renderers, arbitrary React builds, external websites and hosted collaboration are not implemented in v0.1. They must reuse the core session contract rather than create parallel queues or workflow-specific handlers.
