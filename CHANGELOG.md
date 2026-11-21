# humagent

## 0.3.1

### Patch Changes

- 5d2fe9d: Keep proxied server-sent event streams open while idle and forward their headers immediately.

## 0.3.0

### Minor Changes

- 05f0f9f: Show “Feedback sent” until the agent confirms work with `ack --start`.
  Keep completion acknowledgment separate so unfinished feedback and text previews remain available.

### Patch Changes

- 05f0f9f: Add a copyable agent command to the demo's Connect step.

## 0.2.0

### Minor Changes

- fe24f88: The event field `message` is now `instruction`. The agent state `waiting` is now `connected`. The reviewed file or app is now `source` instead of `target` in `wait` results, `status` output, and the open request.
- d0347b4: Feedback items carry `kind`, which names their content key. `replacement` is now `edit`, and `values` is now `form`, in items and in `submit()`. The form attribute `data-humagent-message` is now `data-humagent-comment`. Session files from 0.1 are reported as unreadable.

## 0.1.0

Initial release.

- Open a local HTML file or an HTTP localhost app in a review workspace with `humagent open`. Try it with `humagent demo`.
- Comment on page elements and edit plain text in place. Humagent shows the proposed text and does not change source files.
- Collect answers from forms marked with `data-humagent-id`. Page scripts can add data with `window.humagent.submit()`.
- Send comments, text edits, form answers, and an overall instruction to the agent as one event.
- Receive events in any agent harness with `humagent wait`. Complete them with `humagent ack`. Unacknowledged events return on the next `wait`.
- Keep drafts and the overall instruction on the local server. They survive browser reloads and server restarts.
- Detect source changes. Stale drafts block Send until you recreate or remove them.
- Run locally on Node.js 24+ or Bun 1.4.4+, without an account or API key. Pages load in sandboxed frames on separate loopback origins.
- Install the agent skill separately with `npx skills add souljorje/humagent`.
