---
'humagent': minor
---

The server stores drafts, the overall instruction, and form values, so they survive reloads, other browsers, and server restarts. Send is one server call. Events contain `message` and `items` directly, without `protocol`, `clientId`, or `payload`.

Each marked form owns one draft that follows its fields. Choices save at once and typed text saves as you type, a reload refills the form, and deleting the draft resets the form. The bar shows form titles and field labels. `data-humagent-persist` is removed.

`wait` takes no options and blocks until feedback arrives or the session ends. Unacknowledged events return on the next `wait`. `renew`, `--lease`, `--consumer`, `--timeout`, and `doctor` are removed. `status` reports the runtime. The workspace port is no longer saved, so run `humagent open` again after a restart.

Markers stay at the click point, also for text edits. Content inside web components (shadow roots) is reviewed as one element.
