# Forms and SDK

Humagent injects its SDK into supported local HTML and HTTP localhost apps. Generic comments and text previews need no integration.

## Declarative forms

```html
<form id="plan" data-humagent-intent="revise_plan" data-humagent-persist>
  <label>Approach
    <select name="approach">
      <option value="pilot">Pilot first</option>
      <option value="platform">Platform first</option>
    </select>
  </label>
  <button type="submit">Add choices to review</button>
</form>
```

| Attribute | Purpose |
| --- | --- |
| `data-humagent-intent` | Stage a request with named form values |
| `data-humagent-message` | Add the item's comment |
| `data-humagent-persist` | Restore nonsensitive values when the form has a stable ID |
| `data-humagent-id` | Identify annotation targets |

Marked forms stage decisions and show **Added to review**. They do not send feedback. Unmarked forms behave normally.

| Control | Value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group or repeated name | Array |
| Radio group | Selected value or `null` |
| Multiple selection | Array |
| Other named controls | String, including number and range inputs |

The SDK excludes disabled controls and file, password, hidden, submit, reset, and button inputs. It rejects unsafe field names.

Opted-in values persist independently of staged decisions. Restoration emits an input event. Later form changes never alter staged decisions. A pending save can block browser reload.

## JavaScript

The only public method is `window.humagent.submit()`:

```js
const result = await window.humagent.submit({
  intent: 'revise_plan',
  values: { strategy: 'pilot-first' },
  message: 'Revise the plan. Do not execute it.',
});
// { draftId: '...', status: 'draft' }
```

`intent` is a nonempty request name, not a handler or permission. `values` must be a JSON object. `message` is an optional item comment.

`submit()` waits for the bridge and persists a draft. It does **not** confirm delivery. The human chooses **Send**. Show submission errors so the human can retry.

## Advanced: batch contract

Each **Send** produces one protocol-v2 event, with an optional overall instruction and ordered items:

```json
{
  "protocol": 2,
  "clientId": "stable-batch-id",
  "revision": "source-revision",
  "payload": {
    "message": "Keep changes small.",
    "items": [
      { "id": "comment-1", "target": { "selector": "h1" }, "comment": "Shorten this." },
      { "id": "edit-1", "target": { "selector": "#intro" }, "replacement": { "before": "Old", "after": "New" } },
      { "id": "choice-1", "intent": "revise_plan", "values": { "strategy": "pilot-first" } }
    ]
  }
}
```

Each item needs a unique ID and an actionable comment, replacement, or decision. A replacement needs a target and nonempty original text. Empty `after` means deletion.

A message-only batch is valid. An empty review is invalid. Event and item `kind` fields and item `type` are unsupported.

### Validation limits

| Field | Limit |
| --- | --- |
| Request including envelope | 256 KiB |
| JSON nesting | Fewer than 24 levels |
| Items per batch | 100 |
| Client ID / revision / item ID | 100 / 128 / 150 characters |
| Intent / comment / overall instruction | 200 / 4,000 / 4,000 characters |
| Each replacement string | 50,000 characters |

Use finite JSON values and reject `__proto__`, `constructor`, and `prototype` keys at every depth. Explicit target revisions must match the batch.

### Targets

Targets include source URL, viewed revision, selector, tag, and up to 4,000 characters of normalized text. They include stable IDs and quote context when available. Open shadow-root targets include selector paths.

`coordinates: { x, y, space: "document" }` records the click in CSS pixels. Keyboard annotations use the target center. Marker offsets remain in browser drafts.

Targets describe rendered content, not guaranteed source lines. Missing or ambiguous targets remain unavailable.

### Revisions

Source revisions hash served HTML with SHA-256, excluding other assets. An HTTP revision follows the attached document, not nested frames, fragments, or status reads. File changes also trigger revision checks.

Stale feedback cannot be silently rebound. See [refresh and recovery](USAGE.md#refresh-and-recovery).

### Delivery and recovery

The workspace owns drafts and delivery. The SDK owns targeting and temporary editors.

Before sending, the browser persists an immutable batch. Retries reuse its ID and payload. Only matching confirmation removes captured drafts and unchanged instructions. New batches require a listening or working agent. Accepted batches remain confirmable after disconnection or session ending.

The SDK retains staging request identities until confirmation, including across reload. At most 200 unresolved requests are retained per session. Page confirmation clears identities without removing drafts.

Confirmed local previews remain until matching receipt acknowledgment. Cleanup cannot overwrite application changes or save rendered DOM into source.

See [CLI receipts](CLI.md#receive-input) and [security constraints](SECURITY.md).
