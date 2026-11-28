# Standalone distribution experiment

This branch packages the CLI and its runtime in one executable. Users do not install a separate application runtime.

The existing JavaScript package remains the comparison package. The experiment does not change release publication or the feedback exports.

## Boundaries

The executable contains the CLI, server code, browser assets, examples, and runtime.
The build preserves the current HTTP implementation and its access rules.
The experiment measures distribution before replacing server APIs.

The package launcher requires Node.js 24 or later. It starts the bundled executable and forwards arguments, streams, exit codes, and signals.
The executable starts its own background server. It does not search for an installed runtime.

The experiment creates private packages with prerelease versions. The workflow uploads archives only.
It does not publish packages, create releases, or change the main branch.

## Build

Use the exact runtime version in [the workflow](../.github/workflows/bun-standalone.yml).
Install the frozen dependencies first.

```sh
bun install --frozen-lockfile
bun run build:standalone
bun run test:standalone
```

The build selects the host platform by default. Select another compiler target with `--target`.

```sh
bun run build:standalone --target bun-linux-arm64
```

All generated files remain in `.local/standalone/`.
Each target directory contains an executable, two package archives, checksums, and a manifest.
The top-level manifest identifies the latest build for the smoke test.

```text
.local/standalone/
├── manifest.json
└── bun-linux-x64/
    ├── humagent
    ├── checksums.sha256
    ├── manifest.json
    ├── humagent-bun-experiment-VERSION.tgz
    ├── humagent-bun-experiment-linux-x64-glibc-VERSION.tgz
    ├── wrapper/
    └── platform/
```

The compiler embeds the built `client` and `examples` directories.
The executable reads these assets from its embedded filesystem.
User pages and saved sessions remain on the real filesystem.

## Package installation

The wrapper lists platform packages as optional dependencies. Each platform package declares its operating system, architecture, and Linux C library.
Installation runs no scripts. The launcher never downloads an executable.
Missing platform packages produce an installation error message when the command starts.

The package names use the `humagent-bun-experiment` prefix. The package version adds `-bun-experiment.0` to the application version.
These names do not identify published packages.
The executable reports that experimental version. It refuses to reuse a running server from the ordinary JavaScript package.

The smoke test installs the wrapper and matching platform archive together. It disables installation scripts and registry access.
The test invokes the installed command from a separate directory.

For direct use, extract the executable from the platform archive's `package/bin/` directory.
The executable requires no adjacent application files.

## Target coverage

The compiler supports all targets below. A successful cross-build establishes compilation only.
The native jobs test the installed packages and the executable.

| Compiler target        | Workflow coverage  |
| ---------------------- | ------------------ |
| `bun-linux-x64`        | Native Linux job   |
| `bun-darwin-arm64`     | Native macOS job   |
| `bun-windows-x64`      | Native Windows job |
| `bun-darwin-x64`       | Cross-build only   |
| `bun-linux-arm64`      | Cross-build only   |
| `bun-linux-x64-musl`   | Cross-build only   |
| `bun-linux-arm64-musl` | Cross-build only   |
| `bun-windows-arm64`    | Cross-build only   |

The experiment uses one executable per target. It does not create separate baseline and modern CPU packages.

## Acceptance

The executable must start outside the checkout. Browser assets and the demo must remain available there.
The CLI must start, stop, and restart its background server without another runtime on the search path.
Saved sessions must survive the restart. The npm launcher must preserve CLI behavior.

The workflow does not establish signing, notarization, registry publication, or unattended upgrades.
The cross-build jobs do not establish runtime support for their targets.
The current JavaScript package and its declarations remain available for comparison.

See [Development](development.md#checks) for the existing regression checks.
