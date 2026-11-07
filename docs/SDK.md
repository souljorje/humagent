# Forms and SDK

Humagent automatically attaches its SDK to local HTML and HTTP loopback apps. Comments and direct text edits need no integration code.
See the [usage guide](USAGE.md) for browser interactions and local previews.

## Declarative forms

```html
<form id="plan" data-humagent-intent="revise_plan" data-humagent-persist>
  <label>Approach <select name="approach">
    <option value="pilot">Pilot first</option>
    <option value="platform">Platform first</option>
  </select></label>
  <button type="submit">Add choices to review</button>
</form>
```

| Attribute | Purpose |
| --- | --- |
| `data-humagent-intent` | Stage named form values with this intent. |
| `data-humagent-message` | Add context as the decision's comment. |
| `data-humagent-persist` | Restore nonsensitive values for a form with a stable ID. |
| `data-humagent-id` | Identify a stable annotation target. |

Intents describe requests. They need no backend handlers and grant no permission to execute a plan.
Marked forms stage decisions and show **Added to review**. Unmarked forms retain their native behavior.
The human chooses **Send** to deliver staged feedback.

| Control | Value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group | Array of checked values |
| Radio group | Selected value or `null` |
| Multiple selection or repeated name | Array of values |
| Other controls | String, including numbers and ranges |

The SDK skips disabled controls and file, password, hidden, submit, reset, and button inputs. It rejects unsafe field names.
Value restoration emits a form input event for local interface updates.
An ordered state queue persists form values. Later changes do not change decisions already staged.
Failed saves remain pending. Browser reload warns while a form save remains unfinished.

## JavaScript

The single public method is `window.humagent.submit()`:

```js
const result = await window.humagent.submit({
  intent: 'revise_plan',
  values: { strategy: 'pilot-first' },
  message: 'Use these choices. Do not execute the plan.',
});
// { draftId: '...', status: 'draft' }
```

`intent` must be a nonempty string. `values` must be a JSON object. `message` is optional context, stored as the item's comment.
The method waits for bridge readiness. It resolves after the parent UI persists the draft in browser storage.
It does not confirm server delivery or agent receipt. Show errors so the human can recover.

## Advanced: batch protocol

Protocol v2 uses one envelope without event or item kind enums:

```json
{
  "protocol": 2,
  "clientId": "stable-batch-id",
  "revision": "source-revision",
  "payload": {
    "message": "Keep the change small.",
    "items": [
      { "id": "comment-1", "target": { "selector": "h1" }, "comment": "Make this shorter." },
      { "id": "edit-1", "target": { "selector": "#intro" }, "replacement": { "before": "Original", "after": "Proposed" } },
      { "id": "decision-1", "intent": "revise_plan", "values": { "strategy": "pilot-first" } }
    ]
  }
}
```

Each item requires a unique ID and actionable fields. These represent a target-bound comment, target-bound replacement, or intent with object values.
A message-only batch is valid. An empty batch is not.
Replacement strings retain exact whitespace. An empty `after` string proposes deletion.
Humagent renders local previews. The agent applies authoritative source changes.

### Validation and limits

| Field or constraint | Limit |
| --- | --- |
| JSON request, including its envelope | 256 KiB |
| Nesting depth | Below 24 levels, including the envelope |
| Items per batch | 100 |
| Client ID | 100 characters |
| Revision | 128 characters |
| Item ID | 150 characters |
| Intent | 200 characters |
| Comment or overall instruction | 4,000 characters each |
| Replacement `before` or `after` | 50,000 characters each |

Values must contain finite JSON data. Reserved keys `__proto__`, `constructor`, and `prototype` are invalid at every depth.
A replacement requires a target and nonempty original text. A target comment must contain non-whitespace text unless a replacement provides the action.
An explicit target revision must match the batch revision. Event and item `kind` fields are invalid. Item `type` fields are invalid.

### Target evidence

Captured targets contain the source URL, viewed revision, CSS selector, tag, and a normalized excerpt of up to 4,000 characters.
They also contain a stable ID when available. Selected text includes exact quote context.
Open shadow-root targets contain selector paths through their hosts.
`coordinates: { x, y, space: "document" }` records the original click in CSS pixels. Keyboard annotations use the target center.
Targets describe rendered content. They do not guarantee a unique source location.
Internal marker offsets remain in browser drafts. They do not enter submitted batches.

### Revisions

Source revisions hash served HTML with SHA-256. Other assets do not affect the hash.
HTTP revisions follow the attached page. Nested frames, fragment fetches, and status reads do not update the revision.
File changes also trigger revision checks.

Mixed or stale draft revisions block sending. Follow the [refresh and recovery steps](USAGE.md#refresh-and-recovery).
An overall instruction can be explicitly confirmed for the displayed revision. Existing target anchors never receive a new revision automatically.
Feedback follows a unique selector or stable ID through text changes and element replacement. Missing or ambiguous targets remain unavailable.

### Persistence and delivery

The parent UI owns persisted drafts and delivery state. The SDK owns targeting, markers, and temporary editors.
Sending persists one immutable local batch before contacting the server.
New batches require a listening or working agent. Accepted batches remain confirmable after disconnection or session ending.
Retries preserve the client ID and exact payload. Confirmation removes only submitted draft IDs and their unchanged overall instruction.
Previews remain until receipt-specific acknowledgment. Cleanup never overwrites subsequent application changes or serializes rendered DOM into source.

Staging identities remain persisted until the page confirms receipt of its staging result.
Unresolved identities survive lost responses, document changes, and reloads. They have a limit of 200 outstanding page requests per session.
At that limit, preserve the review and open a new session for additional feedback. Existing request retries remain valid.
Cleanup requires explicit page confirmation. It does not remove drafts or unconfirmed batches.

The server adds event IDs, timestamps, delivery status, and attempt counts. See [receipt commands](CLI.md#receive-input) and [security constraints](SECURITY.md).
