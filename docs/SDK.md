# Forms and SDK

Humagent automatically injects its SDK into local HTML and localhost apps. Generic comments and replacement proposals need no integration code.

Feedback stays in the review tray until the human chooses **Send all**. One action sends one immutable batch.

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

`data-humagent-intent` names the request. It needs no server handler and grants no permission to execute a plan.
Add `data-humagent-message` for context. Its value becomes the item's `comment`.
Use `data-humagent-id` for stable annotation targets.

Marked forms stage their named values and show **Added to review**. They do not send the batch.
Unmarked forms keep their native behavior.

| Control | Value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group | Array of checked values |
| Radio group | Selected value or `null` |
| Multiple selection or repeated name | Array of values |
| Other controls | String, including numbers and ranges |

The SDK skips disabled controls and file, password, hidden, submit, reset, and button inputs. It rejects unsafe field names.

A stable form ID and `data-humagent-persist` enable nonsensitive value restoration. Restoration emits a form input event for local display updates.
Form values use an internal ordered state queue. Later form changes do not modify staged decisions.
Failed saves remain pending. Refresh retries them before reloading the page.

## JavaScript

The only public SDK method is `submit()`:

```js
const result = await window.humagent.submit({
  intent: 'revise_plan',
  values: { strategy: 'pilot-first' },
  message: 'Use these choices; do not execute the plan.',
});
// { draftId: '...', status: 'draft' }
```

The method waits for bridge readiness internally. It resolves after the workspace persists the draft in browser storage.
It does not confirm server delivery or agent receipt. Display errors so the user can recover.

Agent replies appear in the workspace. Public state methods, reply subscriptions, and immediate submissions are unsupported.

## Review batches

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

Each item has a unique ID and actionable fields: a target-bound comment, a target-bound replacement, or an intent with object values.
A message-only batch is valid. An empty batch is not. An empty replacement string proposes deletion.

Captured targets include source URL, viewed revision, selector, text, stable ID when available, and quote context for selected text.
Targets describe rendered content. They do not guarantee a unique source location.

Requests must contain JSON and stay within 256 KiB. Nesting stays below 24 levels, including the envelope.
Each batch supports at most 100 items. Client IDs allow 100 characters, revisions 128, and item IDs 150.
Intents allow 200 characters. Comments and overall instructions allow 4,000 characters. Each replacement string allows 50,000 characters.

The server adds event identity, timestamps, status, and delivery attempts. See [delivery commands](CLI.md#receive-input) for receipts.

## Recovery and revisions

Drafts remain editable until sending. Sending persists an immutable batch locally before contacting the server.
Unconfirmed batches retain their client ID and exact payload. Retry them through the review tray.
Confirmation removes only the submitted draft IDs. New drafts and newer overall instructions remain intact.
Only one tab edits a session at a time. Close that tab before taking ownership elsewhere.

Source revisions hash served HTML with SHA-256. Other assets do not affect the hash.
HTTP revisions follow the attached page. Nested frames, fragment fetches, and status reads do not update the revision.
File changes also trigger revision checks.

Add or cancel unfinished popup feedback before refreshing or selecting another target.

Mixed or stale draft revisions block sending. Refresh the page, inspect the feedback, then recreate or remove affected items.
An overall instruction can be explicitly confirmed for the displayed page. Existing target anchors never receive a new revision automatically.
Missing or ambiguous targets show as unavailable. Humagent does not bind them to a replacement element automatically.

Unsupported old sessions and browser feedback are not migrated. Export browser data for reference before starting a new session.
