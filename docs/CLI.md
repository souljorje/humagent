# Command guide

Run `humagent --help` to see the installed commands. Run `humagent --version` to see the installed version.

Use Node.js 22+ or Bun 1.4.4+. The packaged command does not compile source during installation.

## Choose a command runner

After npm publication, these commands run the same package:

```sh
npx humagent@latest demo
bunx --bun humagent@latest demo
pnpm dlx humagent@latest demo
```

`bunx --bun` runs the command with Bun. Plain `npx` runs it with Node.js.

For a global installation, use `npm install --global humagent`. Then use `humagent` directly.

## Open an interface

```sh
humagent open ./page.html
humagent open http://127.0.0.1:3000/path
humagent open ./page.html --no-open --json
```

The command returns a session ID, source description, and private browser URL. It starts the local server when necessary.

`--network` permits external resources for trusted HTML files. Without this option, external requests and resources are blocked.

Use a dedicated artifact directory. Humagent serves supported sibling assets from that directory.

## Try a demo

```sh
humagent demo
humagent demo calculator
humagent demo existing
```

The default demo is `plan`. Humagent copies examples to `demos/VERSION` under its data directory. Existing copies remain unchanged.

## Install the skill

```sh
humagent setup
humagent setup --directory ./my-agent/skills/humagent
```

The default directory is `.agents/skills/humagent` in the current project.

Repeating setup with identical content succeeds without changes. Different content requires explicit replacement:

```sh
humagent setup --directory ./my-agent/skills/humagent --force
```

Read and preserve custom instructions before replacement. Setup does not edit global agent configuration.

## Receive input

```sh
humagent wait SESSION --consumer my-agent --timeout 50 --lease 600
```

Replace `SESSION` with the ID from `open`.

The timeout controls how long this command waits. It defaults to 50 seconds and cannot exceed 600 seconds.

The lease reserves a delivered batch for one consumer. It defaults to 120 seconds. Its range is 1–3600 seconds.

| Result | Action |
| --- | --- |
| `feedback` | Read the events. Apply authorized work. Acknowledge the returned receipt. |
| `timeout` | Repeat the wait while the review remains active. |
| `ended` | Stop waiting. Do not reopen without a request. |
| `interrupted` | Check server status. Resume when the server is available. |

Reading does not delete input. An expired lease permits another delivery. Check event IDs before repeating consequential actions.

Keep the command attached to the agent's active turn. A detached process does not guarantee agent resumption.

## Reply or acknowledge

```sh
humagent reply SESSION --receipt RECEIPT --message "Updated the page."
humagent ack SESSION --receipt RECEIPT
humagent renew SESSION --receipt RECEIPT --lease 600
```

`reply --receipt` records the message and completes the identified batch. `ack` completes it without a message.

`renew` extends the active lease. Renew before expiry when work needs more time.

A reply without `--receipt` sends a message but does not complete work.

## Inspect or stop

```sh
humagent status
humagent status SESSION
humagent doctor
humagent end SESSION
humagent stop
```

`status` reports sessions without starting a stopped server. `doctor` reports runtime information and checks packaged files.

`end` rejects new input for that session. Previously queued input remains available to the agent.

`stop` stops the server. It does not delete saved sessions.

## Data and server options

| Setting | Meaning |
| --- | --- |
| `--home PATH` | Select the data directory for this command. |
| `HUMAGENT_HOME` | Select the default data directory. |
| `HUMAGENT_PORT` | Select the server port. Use `0` to choose a free port. |
| `humagent server --port N` | Start a foreground server on the specified port. |
| `--json` | Request JSON output. Piped output also uses JSON. |

The default data directory is `~/.humagent`. The server chooses a free loopback port by default.

Use the same data directory for commands that share sessions. Do not publish this directory or its credentials.

## Troubleshooting

### No agent is listening

The browser does not run an agent. Ask your existing agent to read the skill and run `humagent wait SESSION`.

Queued feedback stays available. A closed agent turn needs a new user message or a supported harness callback.

### The browser does not open

Use the printed URL manually. On a headless computer, pass `--no-open`. The interface and browser normally run on the same computer.

### An older server is running

Run `humagent stop`. Repeat `open` with the updated command. Saved sessions remain available.

### The source changed

Refresh the interface. Check the selected target. Discard the stale pending submission. Submit the confirmed request again.

Do not change an old event's revision to bypass the conflict check.

### The interface does not connect

Check that the localhost server is running. Open its final HTML route directly.

Upstream CSP, frame restrictions, service workers, and absolute development-server URLs can prevent attachment. Humagent does not bypass these protections.

### The command cannot start

Run `humagent doctor`. Check your Node.js or Bun version. Read `server.log` in the data directory for server failures.

For a port conflict, set `HUMAGENT_PORT=0`. On Windows PowerShell, use `$env:HUMAGENT_PORT="0"` before the command.

### The registry package is unavailable

A repository change does not publish a package. Use the CI tarball until the maintainer publishes the first npm release.
