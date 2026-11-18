# Forms and SDK

Humagent injects its SDK into supported local HTML and HTTP localhost apps. Generic comments and text previews need no integration.

## Declarative forms

```html
<form
  aria-label="Launch plan"
  data-humagent-id="plan"
  data-humagent-comment="Revise the plan. Do not execute it."
>
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
| `data-humagent-id` | On a form, make the form one draft with named values. On other elements, identify annotation targets. |
| `data-humagent-comment` | Add the form item's comment |

A marked form owns one draft. Each change saves it. Choices save at once. Typed text saves 300 milliseconds after typing stops. The submit button adds the form unchanged. Marked forms do not send feedback. Unmarked forms behave normally.

Send delivers the values that the form shows. A reload refills the form from its draft. Deleting the draft in the bar resets the form to its HTML defaults. After a source revision change, the next form change replaces the stale draft.

The `data-humagent-id` value is the draft key. Give each marked form a stable and unique value. The form item has no target and no marker on the page.

The bar shows readable text. The title comes from `aria-label` or `aria-labelledby`, otherwise from `data-humagent-id`. Each field shows its label or fieldset legend and the visible text of its answer. The agent receives only field names and values.

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
  form: { strategy: 'pilot-first' },
  comment: 'Revise the plan. Do not execute it.',
});
// { draftId: '...', status: 'draft' }
```

`form` must be a JSON object. `comment` is optional. Each call adds a new draft.

`submit()` waits for the bridge and saves a draft on the server. It does **not** confirm delivery. The human chooses **Send**. Show submission errors so the human can retry.

## Event format

Each **Send** creates one event. `humagent wait` returns events in `events[]`:

```json
{
  "id": "event-id",
  "revision": "source-revision",
  "message": "Keep changes small.",
  "items": [
    { "id": "comment-1", "kind": "comment", "comment": "Shorten this.", "target": { "selector": "h1" } },
    { "id": "edit-1", "kind": "edit", "edit": { "before": "Old", "after": "New" }, "target": { "selector": "#intro" } },
    { "id": "form-1", "kind": "form", "comment": "Revise the plan.", "form": { "strategy": "pilot-first" } }
  ],
  "deliveries": 1
}
```

`message` is the optional overall instruction. `deliveries` counts how often `wait` returned the event. A value above 1 means a redelivery.

`kind` names the key that holds the item's content. `comment` is optional on `edit` and `form` items. Empty `edit.after` means deletion.

An event can contain only a message. An empty review is invalid. The server rejects unknown item fields.

### Validation limits

| Field | Limit |
| --- | --- |
| Request body | 256 KiB |
| JSON nesting | Fewer than 24 levels |
| Drafts per session | 100 |
| Events per session | 2,000 |
| Comment / overall instruction | 4,000 / 4,000 characters |
| Each replacement string | 50,000 characters |
| Form key | 200 characters |
| Bar label text | 500 characters |

JSON values must be finite. The server rejects `__proto__`, `constructor`, and `prototype` keys at every depth.

### Targets

Targets include source URL, selector, and up to 4,000 characters of normalized text. They include a stable ID and quote context when available.

`coordinates: { x, y, space: "document" }` records the click in CSS pixels. Keyboard annotations use the target center. The marker stays at the click point. Its position stays in the draft, not in the event.

Targets describe rendered content, not guaranteed source lines. Missing or ambiguous targets remain unavailable.

### Revisions

Source revisions hash served HTML with SHA-256, excluding other assets. An HTTP revision follows the attached document, not nested frames, fragments, or status reads. File changes also trigger revision checks. After a file change, the workspace reloads the page once, unless an editor is open.

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
