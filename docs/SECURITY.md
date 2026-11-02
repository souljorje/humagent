# Security model and limits

Humagent v0.1 is a local development preview. It is not a hardened multi-user service. Do not use it to execute malicious websites.

## Browser isolation

The workspace and each interface use separate loopback origins. The frame permits scripts and forms. It does not permit top navigation, popups, or unrestricted access to its parent.

Origin separation protects the workspace. The iframe sandbox is not sufficient by itself. The injected channel accepts human input and working-state operations only. The agent's tool permissions remain authoritative.

## Credentials

Privileged API operations require a random control token. The browser receives a separate credential limited to one session. The initial URL carries this credential in its fragment. The workspace stores it in session storage and removes the fragment from the address.

The browser credential permits input, working-state changes, transcript access, and ending that session. It cannot open targets, wait as an agent, acknowledge events, or send agent replies.

Treat session URLs as private credentials. Do not share them publicly. Do not place control credentials in an application frame.

## Stored data

Control files and atomic session files use mode `0600`. The state directory uses mode `0700` where the platform supports these permissions. These files contain human input. Humagent does not encrypt them at rest.

Browser drafts and unconfirmed sends use local storage. Do not use a shared browser profile for sensitive work.

## Request and path checks

Humagent validates Host and Origin headers. It limits payloads and rejects unsafe prototype keys. It checks canonical paths and loopback targets. Artifact roots cannot contain Humagent's state directory.

The file server rejects hidden paths and symlinks that escape the artifact root. No HTTP endpoint executes shell commands or edits source files.

## Local HTML

The file server exposes supported sibling assets. A script in the artifact can read those assets. Keep secrets outside the shared directory.

The default Content Security Policy (CSP) blocks external connections and resources. This policy is not an operating-system sandbox. `--network` relaxes these restrictions for trusted files.

Do not expose local ports through a tunnel or proxy without authentication and a documented deployment threat model.

## Application proxy

The proxy forwards requests to one selected HTTP loopback origin. It does not authenticate to that origin. It removes cookie headers and preserves upstream CSP and frame protections.

The application can still use its normal local APIs. Review only trusted development applications. Do not attach to administrative or privileged internal services.

The proxy refuses external redirects. Remote URL review is unsupported.

## Agent permissions

Page scripts and forms can submit structured requests. Humagent cannot prove that each request resulted from a human gesture.

Treat page-controlled content as untrusted input. Distinguish instructions from evidence. Request authorization before consequential external actions. Form values do not grant permissions.

## Delivery retries

Delivery is at-least-once. An event can arrive again after lease expiry, including when an earlier consumer acted but did not acknowledge it.

Use event IDs to detect repeated delivery. Apply the normal approval and idempotency rules to consequential actions. Humagent does not guarantee exactly-once execution.

## Reporting

Report vulnerabilities privately to the repository owner. Do not include credentials or private artifacts in public issues.
