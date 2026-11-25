---
'humagent': patch
---

Group form controls by name without copying the group for each additional control.
Separate file serving, application proxying, authorization, and session routes from server startup.
Separate keyboard handling and layout observation from annotation setup.
Separate text preview cleanup from drawing pending edits. Simplify how the workspace determines agent status and protects unfinished edits.
The edit and form plugin entries are now `src/plugins/edit/index.ts` and `src/plugins/form/index.ts`.
Tooltip updates collect buttons directly from new page elements, avoiding a temporary array for each element.
