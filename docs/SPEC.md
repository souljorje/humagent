# Humagent specification

Status: implementation contract for v0.1.0. Updated: 2026-11-02.

Bun runs development tools and builds. The distributed CLI supports Node.js and Bun. Users install compiled files without a build step.

## 1. Product

Humagent connects a human and an existing agent through a local visual interface. That interface can already exist or an agent can generate it.

Humagent is not an agent, model service, workflow engine, or mandatory UI framework.

An agent can open an interface, receive input, revise source, and reply. Each task uses the same interaction contract. A new task must not require a new backend handler.

An interface can be temporary. Human input and accepted results must not disappear without an explicit action.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Surface | The existing or generated interface shown to the human. |
| Workspace | Humagent's outer browser interface, including conversation and review controls. |
| Session | The persistent association between a surface, human input, and an agent. |
| Source revision | The hash of the current entry HTML file or response. |
| Working state | Values that a surface explicitly saves through Humagent. |
| Event | A stored message, annotation, exact-edit proposal, or structured submission. |
| Lease | A temporary reservation of events for one consumer. |
| Receipt | The identifier used to acknowledge the events in a delivered batch. |
| Intent | A task-specific name that describes a request to the agent. It is not executable code. |

## 3. Primary scenarios

### Existing interface

Attach to a local HTML file or supported HTTP localhost application. Preserve ordinary application behavior. Allow the human to annotate the interface and send contextual feedback.

### Generated mini-app

Run ordinary HTML, CSS, and JavaScript. Keep local interactions independent of model calls. Send task-specific values through the shared bridge.

### Interactive planning

Present choices and editable assumptions. Preserve values when the surface enables persistence. Submit the values and intent to the agent. Show the agent's revision and explanation.

### Document review

Capture selected text or an element. Accept a comment or exact replacement. The agent applies permitted changes to the actual source. Humagent must not serialize a running application's DOM into source files.

## 4. Release boundary

### Required in v0.1

- Provide an installable CLI package and programmatic server entry point.
- Include a portable skill, typed protocol, examples, tests, and donor attribution.
- Serve local HTML with supported relative assets.
- Run generated HTML/JS without rebuilding Humagent.
- Attach to a selected HTTP localhost application through an isolated proxy.
- Preserve paths, assets, HTTP requests, and WebSocket upgrades where the supported proxy permits them.
- Provide conversation, annotation, exact-edit proposals, connection status, and explicit refresh.
- Support declarative forms and a small JavaScript SDK.
- Preserve submission values as JSON instead of appending them to prompt text.
- Persist transcripts, events, working state, revisions, and acknowledgments.
- Preserve browser drafts and failed submissions.
- Provide CLI commands for opening, waiting, replies, acknowledgments, renewal, status, ending, server control, and skill installation.
- Explain the limits of resuming an agent after its active turn ends.

Framework compatibility requires tests. Successful HTTP forwarding does not establish compatibility with every development framework.

An existing application could later embed the SDK through an attachment manifest. This path requires a separate browser-security check. It is not required for the initial proxy implementation.

### Later work

Markdown rendering, rich-text formatting, remote website attachment, authenticated browsing, and multi-user hosting remain outside v0.1.

MCP Apps, MCP/AG-UI agent adapters, schema renderers, React compilation, and image or diagram editing also remain outside v0.1. A release record must identify any later implementation explicitly.

HTML/JS is the initial authoring path. Existing applications retain their own build process.

Do not add a marketplace, universal workflow language, proprietary catalog, provider-specific agent runner, publishing service, or business approval engine.

## 5. Architecture and ownership

```text
Existing agent
    <-> CLI adapter: wait, reply, acknowledge
    <-> Persistent session service
        <-> Browser workspace: conversation and review
        <-> Surface bridge: submissions and working state
            <-> Existing application or generated HTML/JS
```

The service owns transport, validation, identity, storage, and delivery receipts. The workspace owns review drafts and explicit submission. The frame SDK captures targets and manages optional form bindings.

The agent interprets requests and changes source under its existing permissions. The source application owns rendering and domain state.

Use TypeScript for the server and CLI. Use browser-native JavaScript and CSS for the workspace and SDK. Bun 1.4.4 is the development runtime. Published JavaScript also supports Node.js 22 and later.

Bun runs dependency installation, compilation, type checking, tests, browser checks, and packaging. Retain `bun.lock` as the dependency lockfile. Use frozen installation in CI.

The implementation can retain Bun-compatible `node:*` APIs. Both supported runtimes implement these imports. Run TypeScript with Bun explicitly so its Node shebang cannot select another runtime.

Do not depend on another review application at runtime. Build Humagent when its own source changes, not when an agent creates an HTML artifact.

## 6. Session and event contract

Each session has an opaque ID, canonical target, kind, title, lifecycle, source revision, transcript, working state, and event history. Working state has a separate version. Events can be queued, delivered, or completed.

The server assigns identity and timestamps. Page-controlled data cannot replace those fields.

Protocol version is `1`. Reject incompatible versions. Human input includes a client ID, event kind, viewed revision, and bounded JSON payload. The client ID identifies retries.

| Kind | Meaning |
| --- | --- |
| `message` | Freeform text for the agent. |
| `annotation` | Feedback with a target description. |
| `edit` | A target and exact before/after strings, with an optional explanation. |
| `submission` | An intent, structured values, an optional message, and optional target evidence. |

An edit proposes a replacement. It does not claim that Humagent saved the source.

Example envelope:

```json
{
  "protocol": 1,
  "clientId": "browser-generated-uuid",
  "kind": "submission",
  "revision": "source-content-hash",
  "payload": {
    "intent": "revise_plan",
    "message": "Use these choices to revise the plan. Do not execute it.",
    "values": {"approach": "pilot-first", "defer": ["automation"]}
  }
}
```

The agent interprets an intent using the task context. `revise_plan` does not register a server function or grant permission to execute the plan.

Targets can include a stable ID, CSS selector, element tag, visible text, URL, and quote context. Temporary DOM IDs and coordinates are not authoritative source locations. Do not silently resolve an ambiguous or stale match to another target.

## 7. Durable delivery

Persist input before reporting success to the browser. The same client ID and content must return the same event. Reject the same client ID with different content. Keep failed sends visible and available for retry.

`wait` leases a batch to one consumer and returns a receipt. The batch remains stored until acknowledgment. Acknowledgment completes only that receipt's events, not newer submissions.

Reject a competing consumer while the lease remains active. Permit delivery again after lease expiry. Retain unacknowledged events through a server restart.

Delivery is at-least-once. It is not exactly-once execution. Agents must detect repeated event IDs before repeating consequential actions.

An acknowledgment is not approval, publication permission, or proof of correctness. A receipt explicitly connects completion to delivered work. A source-file change alone does not establish completion.

Show whether the agent is idle, waiting, or working. Show whether input is queued or complete. Distinguish a disconnected browser from a connected session.

A wait can resume its caller only while the agent invocation remains active or the harness provides a verified completion callback. Do not claim that polling resumes an ended task.

## 8. Browser modes

### Interact

Interact is the default mode. Preserve native links, controls, and application handlers. Do not automatically call the agent for sorting, sliders, calculators, or navigation. Do not make the entire page editable.

### Annotate

Capture the selected quote and surrounding text. For element selection, capture stable identity when available. Include selector and text evidence as fallbacks. Send the human's comment through the shared session.

### Propose edit

Keep the original text and exact replacement separately. Do not write the source. The agent must read current source and reconcile newer changes before applying the proposal.

Keep mode controls and conversation outside the surface frame. Do not treat workspace controls as artifact content. Provide keyboard access. Escape must leave selection mode.

The workspace must remain usable at narrow widths and with long feedback.

## 9. Surface SDK

Expose `window.humagent` after attachment. Provide a ready promise, `submit`, `getState`, `setState`, and scoped notifications. The SDK guide defines available subscriptions.

A submission must return a stored event or an explicit error. Limit payload size and depth. Reject non-JSON values. Never execute an intent as code.

Mark forms with `data-humagent-intent`. Collect only named, enabled controls. Preserve repeated field names as arrays. Define checkbox, radio, and multiple-selection values explicitly.

Exclude file and password controls. Submit only after an explicit request. Use stable form IDs for persistence. Do not persist sensitive fields or collect unrelated page fields.

Existing and generated surfaces use the same envelope. Future renderers and MCP Apps adapters must reuse this contract.

## 10. State and revisions

Keep source revisions separate from working-state versions. Saving a draft must not change the source revision.

Require the version that the client read for each state write. Reject stale writes with HTTP 409. Preserve newer values. Do not share state between unrelated sessions.

Preserve form state only when persistence is enabled. Preserve workspace drafts. Do not claim to preserve an arbitrary application's JavaScript heap.

Refresh can reset application-owned state. State this limit in the interface and documentation. Show a notice when source changes. Do not automatically replace an active interface or unfinished draft.

Reject stale submissions with a recoverable conflict. Keep comments associated with the reviewed version. Do not relabel old feedback as current input.

The human can refresh, check the target, and submit a new request. Each step must remain explicit.

## 11. Targets and source files

Resolve file targets through canonical paths. Serve only supported files inside the selected artifact directory. Reject hidden paths, traversal, and symlinks that escape the directory.

State the shared directory in CLI output. Keep sources read-only to Humagent in v0.1.

URL targets must use explicit HTTP loopback addresses with a fixed host and port. Reject URL credentials and remote hosts. Reject redirects outside the selected origin.

Do not accept arbitrary proxy destinations from page requests. Do not create a new server target merely because the human follows a link. Require an explicit open operation for another target.

The application proxy is for trusted development work. It does not provide privacy or network isolation for malicious applications. Never expose the control API to the source application.

Cookies, CSP, service workers, and WebSocket settings can prevent compatibility. Document these limits. Test the intended application.

## 12. Security and privacy

- Bind services to loopback. Do not automatically expose them to a LAN or tailnet.
- Use a random control token for privileged endpoints.
- Store credentials with owner-only permissions where the platform supports them.
- Keep control tokens outside frame URLs and generated documents.
- Give the browser a separate credential limited to its session.
- Validate Host and Origin headers.
- Reject cross-origin privileged requests.
- Limit request bodies.
- Check each frame message's source, origin, and channel.
- Use separate origins for the workspace and surface.
- Give the surface only its SDK connection.
- Use a sandboxed iframe.
- Do not expose shell or filesystem operations to page scripts.
- Apply a restrictive workspace CSP.
- Render transcript text without executing HTML.
- Block external access by default for file surfaces.
- Explain the different network behavior of trusted application mode.
- Do not add telemetry, automatic uploads, or provider credentials to the core.
- Reject new input after the session ends.

Persistent files remain local and can contain sensitive input. Document their location. Delete session data only through an explicit operation.

## 13. CLI and distribution

```sh
humagent open ./plan.html
humagent open http://127.0.0.1:3000
humagent wait SESSION --consumer my-agent
humagent reply SESSION --receipt RECEIPT --message "Updated the plan."
humagent ack SESSION --receipt RECEIPT
humagent renew SESSION --receipt RECEIPT --lease 600
humagent status SESSION
humagent end SESSION
humagent server
humagent stop
humagent setup
```

Agent commands return JSON on stdout and diagnostics on stderr. Use `--json` to request machine-readable output explicitly.

Interactive open commands show the URL and next command. CLI help returns readable text. `open` can start a detached server. `wait` stays attached to the agent invocation.

A timeout returns a typed result. Failed browser launch must still return the local URL.

Use these development commands:

```sh
bun install --frozen-lockfile
bun run check
bunx --bun playwright-core install chromium
bun run test:browser
bun pm pack
bun run test:package
```

The executable uses a Node shebang for npm and npx. Bun users can select Bun with `bunx --bun`.

Child servers use the same runtime executable as the CLI. Package checks must run without installed development dependencies.

Compile before packaging. Do not add install-time build scripts. Ship all browser assets, examples, documentation, and the agent skill.

Ship a skill that explains review, exact edits, source ownership, submissions, acknowledgments, and agent-resumption limits. Install it only when requested. Do not automatically change global agent settings.

A repository commit does not authorize publication, deployment, or merging.

## 14. Attribution

Keep upstream project names, author names, and source revisions only in the root README.

The [README notices](../README.md#third-party-notices) retain the full copyright and license text for each adapted helper. Include the README in every package. Use links to these notices elsewhere.

Check source files and package contents for names outside the README. These helpers do not introduce runtime package dependencies.

## 15. Acceptance and evidence

| Scenario | Required evidence |
| --- | --- |
| Planning form | Values survive refresh. Explicit submission reaches a waiting agent as JSON. |
| Generated mini-app | Local behavior works without model calls. Submission requires no new runtime handler. |
| Existing application | Normal requests and assets work through the supported proxy. Review does not mutate source. |
| Agent exchange | Wait, receipt, reply, acknowledgment, transcript update, and refresh work together. |
| Recovery | Tests cover restart, retries, interrupted waits, lease expiry, competing consumers, and stale receipts. |
| Conflicts | Stale source revisions and state versions cannot silently replace newer work. |
| Security | Tests reject unauthorized access, hostile headers, unsafe paths, remote targets, excessive input, and ended-session writes. |
| Runtime execution | Tests check Bun development and packaged execution on Node.js and Bun. |
| Packaging | Frozen install, build, typecheck, tests, browser checks, and package creation succeed. |

Record commands and results in [VERIFICATION.md](VERIFICATION.md). Distinguish requirements from implemented behavior. Distinguish automated browser tests from real user sessions in an agent harness.

Name untested operating systems and frameworks. Do not claim universal website compatibility or production security without supporting evidence.

## 16. Release usability

Include `demo`, `doctor`, `--version`, and actionable errors. Reject invalid commands before starting a server.

Skill installation must preserve modified instructions unless the user requests replacement. Demos must not overwrite user changes.

Test installation from the exact archive through npm and command runners. Publication requires explicit maintainer authorization.
