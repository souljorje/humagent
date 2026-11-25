# Reference

Commands, the page API, and the feedback format. See the [glossary](GLOSSARY.md) for names.

## Commands

Use `humagent --help` for syntax and `--version` for the version. Use `--json` for JSON results. Piped results also use JSON.

### Agent loop

```sh
humagent ./page.html
humagent http://127.0.0.1:3000/path
# Apply and check the feedback.
humagent ./page.html --done RECEIPT
```

`humagent SOURCE` opens the source, or reuses its session, and waits for feedback. The first call opens the browser. It prints the private URL on the error stream. The result adds the session ID to the feedback.

`--done RECEIPT` completes that receipt, then waits again. Repeat this command until the session ends.

Keep the page and its assets in one directory. Humagent serves supported files from that directory. See [network restrictions](../SECURITY.md#network).

Use `--no-open` to open the URL yourself. Use `--no-wait` to exit after the command opens the page or completes the receipt. Use `--network` when an HTML file loads external resources.

### Demo

```sh
humagent demo
```

The demo opens an editable page under `demos/VERSION` in the data directory. It preserves existing files.

### Agent skill

```sh
npx skills add souljorje/humagent
```

Update it with `npx skills update humagent`.

### Results

Each **Send** action delivers one feedback. The command blocks until the human sends feedback or ends the session. It has no time limit.

| Result | Action |
| --- | --- |
| `feedback` | Apply authorized changes. Then run the command with `--done RECEIPT`. |
| `ended` | Stop waiting. Reopen only on request. |
| `interrupted` | The server stopped. The command starts it again, so run it only when the work continues. |

Delivered feedback shows **Agent working** in the bar. The status stays until the agent completes the receipt. Feedback stays unfinished until completion. The next wait returns it again with a new receipt. Check feedback IDs before you repeat consequential actions.

Agent harnesses can stop long commands. If the command stops before a result, run it again. Unfinished feedback stays queued. Use background waiting only when the harness resumes the agent on completion.

### Server and storage

```sh
humagent status [SESSION]
humagent end SESSION
humagent stop
humagent server --port N
```

`status` reports the runtime, package files, server, and sessions. `status SESSION` reports one session. It never starts a stopped server. `end` rejects new input but keeps queued feedback available. `stop` retains saved sessions.

| Setting | Meaning |
| --- | --- |
| `--home PATH` | Data directory for this command |
| `HUMAGENT_HOME` | Default data directory, otherwise `~/.humagent` |
| `HUMAGENT_PORT` | Server port, or `0` for a free port |

The server selects a free loopback port at each start unless `--port` or `HUMAGENT_PORT` sets one. After a restart, run `humagent SOURCE` again. It reuses the saved session and prints the new URL. Use the same data directory across commands. Each session file under `sessions/` keeps pending reviews and feedback.

## Page contract

Humagent injects its SDK into supported local HTML and HTTP localhost apps. Generic comments and text previews need no integration.

### Forms

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

Use `data-humagent-form` to mark a form that saves its named values as a pending review.

A marked form owns one pending review. Each change saves it. Choices save at once. Typed text saves 300 milliseconds after typing stops. The submit button adds the form unchanged. Marked forms do not send feedback.

Send delivers the values that the form shows. A reload refills the form from its pending review. Deleting that review in the bar resets the form to its HTML defaults. After a source revision change, the next form change replaces the stale review.

The `data-humagent-form` value is the review key. Give each marked form a stable and unique value. The form review has no target and no marker.

The bar shows readable text. The title comes from `aria-label` or `aria-labelledby`, otherwise from `data-humagent-form`. Each field shows its label or fieldset legend and the visible text of its answer. The agent receives only field names and values.

| Control | Value |
| --- | --- |
| Single checkbox | Boolean |
| Checkbox group or repeated name | Array |
| Radio group | Selected value or `null` |
| Multiple selection | Array |
| Other named controls | String, including number and range inputs |

The SDK excludes disabled controls and file, password, hidden, submit, reset, and button inputs. It rejects unsafe field names. Restoration and reset emit an input event for page scripts.

### JavaScript

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

Each review has the same envelope. `kind` selects the plugin that reads the review. `data` holds the content of that kind. `comment` and `target` are common fields.

| Kind | `data` | `comment` | `target` |
| --- | --- | --- | --- |
| `comment` | None | Required | Required |
| `edit` | `{ before, after }`. Empty `after` means deletion. | Optional | Required |
| `form` | Named values | Optional | None |

A feedback can contain only an instruction. An empty feedback is invalid. The server rejects unknown review fields. The workspace applies the rules of each kind to every review from the page. It refuses an unknown kind.

## Limits

| Field | Limit |
| --- | --- |
| Pending reviews per session | 100 |
| Feedback per session | 2,000 |
| Comment and instruction | 4,000 characters each |
| Each edit string | 50,000 characters |

The server rejects `__proto__`, `constructor`, and `prototype` keys at every depth. All limits are in `LIMITS` in `src/shared/feedback.ts`.

## Targets and revisions

Targets include the source URL, selector, and up to 4,000 characters of normalized text. They include a stable ID and quote context when available. The marker stays at the click point, and the agent does not receive its coordinates.

Targets describe rendered content, not guaranteed source lines. Missing or ambiguous targets remain unavailable.

Source revisions hash served HTML with SHA-256, excluding other assets. An HTTP revision follows the attached document, not nested frames, fragments, or status reads. File changes also trigger revision checks. After a file change, the workspace reloads the page once, unless an editor is open. Stale feedback cannot be silently rebound. See [refresh and recovery](usage.md#refresh-and-recovery).

The server owns pending reviews and delivery. The SDK manages annotating and temporary editors. A new Send requires a waiting agent or unfinished feedback. Stored feedback remains available after disconnection or session ending.

## Status

| Status | Meaning |
| --- | --- |
| Pending | Saved on the server, not sent |
| Sending | The server turns all pending reviews and the instruction into one feedback |
| Queued | The server stored the feedback |
| Delivered | The agent received the feedback |
| Completed | The agent completed the receipt |
