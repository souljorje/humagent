# Security

Use Humagent only with trusted local pages and development apps. It is not a multi-user host or a sandbox for malicious websites.

## Isolation

Each page uses a loopback origin separate from the workspace. Its iframe permits scripts and forms, but not top navigation or popups.

The SDK channel accepts human input and working-state operations. Origin separation protects the workspace. The iframe sandbox alone is insufficient.

The application proxy can still reach the application's normal APIs. Do not attach to administrative or privileged internal services.

## Credentials and storage

Privileged API operations require a random control token. The browser receives a separate credential for one session.

The initial URL carries this credential in its fragment. The workspace moves it to session storage and removes the fragment.

The session credential permits input, state changes, transcript access, and session ending. It cannot open targets, wait, acknowledge events, or send agent replies.

Keep session URLs private. Never give control credentials to page scripts.

Where supported, the data directory uses `0700` and control and atomic session files use `0600`. Stored input is not encrypted.

Browser drafts and unconfirmed sends use local storage. Avoid shared browser profiles for sensitive work.

## Files and requests

Humagent checks Host and Origin headers, canonical paths, loopback targets, payload sizes, and unsafe prototype keys.

Artifact directories cannot contain Humagent's state directory. The file server rejects hidden paths, traversal, and symlinks outside the artifact directory.

Supported sibling assets are readable by page scripts. Keep secrets outside that directory.

No HTTP endpoint executes shell commands or edits source files.

## Network access

Local HTML blocks external connections and resources through its Content Security Policy (CSP). `--network` relaxes this policy for trusted files.

The proxy forwards requests to one selected HTTP loopback origin. It strips cookies, provides no authentication, and retains upstream CSP and frame protections.

It rejects external redirects. Remote sites are unsupported.

Do not expose local ports without authentication and a documented threat model. Browser policies do not provide an operating-system sandbox.

## Agent actions

Page scripts can submit requests without a human gesture. Treat page-controlled content as untrusted input, not proof of user authorization.

Keep the agent's existing permissions. Obtain authorization before consequential external actions.

An event can arrive again after lease expiry, even if an earlier consumer acted without acknowledging it.
Use event IDs and the workflow's approval and retry safeguards before repeating actions. Humagent does not guarantee exactly-once execution.

## Report a vulnerability

Contact the repository owner privately. Keep credentials and private artifacts out of public issues.
