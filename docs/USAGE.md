# Using Humagent

Open an existing local page or an agent-generated interface. See the [quick start](../README.md#quick-start).

## Terms

See the [glossary](GLOSSARY.md) for every term. The main ones are feedback, review, pending, and receipt.

## Connect an agent

Start from your agent with `/humagent ./page.html` or `/humagent http://localhost:3000`. The agent opens the page and waits for your feedback.

The bar is one button in the corner of the page. Its dot shows the agent status. Its number counts your pending reviews.

**Agent connected** means the agent waits for your feedback. **Agent working** means the agent received your feedback and has not completed it.
**Feedback sent** means later feedback waits for the working agent. **No agent connected** means no agent waits and no feedback remains unfinished.
The dot is green while an agent waits and blue while it works.
It is amber without an agent, red without a server connection, and gray after the session ends.

New sends require a waiting agent or unfinished feedback. Accepted feedback remains stored if the agent disconnects.

## Comment and edit

Select the bar button. The bar opens and annotating starts. Click an element to add a comment, or click eligible plain text to edit its local preview. Hover to highlight targets.

- **Confirm:** Enter or the checkmark. **Newline:** Shift+Enter. **Cancel:** Escape.
- **Select text:** Drag across words before typing. Plain link and button labels also support text edits during annotating.
- **Unsupported text:** Mixed formatting and native input fields remain comment targets.
- **Edit saved feedback:** Select its numbered marker. Save, cancel, or delete it.
- **Keyboard:** Use the bar button, arrow keys, and Enter to select an element.

Edits can include an optional comment. Repeated edits retain the original text and review ID. Humagent shows proposed text but does not change source files.

The first outside click refocuses unfinished input. The second discards it. Typing resets this sequence. Escape cancels immediately. Send remains blocked while feedback is unfinished.

Select the bar button again, or press Escape, to close the bar and use the application normally. Saved markers remain available.

## Send feedback

Collect comments, edits, or form decisions. Include an instruction when useful. Choose **Send** to deliver them as one feedback.

A marked form keeps one pending review that follows its fields. The bar button counts it. Deleting the review resets the form only on the matching revision.

The open bar shows your pending reviews and the agent status. Errors appear above the bar, also while it is closed. Hover a review to highlight its target. Text changes appear as an inline diff. Decisions display their values.

| Status | Meaning |
| --- | --- |
| Pending | Saved on the server, not sent |
| Sending | The server turns all pending reviews and the instruction into one feedback |
| Queued | The server stored the feedback |
| Delivered | The agent received the feedback |
| Completed | The agent completed the receipt |

A failed send keeps the pending reviews. The workspace then reads the current server state again.

Sent reviews and their markers leave the list. Local text previews remain until the agent completes the receipt or the source revision changes. Cleanup must not overwrite application changes.

The agent reports results in its own chat. Completion does not grant permission for additional actions.

## Refresh and recovery

The server stores pending reviews, including marked form values, and the instruction in the session file. Other application state can reset.
This input survives browser reloads, other browsers, and server restarts while the data directory stays the same.
Several tabs can edit one session. The workspace reads the server state about once per second.

- **Changed source:** An HTML file page reloads on its own. An open editor delays the reload until you confirm or cancel it. An app page shows **Refresh page** in the bar.
- **Stale reviews:** Recreate or remove them. Stale reviews block Send. Humagent never changes their revision silently. The instruction has no revision and stays.
- **Missing target:** Feedback follows a unique stable ID or selector. An ambiguous target remains unavailable.
- **Unfinished input:** Confirm or cancel it before reloading. The server does not store open editors.
- **Save error:** Keep the tab open until the server saves your input.
- **Server restart:** Run `humagent SOURCE` again. It reuses the saved session. Use the new URL.

The open bar can also end the session. Pending reviews stay saved, but the ended session rejects new sends.

See [CLI troubleshooting](CLI.md#troubleshooting) and [security limits](SECURITY.md).
