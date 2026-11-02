# Surface SDK and protocol v1

Humagent injects the SDK into supported interfaces. A file opened without Humagent remains an ordinary page. Wait for `humagent:ready` before calling the SDK.

## API

| API | Behavior |
| --- | --- |
| `window.humagent.ready` | This promise resolves after the parent connection and form restoration complete. |
| `submit({ intent, values, message? })` | This method sends a structured request. It resolves to the stored event. |
| `getState()` | This method returns a JSON copy of the frame's current working state. |
| `setState(patch)` | This method merges top-level fields and saves them against the current state version. |
| `on('reply', handler)` | This method subscribes to replies while the frame exists. It returns a function that removes the subscription. |

New intent names do not need server handlers. An intent is data for the agent, not executable code.

The SDK serializes state writes within each frame. A stale state version causes an error instead of overwriting another view's values. The `forms` key is reserved for persisted form values. Use a separate key for mini-app data.

`setState` does not change the application's domain database. A reload does not preserve the application's JavaScript heap. The workspace stores reply history independently of frame subscriptions.

## Forms

1. Add `data-humagent-intent` to the form.
2. Add `data-humagent-message` when the intent needs an explanation.
3. Assign a stable form `id` to enable durable field identity.
4. Add `data-humagent-persist` only when the values are suitable for storage.

The SDK collects named, enabled controls from the marked form. It does not collect unrelated forms. Interact mode does not intercept ordinary forms without this marker.

| Control | Submitted value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group | Array of checked values |
| Radio group | Selected value or `null` |
| Multiple-selection control | Array of selected values |
| Repeated ordinary field name | Array of values |
| Other included control | String, including number and range fields |

The SDK excludes file, password, hidden, submit, reset, and button inputs. It also excludes disabled fieldsets. It rejects property names that could affect JavaScript prototypes.

The agent interprets number strings and units. A local field change does not create an agent request. Only explicit submission sends the form values.

## Human event envelope

The server validates `protocol`, `clientId`, `kind`, `revision`, and `payload` before storage. It adds `id`, `createdAt`, `status`, and `deliveries`.

Payloads have a 256 KiB size limit and a 23-level depth limit. [src/protocol.ts](../src/protocol.ts) defines individual text limits.

| Kind | Required payload | Optional payload |
| --- | --- | --- |
| `message` | `text` | None |
| `annotation` | `target`, `text` | None |
| `edit` | `target`, `before`, `after` | Explanation |
| `submission` | `intent`, `values` | Message |

An empty `edit.after` proposes deletion. An edit does not write source files.

A target can include `data-humagent-id`, an element ID, a CSS selector, a tag, visible text, and a source URL. Selected text also includes its quote, prefix, and suffix. These fields help the agent locate source. They do not guarantee a source line or authorize execution.

## Delivery and completion

`wait` returns this batch structure:

```js
{status: 'feedback', session, target, receipt, leaseExpiresAt, events}
```

A lease reserves events for one consumer. Reading the batch does not delete its events. A receipt identifies the events that an acknowledgment completes.

`reply --receipt` records the reply and acknowledgment atomically. `reply` without a receipt does not complete work. `ack` completes work without a reply. `renew` extends an active lease.

Other wait results include `timeout`, `ended`, and `interrupted`. A competing listener or consumer receives an explicit error.

Delivery is at-least-once. The same event can arrive again after lease expiry. Check event IDs before repeating external actions.

Human input is not a shell command. A selected option is not domain approval unless the owning workflow defines it as approval.

## Revisions and updates

A source revision is the SHA-256 hash of the entry HTML response or file. It does not cover every asset or the full source tree. Dynamic timestamps and nonces can make strict revision comparison unsuitable for some routes.

The workspace offers refresh when the entry hash changes. The agent must still read current source before applying an edit.

Stale submissions return `STALE_REVISION`. Stale state writes return `STATE_CONFLICT`. Do not relabel old feedback with a new revision.

To recover from a stale submission:

1. Refresh the interface.
2. Check the intended target.
3. Discard the old pending envelope.
4. Submit the confirmed request again.

A failed send preserves the draft. A successful send stores the event even when no agent waits for input.

## Transport boundaries

The frame uses `postMessage`. The workspace checks its source, origin, and channel. The workspace sends its session credential in HTTP headers. It does not give that credential to the frame.

The CLI uses a separate control token. API requests contain JSON. Server-Sent Events (SSE) notify the workspace about changes through an authenticated fetch connection.

Bun runs the CLI and server. v0.1 does not include an MCP server or an MCP Apps adapter.
