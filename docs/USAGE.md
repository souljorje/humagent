# Using Humagent

Use Humagent to review an existing page or a generated interactive page. See the [quick starts](../README.md#review-an-existing-page).

## Connect an agent

Expand the floating bar. Copy its `humagent wait SESSION` command into your active agent chat.
The command uses the CLI's default timeout and lease. The agent repeats it after a timeout while review remains active.

| Connection | Meaning |
| --- | --- |
| Agent listening | The agent is waiting for feedback. |
| Agent working | The agent holds a feedback receipt. |
| No agent waiting | No wait or unexpired receipt indicates an active agent. |
| Checking connection | The browser awaits its first session response. |
| Connection unavailable | The browser cannot reach the session service. |
| Session ended | The session accepts no new feedback. |

The dot is green for a listening or working agent. It is red otherwise.
Connection state is separate from feedback delivery. Send requires a listening or working agent.

## Comment and edit text

Enable commenting in the bottom bar. Hover an element to highlight it.
Click a target to open its comment popover. Enter a comment, then press Enter or choose the checkmark.
Blank comments cannot be confirmed.

Click eligible plain text to edit it directly. The caret starts where you clicked.
Drag to select a portion before typing. Plain button and link labels also support text edits.
Their normal actions remain blocked during commenting. Mixed formatting, input values, and unsupported text surfaces remain comment targets.

Add a comment in the shared popover when needed. Confirm the text and comment together.
Enter confirms. Shift+Enter inserts a newline. Escape cancels. An empty text replacement proposes deletion.
Repeated edits retain the original text and feedback identity.

Confirmed wording appears as a local preview. Humagent never writes that preview into source files.
The agent applies authoritative source changes after receiving feedback.
Previews remain after Send until the agent acknowledges the matching batch.
Deletion, acknowledgment, or a source revision change removes previews. Cleanup does not overwrite subsequent application changes.

## Markers and unfinished input

Numbered markers remain at their original click locations. They follow their targets as the page moves.
Click a marker to edit its feedback. Save activates only after a valid change.
Cancel closes the editor without changing the saved feedback. Delete removes that feedback.
Selecting another marker discards unconfirmed changes and opens the selected feedback.

The first outside click focuses unfinished input. The second discards it and closes the editor.
Typing resets this sequence. Escape and Cancel dismiss immediately.
Send and browser reload remain protected while input is unfinished.
Reduced-motion settings replace shaking with focus feedback.

Disable commenting to interact with the application normally. Saved markers remain clickable.
Keyboard users can activate the commenting toggle, select targets with arrow keys, and press Enter to edit or comment.

## Floating bar and Send

Expand the caret to inspect pending feedback, connection details, and recovery actions.
Hover a pending item to highlight its target and marker. Select it to edit. Its trash button removes it.
Text edits use an inline diff. Deleted text has a strikethrough, unchanged text is muted, and added text uses normal emphasis.
Form decisions show readable values in their original order.

Add an overall instruction when needed. Comments and decisions can be sent without one.
Choose **Send** to submit the pending items as one immutable batch.
New submissions require a connected agent and current source revision.

| Feedback state | Meaning |
| --- | --- |
| Unconfirmed | An open editor contains changes that you did not confirm. Send is blocked. |
| Draft | Confirmed feedback is saved in this browser. It is not delivered yet. |
| Sending | The browser is submitting an immutable batch. |
| Awaiting confirmation | The browser cannot confirm server acceptance. The items remain locked for safe retry. |
| Queued | The server accepted the batch. An agent can reserve it. |
| Working | An agent holds a receipt for the batch. |
| Completed | The agent acknowledged that specific receipt. |

The Send button shows **Sent** for 1.5 seconds after matching server confirmation.
Only the submitted drafts and markers disappear. Newer feedback remains available.
The agent reports its work in its own chat. An acknowledgment confirms completion, not permission for additional actions.

## Refresh and recovery

Use normal browser reload. Confirm or cancel unfinished feedback first.
Confirmed drafts and marked form values survive reload in the same browser origin.
Other application memory can reset. Keep the same Humagent data directory and saved loopback port across restarts.

If a send fails, expand the bar and choose **Retry send**.
An uncertain batch retains its original client ID and exact payload. Retry remains valid after agent disconnection or session ending.
A definite rejection can offer **Return to drafts**. It cannot overwrite a newer overall instruction.

All feedback follows a unique selector or stable ID through text changes and element replacement.
Missing or ambiguous targets show as unavailable. Inspect or remove them.
A source revision change does not reassign existing targets. Recreate or remove stale feedback before sending.

Only one tab can edit a session. Close that tab before reloading another tab to take ownership.
Storage errors retain the previous saved record. Keep the tab open if the interface reports unsaved input.
The power button in expanded details ends the session after confirmation. Stored feedback remains available for delivery.

See [CLI troubleshooting](CLI.md#troubleshooting), [stored-session compatibility](CLI.md#stored-session-compatibility), and [security limits](SECURITY.md).
