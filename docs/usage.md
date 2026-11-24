# Using Humagent

Open an existing local page or an agent-generated interface. See the [quick start](../README.md#quick-start).

## Connect an agent

Start from your agent with `/humagent ./page.html` or `/humagent http://localhost:3000`. The agent opens the page and waits for your feedback.

The bar is one button in the corner of the page. Its dot shows the agent status. Its number counts your pending reviews.

- **Agent connected:** the agent waits for your feedback.
- **Agent working:** the agent received your feedback and has not completed it.
- **Feedback sent:** later feedback waits for the working agent.
- **No agent connected:** no agent waits and no feedback remains unfinished.

New sends require a waiting agent or unfinished feedback. Accepted feedback remains stored if the agent disconnects.

## Comment and edit

Select the bar button. The bar opens and annotating starts. Click an element to add a comment. Click eligible plain text to edit its local preview. Hover to highlight targets.

- Confirm with Enter or the checkmark. Use Shift+Enter for a newline. Cancel with Escape.
- Select text before you type to replace it. Link and button labels also support text edits.
- Mixed formatting and native input fields remain comment targets.
- Select a numbered marker to edit, save, or delete saved feedback.
- Use the bar button, arrow keys, and Enter to select an element.

Edits can include an optional comment. Repeated edits retain the original text and review ID. Humagent shows proposed text but does not change source files.

The first outside click refocuses unfinished input. The second discards it. Escape cancels at once. Send stays blocked while feedback is unfinished.

Select the bar button again, or press Escape, to close the bar and use the application normally. Saved markers remain available.

## Send feedback

Collect comments, edits, or form decisions. Include an instruction when useful. Choose **Send** to deliver them as one feedback.

A marked form keeps one pending review that follows its fields. The bar button counts it. Delete that review in the bar to reset the form.

The open bar shows your pending reviews and the agent status. Errors appear above the bar, also while it is closed. Hover a review to highlight its target. Text changes appear as an inline diff. Decisions display their values.

A failed send keeps the pending reviews. The workspace then reads the current server state again. Sent reviews and their markers leave the list. Local text previews remain until the agent completes the receipt or the source revision changes.

The agent reports results in its own chat. Completion does not grant permission for additional actions.

## Refresh and recovery

The server stores pending reviews and the instruction in the session file. This input survives browser reloads, other browsers, and server restarts while the data directory stays the same. Several tabs can edit one session.

- **Changed source:** an HTML file page reloads on its own. An open editor delays the reload until you confirm or cancel it. An app page shows **Refresh page** in the bar.
- **Stale reviews:** recreate or remove them. Stale reviews block Send. The instruction stays.
- **Missing target:** feedback follows a unique stable ID or selector. An ambiguous target remains unavailable.
- **Unfinished input:** confirm or cancel it before reloading. The server does not store open editors.
- **Save error:** keep the tab open until the server saves your input.
- **Server restart:** run `humagent SOURCE` again. It reuses the saved session. Use the new URL.

The open bar can also end the session. Pending reviews stay saved. The ended session rejects new sends.

See the [reference](reference.md#status) for status meanings and the [security limits](../SECURITY.md).
