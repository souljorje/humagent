# Humagent specification

Status: implementation contract for v0.1.0. Date: 2026-11-02.

## 1. Product

Humagent is an independent, local-first interaction layer connecting a human and an existing agent through existing or newly generated visual interfaces. It is not an agent, an LLM service, a workflow engine, or a mandatory UI framework. Good Place OS is a dogfood consumer, not a dependency or a privileged integration.

An agent can open a document or mini-app, receive comments and structured choices, revise the underlying work, and reply without requiring a new backend handler for each task. The interface can be disposable; human input and accepted results must not be disposable by accident.

## 2. Primary scenarios

1. Existing interface: attach to a local HTML file or supported localhost app without rewriting its UI. Use the application normally, switch to annotation, and send contextual feedback.
2. Generated mini-app: create ordinary HTML/CSS/JavaScript, use local interactions without model calls, and submit task-specific values through a generic bridge.
3. Interactive planning: present choices and editable assumptions, preserve working values, submit an intent and data, then show the agent's revision and explanation.
4. Document review: select text or a block, comment, or propose an exact replacement. The agent applies changes to the actual source, never blindly serializes a running application's DOM.

## 3. Release boundary

### v0.1 required

- Installable CLI package, programmatic server entry point, portable agent skill, typed public contract, examples, automated checks, and attribution.
- Local HTML files with relative assets; generated HTML/JS mini-apps need no platform rebuild.
- Localhost HTTP apps through an explicitly selected, fixed-target reverse proxy on a separate origin. Preserve paths, asset requests and ordinary app interaction. Compatibility must be tested, not assumed for every framework.
- Existing apps may alternatively embed the SDK and connect through an explicit attachment manifest; implement this only if the browser security boundary remains intact. It is not a prerequisite for the first proxy path.
- Browser workspace with an isolated interface frame, conversation, review mode, exact-edit proposals, connection status, and an explicit refresh control.
- Declarative form bindings and a small JavaScript SDK. Submission payloads remain structured JSON rather than being appended to prompt prose.
- Durable session transcript, submissions, drafts, working state, event IDs, revisions, explicit acknowledgment, redelivery and conflict errors.
- CLI open/wait/reply/ack/status/end/server operations. No LLM key and no automatic execution of page-provided commands.
- Honest agent presence and a documented active-turn/background-wakeup limitation.

### Explicit follow-on capabilities

Markdown rendering, rich-text formatting, browser-extension attachment to arbitrary websites, authenticated remote browsing, multi-user hosting, MCP Apps presentation, MCP/AG-UI agent adapters, schema-based renderers, arbitrary React compilation, and image/diagram editing are follow-on work unless separately marked implemented in the release record. Native browser HTML/JS is the flexible first authoring path; existing applications retain their own build process.

Do not add a marketplace, universal workflow DSL, proprietary component catalog, provider-specific agent runner, publishing service, or business approval engine.

## 4. Architecture and ownership

```text
Existing agent
    <-> CLI adapter (wait / reply / acknowledge)
    <-> Durable session service
        <-> Browser workspace (conversation + review)
        <-> Interface bridge (structured submissions + state)
            <-> Existing local application OR generated HTML/JS
```

The service owns transport, session persistence, event validation, delivery receipts and interface identity. The browser workspace owns review drafts and explicit submission. The frame SDK owns target capture, local working-state integration and opt-in form bindings. The agent owns interpretation, source changes and tool permissions. The source application owns its rendering and domain state.

Use TypeScript for the Node service and CLI; ship browser-native JavaScript/CSS for the workspace and SDK. Node 22+ is the initial execution target. Keep external dependencies narrow; do not take Lavish or Human Review as runtime dependencies. Build only for release/development of Humagent, never because an agent produced a new HTML artifact.

## 5. Session and event contract

Every session has an opaque ID, canonical target, kind, title, opened/ended lifecycle, revision, persistent transcript, persistent working state with a state version, and pending/delivered/completed events. The server owns identity and timestamps. UI-controlled data cannot overwrite these fields.

Protocol version: `1`. Reject incompatible versions rather than guessing. A human input contains a client-generated ID for retry deduplication, event kind, the viewed revision, and a bounded JSON payload. The server attaches session ID and creation time.

Human kinds:

- `message`: freeform text.
- `annotation`: feedback plus an exact target description.
- `edit`: target, exact before/after strings, and optional explanation. This is a proposed replacement, not a saved-file claim.
- `submission`: intent, optional explanatory message, structured values, and optional target.

Example, illustrative of the contract:

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

Task-specific intent strings are data. `revise_plan` does not register a server function. The agent receives the payload with the surrounding task context and determines permitted work.

Target evidence can include a stable `data-humagent-id`, CSS selector, element tag, visible text, URL, and a quote with prefix/suffix. Coordinates and a temporary DOM ID are not authoritative source locations. Text matches that are ambiguous or stale must not silently select another target.

## 6. Durable delivery

Inputs are committed before the browser receives success. Retrying the same client ID with the same content returns the same event; conflicting reuse is rejected. Failed sends remain visible and retryable.

`wait` leases a batch to one consumer and returns a receipt. The batch remains durable until explicitly acknowledged with that receipt. Receipt acknowledgment applies only to its event IDs, never to newer submissions. A competing consumer receives a clear conflict while the lease is active. Expired leases become available again. Restarting the service does not delete unacknowledged work.

Delivery is at-least-once, not exactly-once execution. Agents must use event IDs to avoid repeating non-idempotent actions. Acknowledging receipt is not approval, publishing permission, or proof of correctness. Replies and completion are related explicitly through a receipt, not inferred merely from a file modification.

The browser distinguishes disconnected/idle, agent waiting, working, queued and completed. A waiting shell command can resume its calling agent only if the harness keeps the tool invocation active or implements a verified background completion callback. Never claim that a stopped agent will be awakened by HTTP polling.

## 7. Browser modes

### Interact (default)

Native links, controls and application handlers continue working. Local sorting, sliders, calculators and navigation do not invoke the agent automatically. The workspace does not set the entire page to contenteditable.

### Annotate

Selecting text captures its quote and surrounding context. Clicking a non-shell element captures stable identity where available and a selector/text fallback. A reviewer enters a comment in the workspace and sends it to the agent.

### Propose edit

A selection or element can be given an exact replacement. Keep original text and replacement separately; do not mutate or save application source. The agent re-reads source and reconciles newer changes before applying it. This release favors safe exact-text proposals over a general rich-text editor.

Mode controls and the conversation remain outside the frame, cannot be annotated as artifact content, and are keyboard accessible. Escape leaves selection mode. The workspace must remain usable at narrow widths and with long feedback.

## 8. Generated interaction SDK

Expose `window.humagent` when attached. Provide a ready promise, `submit`, `getState`, `setState` and a narrowly scoped event subscription for state/reply updates. Submission returns an acknowledgment or a visible error. Bound payload sizes, reject non-JSON values, and never execute an intent as code.

Support ordinary forms marked with `data-humagent-intent`. Named enabled controls become values. Preserve repeated field names as arrays; explicitly define checkbox and multi-select behavior. File/password controls are excluded. Submit only when the user explicitly submits the form. Use stable form IDs for durable values, opt out of persistence for sensitive data, and never collect unrelated page fields.

The browser shim and the server share the same envelope whether the surface was generated by an agent or existed before Humagent. A future json-render or MCP Apps adapter must reuse this contract.

## 9. State and revisions

Source revision and working-state version are separate. Reading or saving UI drafts must not change the source revision. State writes require the version read by the client; stale writes return 409 and preserve newer values. State is scoped to a session, not leaked across targets.

The runtime preserves opt-in form state and workspace drafts. It cannot preserve an arbitrary application's JavaScript heap. Refreshing an existing application may reset app-owned state; the UI and docs must say so. On source changes, show an update notice and offer refresh rather than automatically destroying an active prototype interaction or unfinished draft.

A stale event revision is rejected with a recoverable conflict. Do not relabel old feedback as applying to a new source. The human can refresh, verify the intended target, and resubmit. Comments remain associated with the version originally reviewed.

## 10. Target and source handling

File targets are canonicalized with realpath. Serve only files within the explicitly shared artifact directory, deny dotfiles and path traversal, and reject symlinks escaping that directory. State the directory-sharing boundary in CLI output. Sources are read-only to Humagent in v0.1.

URL targets must be explicit HTTP loopback addresses with fixed host/port. Reject credentials, remote hosts, redirects escaping the configured origin, and attempts to turn the proxy into an arbitrary URL fetcher. Do not follow links by opening new server targets implicitly. Provide an explicit re-open command for a different target.

The proxy is a trusted-development convenience, not a privacy sandbox for malicious apps. It must not expose Humagent's control API to the upstream application. Some sites and development frameworks may require same-origin cookies, CSP, service workers, or websocket settings that do not work transparently; report those limits and test supported behavior.

## 11. Security and privacy

- Bind all services to loopback by default. No automatic tailnet/LAN exposure.
- A random per-run control token authenticates every privileged endpoint. Store discovery credentials with owner-only filesystem permissions. Do not put the control token in a frame URL or generated document.
- Bootstrap the browser with a separate session capability. Privileges must be limited to that session; a frame must never open arbitrary local files or other sessions.
- Validate Host and Origin, reject cross-origin privileged requests, cap request bodies, and use explicit postMessage origin/source/channel checks.
- Separate workspace and surface origins. The surface gets only the SDK communication capability, not the control token. Use a sandboxed iframe. Untrusted HTML does not gain filesystem or shell access through Humagent.
- Serve the workspace with restrictive CSP and escaped text. Do not render transcript messages as unsanitized HTML.
- Network restrictions should have safe defaults. Trusted localhost application mode may explicitly enable the networking needed by the app; document the difference from offline generated artifacts.
- No telemetry, automatic cloud upload, or provider credentials in the core.
- Ended sessions reject new events. Deleting a session is explicit. All persistent files are local and may contain sensitive human input; document their location.

## 12. CLI and distribution

Expected commands:

```sh
humagent open ./plan.html
humagent open http://127.0.0.1:3000
humagent wait <session-id> --consumer my-agent
humagent reply <session-id> --receipt <receipt-id> --message "Updated the plan."
humagent ack <session-id> --receipt <receipt-id>
humagent status <session-id>
humagent end <session-id>
humagent server
```

Commands used by an agent emit machine-readable JSON on stdout and diagnostics on stderr. `open` may start/reuse a detached local service, but `wait` is attached to the agent invocation. An explicit timeout returns a typed timeout result. Browser launch failure still returns a usable local URL. No npm publication or external deployment is implied by committing the repository.

Ship a skill explaining the review loop, exact-edit semantics, source ownership, safe SDK generation, event acknowledgment, and harness wake-up limitations. Install only when explicitly requested; do not modify the user's global configuration automatically.

## 13. Reuse and provenance

Lavish AXI is the primary behavioral and browser-code donor: ordinary interaction versus annotation, target context, SDK messaging, conversation/wait/reply pattern. Human Review supplies quote-with-context anchoring and exact-edit/source-preservation behavior. Pin borrowed source revisions, retain MIT notices, identify modified functions and retain relevant regression tests. Neither upstream application is a runtime dependency.

Reimplement the small typed session core where preserving the upstream prompt-only or consume-on-read model would violate the durable event contract. This is not a claim to be a byte-for-byte fork or fully compatible replacement for either donor.

Sources inspected: `kunchenguid/lavish-axi` (notably `src/artifact-sdk.js`, CLI, session store and README); `petergyang/human-review` (`src/anchor-text.js`, SDK, CLI and skill). The implementation's THIRD-PARTY-NOTICES records exact revisions and copied/adapted pieces.

## 14. Acceptance and release evidence

The release must demonstrate:

- Generated planning form: values survive a workspace reload; submission reaches a waiting consumer as structured JSON.
- Generated mini-app: local interactions work without an agent; later submission needs no new runtime handler.
- Existing application: normal HTTP interaction and asset loading work through the supported attachment path; annotations and exact-edit proposals target it without changing its source.
- Agent round trip: wait, delivery receipt, reply, explicit completion, transcript update and source refresh.
- Persistence/recovery: restart, duplicate submission, interrupted wait, expired lease, competing consumer and stale acknowledgment.
- Revision/state conflict: a stale save or submission never overwrites or silently replaces newer work.
- Security: unauthorized API access, hostile origins/hosts, path traversal, escaped symlinks, remote proxy targets, excessive input and ended-session writes are refused.
- Packaging: build, unit/integration tests, CLI smoke checks, package dry run and actual browser checks.

Record exact commands and results in `docs/VERIFICATION.md`. Distinguish implemented and tested behavior from future design, and distinguish automated browser tests from a real Codex/Claude user session. Release notes must name untested operating systems and app frameworks. Do not describe the tool as a universal website editor or production-hardened security boundary before evidence supports it.
