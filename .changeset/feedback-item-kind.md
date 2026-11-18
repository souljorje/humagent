---
'humagent': minor
---

Feedback items now carry `kind`, and `replacement` is now `edit`. Form data moves under `form.values`, with the page's text in `form.instruction`. Marked forms carry `target.id`. The server rejects items that mix `values` with `replacement` or `target`.
