---
'humagent': minor
---

The server stores drafts, the overall instruction, and form values, so they survive reloads, other browsers, and server restarts. Send is one server call. Events contain `message` and `items` directly, without `protocol`, `clientId`, or `payload`.

Each marked form owns one draft that follows its fields. Choices save at once. Typed text saves as you type and before the page unloads. A reload refills the form, and deleting the draft resets the form. The bar shows form titles and field labels. `data-humagent-persist` is removed.

`wait` takes no options and blocks until feedback arrives or the session ends. Unacknowledged events return on the next `wait`. **Agent listening** means a `wait` is running. `renew`, `--lease`, `--consumer`, `--timeout`, and `doctor` are removed. `status` reports the runtime. The workspace port is no longer saved, so run `humagent open` again after a restart. The workspace URL is now the server root. If the browser blocks the clipboard, the copy button does nothing and the command stays selectable.

Markers stay at the click point, also for text edits. Content inside web components (shadow roots) is reviewed as one element. The demo page is shorter.
