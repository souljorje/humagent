# v0.1 verification record

Date: 2026-11-02. Status: tested local-development preview, not a production-hardened release.

Specification was committed before implementation: `9ac726ec0d20cacb51e583e307300441fdd81db2`. Implementation is on `feat/initial-runtime`, reviewed through [PR #1](https://github.com/souljorje/humagent/pull/1). No merge, npm publication, or external deployment is part of this work.

## Reproducible CI evidence

Verified implementation commit: `a9186318e6e882d66f023ba9c314c9de4acbea2e`.

[Successful full CI run](https://github.com/souljorje/humagent/actions/runs/41457752636): Ubuntu 24.04, Node 22, TypeScript 5.8.3, Playwright 1.56.1 and its Chromium 141 browser. The subsequent delivery commit adds this record and package-artifact upload; it does not change runtime behavior.

| Check | Observed result |
| --- | --- |
| `npm ci` | Fresh install from the checked-in dependency lockfile succeeded. |
| `npm run typecheck` | Passed. |
| `npm test` | 22 core and HTTP integration tests passed. |
| `npm run test:browser` | Passed all browser scenarios listed below. |
| `npm pack --dry-run` | Passed; compiled entry points, web assets, examples, skill and documentation are packaged. |
| Desktop and mobile inspection | Downloaded CI screenshots were visually inspected at 1440 px desktop and 390 px narrow viewport. No horizontal overflow was detected by the browser checks. The mobile interface intentionally stacks a scrollable preview above conversation. |

### Real-browser scenarios exercised

- Existing form values (radio, text, textarea, select and checkbox) persisted through a workspace reload.
- Explicit form submission reached an attached waiting consumer as structured JSON; receipt-specific reply completed the batch and appeared in the conversation.
- A new arbitrary intent and nested values were submitted through the SDK without adding a runtime handler.
- Element annotations and exact before/after edit proposals reached the session; the original source was not written by the browser.
- A selected text range retained its quote/prefix/suffix target.
- Source changes made old feedback fail with `STALE_REVISION`. Explicit refresh loaded the new document while preserving the unfinished composer draft and opted-in form state.
- Stopping and restarting the service on the same workspace port retained session data. Explicit refresh reconnected the interface to its new isolated port.
- A generated calculator updated locally without creating agent events; explicit submission then created one event.
- An unmodified existing localhost application retained normal button behavior, CSS/assets and JSON API access through the proxy, and accepted contextual annotations.
- The isolated interface could not read the workspace control plane without its private credentials.

### Core and HTTP scenarios exercised

Protocol validation; payload limits and reserved keys; durable persistence; duplicate input/reply handling; stale source revisions; optimistic working-state versions; receipt-specific completion; competing consumers; lease expiry and redelivery; lease renewal; persistence across store restart; ended sessions; corrupt state; exact quote anchoring and ambiguous matches; separate interface origins; source-safe injection; session-versus-agent permissions; Host/Origin checks; single-writer lock; rejected remote/credential-bearing targets; hidden paths/traversal/escaped symlinks; attached waits; timeout/end results; fixed-target proxy API behavior; forbidden external redirects; WebSocket upgrade forwarding.

## Additional local checks

On Linux with Node 22.16.0 and TypeScript 5.8.3:

- Build and the same 22 core/HTTP tests passed repeatedly.
- CLI subprocess smoke exercise passed: automatic server start through `open`, `status`, human-input delivery, `wait`, receipt-bearing `reply`, `end`, skill setup, `stop`, and idempotent second stop.
- An actual npm tarball was created and unpacked into a directory without `node_modules`; its compiled CLI help command ran successfully.
- Browser module syntax checks passed.

The authoring container could not perform browser navigation because its Chromium policy blocks localhost (`ERR_BLOCKED_BY_ADMINISTRATOR`). That restriction was not bypassed. Real-browser verification ran on the repository's GitHub Actions runner instead.

## Corrections made during verification

- Pinned CI to Ubuntu 24.04 after the floating runner image moved to an OS unsupported by the pinned Playwright release.
- Preserved actual file target identity when navigating a sibling HTML document.
- Fixed interface refresh to use the new surface origin after a service restart.
- Strengthened browser assertions to wait for the replacement document, rather than reading the old DOM before asynchronous refresh completed.
- Retained the dependency lockfile produced by the clean CI installation.

## Remaining limits

- No real end-user session in Claude Code, Codex or another agent harness has been exercised. Tests emulate an attached agent consumer through the same HTTP/CLI contract. Harness task-resumption behavior remains the responsibility of the calling agent environment.
- macOS and Windows execution, Safari/Firefox, accessibility with assistive technology, and real teammate onboarding remain untested.
- Existing-app coverage is a small native HTTP app and a WebSocket upgrade fixture. It is not a compatibility certification for Vite, Next.js, SvelteKit, authenticated apps, service workers or all browser CSP policies.
- Application cookies are intentionally not forwarded. Only explicit HTTP loopback targets are supported; arbitrary remote pages are not.
- Source revisions hash the current HTML, not its entire dependency graph. Dynamic server-rendered nonces/timestamps and client-only data changes require care.
- Form state is opt-in. Arbitrary application heap, scroll position and all framework state are not automatically preserved.
- Exact text changes are proposals, not rich-text WYSIWYG editing or automatic source patches.
- Markdown rendering, MCP Apps/MCP transports, schema renderers, React compilation, multi-user hosting and broader media editing are not implemented.
- Security tests establish the documented checks, not a security audit or a guarantee that malicious applications are safe to execute. Use trusted development artifacts and dedicated directories.

The intended next validation is real human/agent dogfooding on an existing application and a newly generated interface, without changing this runtime.
