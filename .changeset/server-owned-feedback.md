---
'humagent': minor
---

Store drafts, the overall instruction, and form values on the server, so they survive reloads, other browsers, and server restarts. Send is one server call without retry or confirmation states. Events now contain `message` and `items` directly, without `protocol`, `clientId`, or `payload`. The workspace port is no longer saved, so run `humagent open` again after a restart.
