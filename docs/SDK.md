# Forms and SDK

Humagent injects its SDK into supported local HTML and HTTP localhost apps. Generic comments and text previews need no integration.

## Declarative forms

```html
<form
  aria-label="Launch plan"
  data-humagent-form="plan"
  data-humagent-form-comment="Revise the plan. Do not execute it."
>
  <label>Approach
    <select name="approach">
      <option value="pilot">Pilot first</option>
      <option value="platform">Platform first</option>
    </select>
  </label>
  <button type="submit">Add choices</button>
</form>
```

| Attribute | Purpose |
| --- | --- |
| `data-humagent-form` | Make the form one pending review with named values. The value is the review key. |
| `data-humagent-form-comment` | Add the form review's comment |
| `data-humagent-id` | Give any element a stable target ID for comments and text edits |

Each plugin owns the attribute `data-humagent-<kind>`. Attributes that start with that name belong to the plugin.

A marked form owns one pending review. Each change saves it. Choices save at once. Typed text saves 300 milliseconds after typing stops. The submit button adds the form unchanged. Marked forms do not send feedback. Unmarked forms behave normally.

Send delivers the values that the form shows. A reload refills the form from its pending review. Deleting the review resets the form only on the matching revision. After a source revision change, the next form change replaces the stale review.

The `data-humagent-form` value is the review key. Give each marked form a stable and unique value. The form review has no target and no marker on the page.

The bar shows readable text. The title comes from `aria-label` or `aria-labelledby`, otherwise from `data-humagent-form`. Each field shows its label or fieldset legend and the visible text of its answer. The agent receives only field names and values.

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
  data: { strategy: 'pilot-first' },
  comment: 'Revise the plan. Do not execute it.',
});
// { reviewId: '...', status: 'pending' }
```

`data` must be a JSON object. `comment` is optional. Each call adds a new pending `form` review.

`submit()` waits for the bridge and saves a pending review on the server. It does **not** confirm delivery. The human chooses **Send**. Show submission errors so the human can retry.

## Feedback format

Each **Send** delivers one feedback. `humagent SOURCE` returns them in `feedback[]`:

```json
{
  "id": "feedback-id",
  "revision": "source-revision",
  "instruction": "Keep changes small.",
  "reviews": [
    { "id": "comment-1", "kind": "comment", "comment": "Shorten this.", "target": { "selector": "h1" } },
    { "id": "edit-1", "kind": "edit", "data": { "before": "Old", "after": "New" }, "target": { "selector": "#intro" } },
    { "id": "form-1", "kind": "form", "comment": "Revise the plan.", "data": { "strategy": "pilot-first" } }
  ],
  "deliveries": 1
}
```

`instruction` is optional and applies to the whole feedback. `deliveries` counts how often the agent received the feedback. A value above 1 means a redelivery.

Each review has the same envelope. `kind` names the plugin that made the review. `data` holds the content of that kind. `comment` and `target` are common fields.

| Kind | `data` | `comment` | `target` |
| --- | --- | --- | --- |
| `comment` | None | Required | Required |
| `edit` | `{ before, after }`. Empty `after` means deletion. | Optional | Required |
| `form` | Named values | Optional | None |

A feedback can contain only an instruction. An empty feedback is invalid. The server rejects unknown review fields.
The workspace applies the rules of each kind to every review from the page. It refuses an unknown kind.

### Validation limits

| Field | Limit |
| --- | --- |
| Request body | 256 KiB |
| JSON nesting | Fewer than 24 levels |
| Pending reviews per session | 100 |
| Feedback per session | 2,000 |
| Comment / instruction | 4,000 / 4,000 characters |
| Each edit string | 50,000 characters |
| Review key | 200 characters |
| Bar label text | 500 characters |

JSON values must be finite. The server rejects `__proto__`, `constructor`, and `prototype` keys at every depth.

### Targets

Targets include source URL, selector, and up to 4,000 characters of normalized text. They include a stable ID and quote context when available.

`coordinates: { x, y, space: "document" }` records the click in CSS pixels. Keyboard annotations use the target center. The marker stays at the click point. Its position stays with the pending review. The agent does not receive it.

Targets describe rendered content, not guaranteed source lines. Missing or ambiguous targets remain unavailable.

### Revisions

Source revisions hash served HTML with SHA-256, excluding other assets. An HTTP revision follows the attached document, not nested frames, fragments, or status reads. File changes also trigger revision checks. After a file change, the workspace reloads the page once, unless an editor is open.

Stale feedback cannot be silently rebound. See [refresh and recovery](USAGE.md#refresh-and-recovery).

### Delivery

The server owns pending reviews and delivery. The SDK owns targeting and temporary editors. It sends each request once.

Each review kind is a plugin in the browser. The server is transport only: it checks the review envelope and the limits, and stores `data` as JSON.
The workspace relays every page request and applies the plugin's rules first. See [Add a plugin](development.md#add-a-plugin).

A new Send requires a waiting agent or unfinished feedback. Stored feedback remains available after disconnection or session ending.

The session keeps sent reviews until the agent completes their receipt, so their local previews remain. Cleanup cannot overwrite application changes or save rendered DOM into source.

The workspace uses these routes with the session key. Each write returns the current session.

| Route | Body |
| --- | --- |
| `GET /api/sessions/:id` | None |
| `POST /api/sessions/:id/reviews` | `{ review, revision, key?, local? }`. A known `key` replaces the pending review of that kind and key. `local` is the plugin's private data. |
| `PATCH /api/sessions/:id/reviews/:reviewId` | `{ revision, comment, data? }`. Given `data` replaces the review's data. |
| `DELETE /api/sessions/:id/reviews/:reviewId` | None |
| `PUT /api/sessions/:id/instruction` | `{ instruction }` |
| `POST /api/sessions/:id/send` | `{ revision }` |
| `POST /api/sessions/:id/page` | `{ documentId }` |
| `POST /api/sessions/:id/end` | `{}` |

The optional `revision` query parameter on DELETE identifies the saved review's revision. A mismatch returns `409 STALE_REVISION`.

See [CLI receipts](CLI.md#receive-input) and [security constraints](SECURITY.md).
