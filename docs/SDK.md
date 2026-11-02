# SDK and protocol v1

Humagent injects `window.humagent` into supported pages. Wait for `humagent:ready` or the SDK's `ready` promise before use.

## API

| API | Effect |
| --- | --- |
| `window.humagent.ready` | Resolve after connection and form restoration. |
| `submit({ intent, values, message? })` | Send a structured request. Resolve to the stored event. |
| `getState()` | Return a JSON copy of the frame's working state. |
| `setState(patch)` | Merge top-level fields and save against the current state version. |
| `on('reply', handler)` | Subscribe while the frame exists. Return an unsubscribe function. |

Intents describe requests to the agent. They need no server handlers and never execute as code.

State writes run in sequence within each frame. A stale version returns an error instead of replacing another view's values.

The `forms` key stores persisted form values. Use another key for mini-app data. `setState` does not update the application's database.

Refresh can reset application memory. Reply history remains in the workspace, independent of frame subscriptions.

## Forms

1. Mark the form with `data-humagent-intent`.
2. Add `data-humagent-message` when the request needs context.
3. Assign a stable form `id`.
4. Add `data-humagent-persist` only for values suitable for storage.

Only explicit submission sends an agent request. Unmarked forms keep their normal behavior.

| Control | Submitted value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group | Array of checked values |
| Radio group | Selected value or `null` |
| Multiple selection | Array of selected values |
| Repeated field name | Array of values |
| Other included controls | String, including number and range inputs |

The SDK collects named, enabled controls. It excludes disabled fieldsets and file, password, hidden, submit, reset, and button inputs.

It rejects names that could modify JavaScript prototypes. The agent interprets number strings and units.

## Events

The server validates `protocol`, `clientId`, `kind`, `revision`, and `payload`. It adds `id`, `createdAt`, `status`, and `deliveries`.

Payload limits: 256 KiB and 23 levels of depth. The [protocol source](https://github.com/souljorje/humagent/blob/feat/initial-runtime/src/protocol.ts) defines text limits.

| Kind | Required payload | Optional payload |
| --- | --- | --- |
| `message` | `text` | None |
| `annotation` | `target`, `text` | None |
| `edit` | `target`, `before`, `after` | Explanation |
| `submission` | `intent`, `values` | Message |

An empty `edit.after` proposes deletion. Edits do not write source files.

Targets can contain a stable `data-humagent-id`, element ID, selector, tag, visible text, and source URL.
Selected text also carries its quote, prefix, and suffix. These describe rendered content, not guaranteed source lines or execution permission.

## Delivery

`wait` returns:

```js
{status: 'feedback', session, target, receipt, leaseExpiresAt, events}
```

A lease reserves events for one consumer. A receipt identifies the batch to complete. Reading does not delete events.

| Operation | Effect |
| --- | --- |
| `reply --receipt` | Store the reply and acknowledgment atomically. |
| `reply` without a receipt | Store a reply without completing work. |
| `ack` | Complete the batch without a reply. |
| `renew` | Extend the active lease. |

Other results are `timeout`, `ended`, and `interrupted`. Competing listeners or consumers receive an error.

Delivery is at-least-once. Check event IDs before repeating external actions after lease expiry.

Human input is not a shell command. A choice grants approval only when the owning workflow explicitly defines it that way.

## Revisions

A source revision hashes the entry HTML file or response with SHA-256. It does not cover all assets or source files.

Dynamic timestamps or nonces can make strict comparison unsuitable for some routes. Always read current source before applying an edit.

A changed entry hash triggers a refresh notice. Stale submissions return `STALE_REVISION`. Stale state writes return `STATE_CONFLICT`.

For a stale submission:

1. Refresh the page.
2. Check the target.
3. Discard the old pending submission.
4. Submit the confirmed request again.

Do not assign a new revision to old feedback. Failed sends retain drafts. Accepted events remain queued even without a waiting agent.

## Transport

The frame uses `postMessage`. The workspace checks the message's source, origin, and channel.

The workspace sends its session credential in HTTP headers, never to the frame. The CLI uses a separate control token.

HTTP API requests use JSON. Server-Sent Events notify the workspace through an authenticated fetch connection.

Node.js or Bun runs the CLI and server. v0.1 has no MCP server or MCP Apps adapter.
