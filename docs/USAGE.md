# Using Humagent

Open an existing local page or an agent-generated interface. See the [quick start](../README.md#quick-start).

## Terms

- **Draft:** one unsent comment, text edit, or form answer.
- **Review:** all drafts and the instruction that one **Send** delivers.
- **Event:** the agent's copy of one review.
- **Receipt:** the agent's hold on events until it acknowledges them.

## Connect an agent

Start from your agent with `/humagent ./page.html` or `/humagent http://localhost:3000`. The agent opens the page and starts waiting.

To connect an agent to a page that is already open, expand the floating bar. Copy its `humagent wait SESSION` command to your agent chat.

**Agent connected** means a `wait` command is running. **Agent working** means the agent has events that it did not acknowledge yet. **No agent connected** means neither is true.
The status dot is green while an agent is connected and blue while it works. It is amber with no agent, red without a connection, and gray after the session ends.

New sends require an agent that is connected or working. Accepted feedback remains stored if the agent disconnects.

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

Collect comments, edits, or form decisions. Include an instruction when useful. Choose **Send** to deliver them as one event.

A marked form keeps one draft that follows its fields. Delete that draft in the bar to reset the form.

Expand the bar to inspect drafts, connection status, and errors. Hover a draft to highlight its target. Text changes appear as an inline diff. Decisions display their values.

| Status | Meaning |
| --- | --- |
| Draft | Saved on the server, not sent |
| Sending | The server turns all drafts and the instruction into one event |
| Queued | The server stored the event |
| Delivered | The agent received the event and did not acknowledge it yet |
| Completed | The agent acknowledged the receipt |

A failed send keeps the drafts. The workspace then reads the current server state again.

Sent drafts and markers leave the list. Local text previews remain until acknowledgment or a source revision change. Cleanup must not overwrite application changes.

The agent reports results in its own chat. Acknowledgment does not grant permission for additional actions.

## Refresh and recovery

The server stores drafts, including marked form values, and the instruction in the session file. Other application state can reset.
This input survives browser reloads, other browsers, and server restarts while the data directory stays the same.
Several tabs can edit one session. The workspace reads the server state about once per second.

- **Changed source:** An HTML file page reloads on its own. An open editor delays the reload until you confirm or cancel it. An app page shows **Refresh page** in the bar.
- **Stale drafts:** Recreate or remove them. Stale drafts block Send. Humagent never changes their revision silently. The instruction has no revision and stays.
- **Missing target:** Feedback follows a unique stable ID or selector. An ambiguous target remains unavailable.
- **Unfinished input:** Confirm or cancel it before reloading. The server does not store open editors.
- **Save error:** Keep the tab open until the server saves your input.
- **Server restart:** Run `humagent open` with the same source again. It reuses the saved session. Use the new URL.

The expanded bar can also end the session. Unsent drafts stay saved, but the ended session rejects new sends.

See [CLI troubleshooting](CLI.md#troubleshooting) and [security limits](SECURITY.md).
