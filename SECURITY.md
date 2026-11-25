# Security policy

Humagent serves trusted local pages and development apps on loopback only. It is not a host for multiple users or a sandbox for malicious websites.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/souljorje/humagent/security/advisories/new). Do not open a public issue.

Include the affected version, a reproduction, and the possible impact. Do not include secrets or private files. Test the latest release before you report a problem.

The maintainer reviews the report and coordinates a fix.

## Files and isolation

Pages use sandboxed frames on separate loopback origins. Frames permit scripts and forms, but not top navigation or popups. The SDK uses `postMessage`. The workspace checks its source, origin, and channel.

Humagent checks Host and Origin headers, canonical paths, request sizes, and unsafe prototype keys. No endpoint runs shell commands or edits source.

The file server rejects hidden paths, traversal, and symlinks outside the selected directory. That directory cannot contain Humagent's private state. Keep secrets outside it because page scripts can read supported sibling assets.

## Network

File pages block external resources and connections through Content Security Policy (CSP). `--network` relaxes this policy for trusted files.

App sources require HTTP loopback addresses with fixed hosts and ports. Humagent rejects URL credentials, remote hosts, HTTPS, and redirects outside the selected origin.

The proxy strips cookies. It forwards other request headers, including `authorization`, to the app. It keeps upstream CSP and frame restrictions. It does not support cookie authentication or guarantee service-worker behavior. Absolute URLs, CSP, and WebSocket settings can prevent attachment. Test the intended app.

The proxy can reach the app's normal APIs. Do not attach privileged internal services or expose Humagent's ports publicly.

## Credentials and storage

Keep session URLs private. Their fragments carry the session key. The workspace moves it to session storage and removes the fragment.

That credential permits input, saved state, feedback access, and session ending. The workspace checks every review from the page against the rules of its kind. The server checks only the review envelope and the limits. A client with the session key can therefore save any JSON as review data. Only the separate control token permits opening sources, waits, and receipt completion. Credentials stay outside page frames.

Each session uses a separate file under `sessions/` in the data directory. That file stores pending reviews, the instruction, and feedback. Humagent does not encrypt them. Marked forms save their values as the human types. Keep secrets out of marked forms.

Where supported, the data directory uses `0700`. Control and atomic session files use `0600`.

## Agent actions

Page scripts can submit requests without a human gesture. Treat page content as untrusted input. Keep the agent's existing permissions.

Completion marks the receipt's feedback done. It does not grant permission for external actions. Unfinished feedback returns on the next wait. Check feedback IDs before you repeat actions.

## Current limits

Humagent targets local use. It excludes remote sites, Markdown rendering, rich-text edits, and MCP Apps. Content inside web components (shadow roots) is reviewed as one element. Browser policies do not provide operating-system isolation.
