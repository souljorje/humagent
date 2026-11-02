# Security model and limits

Humagent v0.1 is a local development preview, not a hardened multi-user service or a safe way to execute malicious websites.

The workspace and each interface use separate loopback origins. The iframe permits scripts and forms but not top navigation, popups or unrestricted parent access. Origin separation, not the word "sandbox" alone, protects the workspace. The injected channel permits user-input/state operations only. The agent's tool permissions remain authoritative.

Privileged API operations require a random control token. The browser receives a different session-scoped capability via the open URL fragment, moves it into session storage and removes the fragment from the address. It may submit input, save working state, view its transcript or end that session; it cannot open targets, wait as an agent, acknowledge or send agent replies. Treat open URLs as private capabilities. Do not share them publicly.

Control discovery files and atomic session files use mode 0600; the default state directory uses 0700 on platforms that support it. These files contain human inputs and must be protected. There is no encryption at rest. Browser composer drafts and unconfirmed sends use local storage; do not use a shared browser profile for sensitive work.

Host/Origin validation, payload limits, prototype-key refusal, realpath containment and loopback-target validation are enforced. State directories cannot be shared as artifact roots. Hidden canonical paths and symlinks escaping the artifact root are refused. No HTTP endpoint executes a shell command or edits source files.

The file server deliberately shares supported sibling assets. A malicious script within an explicitly shared artifact can read other served assets from that directory, so keep secrets elsewhere. Offline file CSP blocks outbound connections and external resources but is not an operating-system sandbox. `--network` relaxes that boundary for trusted files. Never expose the local ports through a tunnel or reverse proxy without designing authentication and a deployment threat model first.

The application proxy forwards to one user-selected HTTP loopback origin. It does not authenticate to it and strips cookie headers. It preserves upstream CSP/frame protections instead of bypassing them. Applications can still perform their normal local actions through their upstream API. Only review trusted development apps, never administrative/internal services. External redirects are refused. Arbitrary remote URL review is unsupported.

Generated forms and page scripts can submit structured requests; they cannot prove that every request originated from a human gesture. Agents must treat page-controlled content as untrusted input, distinguish instructions from evidence and request authorization for consequential external actions. Form values are not a permission grant.

Session delivery is at-least-once. An expired lease can be redelivered even if an earlier consumer performed work but failed to acknowledge it. Use event IDs and normal idempotency/approval mechanisms for consequential operations. No exactly-once execution or production-grade multi-user access control is claimed.

Please report vulnerabilities privately to the repository owner rather than posting credentials or private artifacts in a public issue.
