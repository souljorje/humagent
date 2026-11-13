# Forms and SDK

Humagent injects its SDK into supported local HTML and HTTP localhost apps. Generic comments and text previews need no integration.

## Declarative forms

```html
<form id="plan" aria-label="Launch plan" data-humagent-intent="revise_plan">
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
| `data-humagent-intent` | Make the form one draft with named values |
| `data-humagent-message` | Add the item's comment |
| `data-humagent-id` | Identify annotation targets |

A marked form owns one draft. Each change saves it. Choices save at once. Typed text saves 300 milliseconds after typing stops. The submit button adds the form unchanged. The form shows **Added to review** while its draft exists. Marked forms do not send feedback. Unmarked forms behave normally.

Send delivers the values that the form shows. A reload refills the form from its draft. Deleting the draft in the bar resets the form to its HTML defaults. After a source revision change, the next form change replaces the stale draft.

The form `id` identifies its draft. Without an `id`, the intent identifies it. Give each marked form a stable `id` when several forms share an intent.

The bar shows readable text. The title comes from `aria-label` or `aria-labelledby`, otherwise from the intent. Each field shows its label or fieldset legend and the visible text of its answer. The agent receives only field names and values.

| Control | Value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group or repeated name | Array |
| Radio group | Selected value or `null` |
| Multiple selection | Array |
| Other named controls | String, including number and range inputs |

The SDK excludes disabled controls and file, password, hidden, submit, reset, and button inputs. It rejects unsafe field names.

Restoration and reset emit an input event for page scripts. A pending save can block browser reload.

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

`submit()` waits for the bridge and saves a draft on the server. It does **not** confirm delivery. The human chooses **Send**. Show submission errors so the human can retry.

## Event format

Each **Send** creates one event. `humagent wait` returns events in `events[]`:

```json
{
  "id": "event-id",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "revision": "source-revision",
  "message": "Keep changes small.",
  "items": [
    { "id": "comment-1", "target": { "selector": "h1" }, "comment": "Shorten this." },
    { "id": "edit-1", "target": { "selector": "#intro" }, "replacement": { "before": "Old", "after": "New" } },
    { "id": "choice-1", "intent": "revise_plan", "values": { "strategy": "pilot-first" } }
  ],
  "status": "delivered",
  "deliveries": 1
}
```

`message` is the optional overall instruction. `status` is `queued`, `delivered`, or `completed`. `deliveries` counts reservations.

Each item has a targeted comment, a targeted replacement, or an `intent` with `values`. A replacement needs nonempty `before` text. Empty `after` means deletion.

An event can contain only a message. An empty review is invalid. The server rejects unknown item fields. A target `revision` must match the current page.

### Validation limits

| Field | Limit |
| --- | --- |
| Request body | 256 KiB |
| JSON nesting | Fewer than 24 levels |
| Drafts per session | 100 |
| Events per session | 2,000 |
| Intent / comment / overall instruction | 200 / 4,000 / 4,000 characters |
| Each replacement string | 50,000 characters |
| Form key | 200 characters |
| Bar label text | 500 characters |

JSON values must be finite. The server rejects `__proto__`, `constructor`, and `prototype` keys at every depth.

### Targets

Targets include source URL, viewed revision, selector, tag, and up to 4,000 characters of normalized text. They include stable IDs and quote context when available.

`coordinates: { x, y, space: "document" }` records the click in CSS pixels. Keyboard annotations use the target center. The marker stays at the click point. Its position stays in the draft, not in the event.

Targets describe rendered content, not guaranteed source lines. Missing or ambiguous targets remain unavailable.

### Revisions

Source revisions hash served HTML with SHA-256, excluding other assets. An HTTP revision follows the attached document, not nested frames, fragments, or status reads. File changes also trigger revision checks.

Stale feedback cannot be silently rebound. See [refresh and recovery](USAGE.md#refresh-and-recovery).

### Delivery

The server owns drafts and delivery. The SDK owns targeting and temporary editors. It sends each request once.

New events require a listening or working agent. Stored events remain available after disconnection or session ending.

Sent local previews remain until receipt acknowledgment. Cleanup cannot overwrite application changes or save rendered DOM into source.

The workspace uses these routes with the session credential. Each write returns the current session.

| Route | Body |
| --- | --- |
| `GET /api/sessions/:id` | None |
| `POST /api/sessions/:id/drafts` | `{ item, revision, marker?, key?, labels? }`. A known `key` replaces that form's draft. |
| `PATCH /api/sessions/:id/drafts/:draftId` | `{ revision, comment, after?, marker? }` |
| `DELETE /api/sessions/:id/drafts/:draftId` | None |
| `PUT /api/sessions/:id/message` | `{ text }` |
| `POST /api/sessions/:id/send` | `{ revision }` |
| `POST /api/sessions/:id/surface` | `{ documentId }` |
| `POST /api/sessions/:id/end` | `{}` |

See [CLI receipts](CLI.md#receive-input) and [security constraints](SECURITY.md).
