# Changesets

Add a changeset when a change affects the published package's behavior, API, types, or dependencies:

```sh
bun run changeset
```

Select `humagent`, choose a version increment, and describe the user-visible change. Commit the generated file with the code.

Internal tests, tooling, and CI-only changes do not usually need a changeset.

Changesets on `main` create a version pull request. Merging it publishes the new version automatically after full verification.

The initial `0.1.0` package has not yet been published. Publish that baseline before the first Changesets version PR.
