# Humagent engineering

Read docs/SPEC.md before changing behavior. This is an independent interaction layer, not a business-specific renderer or an agent runner. Preserve existing application behavior by default. No task-specific backend action handlers.

Use TypeScript for the service/CLI and browser-native modules for the workspace. Keep runtime dependencies narrow. Retain donor attribution for copied/adapted helpers. Never add a Lavish or Human Review runtime dependency merely to reuse one function.

Every interaction needs explicit source identity, revision and receipt semantics. Do not consume feedback on read or silently rebind stale targets. Never serialize a running app's DOM into its source. Keep control credentials out of frames and ordinary artifacts.

Run npm run check and npm run test:browser when available. Record unavailable verification honestly. Exercise an existing app and a generated mini-app without platform changes. Keep temporary screenshots, server state and logs in .local/, not in commits. Do not publish to npm, expose local servers, merge or deploy without authorization.
