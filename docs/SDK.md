# Surface SDK and protocol v1

Humagent injects the SDK when a supported interface is served. A standalone file without Humagent remains an ordinary page; SDK calls need feature detection or the `humagent:ready` event.

## API

- `window.humagent.ready`: promise resolved after the parent handshake and persisted form restoration.
- `submit({ intent, values, message? })`: explicit structured request; resolves to the stored event. New intent names need no server implementation.
- `getState()`: JSON copy of the last working-state snapshot known to this frame.
- `setState(patch)`: shallow top-level merge, serialized within the frame, saved with an optimistic state version. Rejects conflicts rather than overwriting another view.
- `on('reply', handler)`: receives replies while mounted; returns an unsubscribe function. Durable reply history remains in the workspace.

The `forms` top-level state key is reserved for opt-in form persistence. Other mini-app data should use its own namespaced key. `setState` does not update another application's domain database. No arbitrary JavaScript heap is preserved by a page reload.

## Forms

Add `data-humagent-intent` to a normal form. Optional `data-humagent-message` explains the intended outcome. Add a stable `id` and `data-humagent-persist` to save fields after input/change. No secret collection occurs from unrelated forms.

Named enabled controls only. A single checkbox yields a boolean; a checkbox group yields an array of checked values; a radio group yields a value or null; a multi-select yields an array; repeated ordinary names yield an array. Other controls yield strings, including number/range inputs: the agent can interpret units explicitly. File, password, hidden, submit, reset and button inputs are excluded. Disabled fieldsets are excluded. Prototype-sensitive property names are refused. Ordinary page interactions and forms without the marker are not intercepted in Interact mode.

## Human event envelope

`protocol`, `clientId`, `kind`, `revision` and `payload` are validated before persistence. The server adds `id`, `createdAt`, `status` and `deliveries`. Payloads are bounded to 256 KiB and 23 levels; individual text limits are defined in `src/protocol.ts`.

Kinds: `message` (`text`); `annotation` (`target`, `text`); `edit` (`target`, `before`, `after`, optional explanation); `submission` (`intent`, `values`, optional message). An empty edit `after` proposes deletion. Sources are never mutated by these events.

A target carries a stable `data-humagent-id`/element ID when present, CSS selector, tag, visible text and source URL. Selected text additionally carries quote/prefix/suffix. These are evidence for source matching, not permission to execute commands and not guaranteed source-code locations.

## Delivery and completion

`wait` returns `{status:'feedback', session, target, receipt, leaseExpiresAt, events}`. Events are leased, not deleted. Explicit acknowledgment completes only the receipt's IDs. `reply --receipt` stores a reply and acknowledgment atomically; `reply` without receipt posts a message without completing work. `renew` extends an active receipt. Other results include `timeout`, `ended`, and `interrupted`. Lease and listener conflicts are explicit errors.

At-least-once delivery requires the agent to avoid repeating external effects on retry. Human input is not a shell command. An intended choice or saved review is not domain approval unless the owning workflow explicitly says so.

## Revisions and updates

A revision is the SHA-256 of the current entry HTML response/file, not a hash of every referenced asset or the entire application source tree. Dynamic server-rendered timestamps/nonces may make a route unsuitable for strict revision comparison in this release. The workspace offers refresh when this hash changes. Proposed changes still require the agent to re-read actual source.

Stale submissions return `STALE_REVISION`; stale state writes return `STATE_CONFLICT`. Do not silently relabel old feedback. Refresh, verify its target, discard the outdated pending envelope, and submit the confirmed request again. Drafts are preserved on failed sends. Successful input is durably queued even when no agent is listening.

## Transport boundaries

The frame uses source/origin/channel-checked `postMessage`; the workspace supplies its session capability to HTTP calls. It never sends that capability to the frame. The CLI uses a separate control token. API messages are plain JSON, while fetch-based SSE notifies the workspace of changes. There is no MCP server or MCP Apps adapter in v0.1.
