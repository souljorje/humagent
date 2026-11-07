# Using Humagent

Open an existing local page or an agent-generated interface. See the [quick start](../README.md#quick-start).

## Connect an agent

Expand the floating bar and copy its `humagent wait SESSION` command to your active agent chat.

**Agent listening** means the agent is waiting for input. **Agent working** means it holds a review receipt. **No agent waiting** means neither is true.

New sends require an agent that is listening or working. Accepted feedback remains stored if the agent disconnects.

## Comment and edit

Enable commenting in the bar. Click an element to add a comment, or click eligible plain text to edit its local preview. Hover to highlight targets.

- **Confirm:** Enter or the checkmark. **Newline:** Shift+Enter. **Cancel:** Escape.
- **Select text:** Drag across words before typing. Plain link and button labels also support text edits during commenting.
- **Unsupported text:** Mixed formatting and native input fields remain comment targets.
- **Edit saved feedback:** Select its numbered marker. Save, cancel, or delete it.
- **Keyboard:** Use the commenting toggle, arrow keys, and Enter to select an element.

Edits can include an optional comment. Repeated edits retain the original text and item ID. Humagent shows proposed text but does not change source files.

The first outside click refocuses unfinished input. The second discards it. Typing resets this sequence. Escape cancels immediately. Send remains blocked while feedback is unfinished.

Disable commenting to use the application normally. Saved markers remain available.

## Send a review

Collect comments, edits, or form decisions. Include an overall instruction when useful. Choose **Send** to deliver them as one batch.

Expand the bar to inspect drafts, connection status, and errors. Hover a draft to highlight its target. Text changes appear as an inline diff. Decisions display their values.

| Status | Meaning |
| --- | --- |
| Draft | Saved in this browser, not sent |
| Sending | Submitting an immutable batch |
| Awaiting confirmation | Delivery is uncertain; retry the same batch |
| Queued | Server stored the batch |
| Working | Agent reserved the batch |
| Completed | Agent acknowledged the receipt |

Submitted drafts and markers leave the queue after confirmation. Local text previews remain until acknowledgment, deletion, or a source revision change. Cleanup must not overwrite application changes.

The agent reports results in its own chat. Acknowledgment does not grant permission for additional actions.

## Refresh and recovery

Browser reload keeps confirmed drafts and opted-in form values while the browser origin remains the same. Other application state can reset.

- **Failed send:** Select **Retry send** in the expanded bar. The batch keeps its ID and payload. A definite rejection may offer **Return to drafts**.
- **Changed source:** Inspect the page, then recreate or remove stale items. Humagent never changes their revision silently.
- **Missing target:** Feedback follows a unique stable ID or selector. An ambiguous target remains unavailable.
- **Unfinished input:** Confirm or cancel it before reloading.
- **Another editing tab:** Close that tab before reloading this one. One tab owns the review.
- **Storage error:** Keep the tab open if input is not saved.

Use the same data directory and saved workspace port across server restarts. The expanded bar can also end the session.

See [CLI troubleshooting](CLI.md#troubleshooting), [legacy sessions](CLI.md#stored-session-compatibility), and [security limits](SECURITY.md).
