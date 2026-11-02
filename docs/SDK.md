# Forms and SDK

Humagent adds `window.humagent` to attached pages. Use a marked form to send named values:

```html
<form id="plan" data-humagent-intent="revise_plan" data-humagent-persist>
  <label>Approach <select name="approach">
    <option value="pilot">Pilot first</option>
    <option value="platform">Platform first</option>
  </select></label>
  <button type="submit">Revise plan</button>
</form>
```

`revise_plan` names a request for the agent. It needs no server handler and grants no permission to execute the plan.

Add `data-humagent-message` for context. Use a stable form ID and `data-humagent-persist` to save nonsensitive values across refresh.

Unmarked forms keep their normal behavior. Marked forms send values on submission.

| Control | Value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group | Array of checked values |
| Radio group | Selected value or `null` |
| Multiple selection or repeated name | Array of values |
| Other controls | String, including numbers and ranges |

The SDK collects named, enabled controls. It skips disabled fieldsets and file, password, hidden, submit, reset, and button inputs.
It rejects names that could change JavaScript prototypes.

## JavaScript

Wait for `humagent:ready`. If the SDK already exists, await `window.humagent.ready`.

| API | Effect |
| --- | --- |
| `ready` | Resolve after connection and form restoration. |
| `submit({intent, values, message?})` | Store a request. Return its event or an error. |
| `getState()` | Return a JSON copy of saved state. |
| `setState(patch)` | Merge top-level fields against the current state version. |
| `on('reply', handler)` | Receive replies while the page exists. Return an unsubscribe function. |

Show submission errors so users can retry. Success means Humagent stored the request, not that the agent completed it.

State writes run in sequence. Stale writes fail instead of replacing newer values. Reserve the `forms` key for saved form values.

Saving state does not change the application's database. Refresh can reset application memory. Replies stay in the workspace.

## Events

Protocol version is `1`. The SDK builds the envelope. The server adds identity, timestamps, status, and delivery count.

| Kind | Payload |
| --- | --- |
| `message` | `text` |
| `annotation` | `target`, `text` |
| `edit` | `target`, `before`, `after`, optional `explanation` |
| `submission` | `intent`, `values`, optional `message` |

An empty `edit.after` proposes deletion. Targets can include IDs, selectors, tags, text, URLs, and quote context. They describe rendered content, not guaranteed source lines.

Requests must contain JSON and stay within 256 KiB. Nesting must stay below 24 levels, including the envelope.

| Text | Maximum characters |
| --- | --- |
| Client ID / revision | 100 / 128 |
| Intent | 200 |
| Message / annotation | 4,000 |
| Each edit string | 50,000 |

See [delivery commands](CLI.md#receive-input) for receipts and retries.

## Revisions

Source revisions hash served HTML with SHA-256. Other assets do not affect the hash.

For HTTP apps, revisions change when Humagent serves HTML. Status reads and submissions do not fetch another page. Refresh the app to load new output.
File changes still trigger revision checks.

Stale input returns `STALE_REVISION`. Stale state writes return `STATE_CONFLICT`.

For stale input:

1. Refresh the page.
2. Check the target.
3. Discard the old pending submission.
4. Submit the checked request again.

Keep old feedback associated with its original revision. Failed sends retain drafts. Accepted events stay queued until acknowledgment.
