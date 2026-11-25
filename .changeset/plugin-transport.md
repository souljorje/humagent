---
'humagent': minor
---

Feedback reviews now share one envelope: `{ id, kind, comment?, data?, target? }`. `kind` names the plugin and `data` holds its content.
`edit` and `form` keys are now `data`. `window.humagent.submit()` takes `{ data, comment? }`.
The server is transport only. It checks the review envelope and limits. The workspace applies the rules of each kind.
Each plugin owns the attribute `data-humagent-<kind>`. Marked forms now use `data-humagent-form` and `data-humagent-form-comment`.
Built-in plugins declare their kind once and return their tool for annotating from `page()`. The page host supplies the kind when saving.
The package entry exports `createServer` in place of `createRuntime`.
Session files from 0.3 are reported as unreadable.
`humagent SOURCE [--done RECEIPT]` runs the whole agent loop: open, complete a receipt, wait. The `open`, `wait`, and `ack` commands are removed. `--no-wait` exits after the command opens the page or completes the receipt.
Names changed: an unsent review is pending, and what one Send delivers is feedback. Results hold `feedback[]` in place of `events[]`. `submit()` returns `{ reviewId, status: 'pending' }`.
Delivered feedback shows Agent working.
The bar is one button. It opens the bar and turns commenting on.
Deleting a stale form review preserves the current form. Reopening a text edit preserves text that the application replaced.
Marked forms report errors from reading fields and saving values. A successful retry clears the form error.
Update the agent skill with `npx skills update humagent`.
